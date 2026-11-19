import { randomUUID } from 'node:crypto';

import { and, count, eq, inArray, isNull, max, sql, type SQL } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { AreaKey, EntityId, TimeZone, type Instant, type LocalDate } from '@abnehm/contracts/base';
import { partnerSummaryBounds, partnerSummaryPeriod, type PartnerDailyGoalStage } from '@abnehm/contracts/partner';

import { PartnerResponseRejected } from '../authorization/authorization.ts';
import { canonicalJson } from '../canonical-json.ts';
import type { DbExecutor } from '../database.ts';
import {
  couplingMember,
  dailyGoalCompletion,
  partnerDailyGoalStatus,
  partnerSharing,
  partnerSummary,
  person,
  projectionInvalidation,
} from '../db/schema/index.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import type { PrePullStep } from '../sync/sync.ts';
import { summaryEnvelope } from './entities.ts';
import type { AnyPartnerSummaryProjector, PartnerSummaryProjector } from './projector.ts';
import { tombstoneProjection } from './revocation.ts';

// Projektionsmechanismus (Spezifikation 0, Abschnitt 5). Die Bereiche melden je Bereich einen Projector
// an. Vor jedem Pull materialisiert das Fundament für die abrufende Person, was sie über ihren Partner
// sehen darf: fehlende Zusammenfassungen des aktuellen Zeitraums, neu zu rechnende nach Invalidierung
// und den groben Tageszielstand, den es selbst aus den Tageszielerfüllungen bildet. Der Schritt läuft in
// eigener Transaktion vor dem Lesesnapshot des Pulls; was er schreibt, kommt also im selben Pull an.

/**
 * Nach dieser Zeit bestätigt der nächste Pull eine unveränderte Projektion mit neuem `dataAsOf`. So
 * zeigt „Stand vor …“ den Datenstand und verrät nicht, wann der Partner zuletzt etwas erfasst hat
 * (Spezifikation 5, Abschnitt 2). Designwert wie die 10 Minuten bis `stale` dort, nicht empirisch belegt.
 */
export const dataAsOfRefreshMs = 10 * 60_000;

const stages: readonly PartnerDailyGoalStage[] = ['noch_nichts', 'unterwegs', 'fast_geschafft', 'geschafft'];

export type PartnerProjections = Readonly<{
  /** Meldet den Projector eines Bereichs an; je Bereich höchstens einer. */
  registerProjector(projector: AnyPartnerSummaryProjector): void;
  /** Vor-Pull-Schritt für die Sync-Registry. */
  prePullStep: PrePullStep;
}>;

type Recipient = Readonly<{ couplingId: string; ownerPersonId: string; recipientPersonId: string; today: LocalDate; at: Date }>;

export function createPartnerProjections({ clock }: { clock: Clock }): PartnerProjections {
  const projectors = new Map<AreaKey, AnyPartnerSummaryProjector>();

  async function prePullStep(tx: DbExecutor, { personId, now }: { personId: EntityId; now: Instant }) {
    const coupling = await activeCouplingOf(tx, personId);
    if (coupling === null) return;
    const ownerPersonId = coupling.partnerPersonId;
    // Ein zweites Gerät desselben Empfängers wartet, statt dieselbe Projektion parallel anzulegen.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`partner_projection:${ownerPersonId}`}, 0))`);
    const [owner] = await tx.select({ timeZone: person.timeZone }).from(person).where(eq(person.id, ownerPersonId));
    if (owner === undefined) throw new Error('Person des Partners fehlt');
    const recipient: Recipient = {
      couplingId: coupling.couplingId,
      ownerPersonId,
      recipientPersonId: personId,
      // Der aktuelle lokale Tag des Eigentümers folgt seiner `time_zone`, auch direkt nach einem Wechsel.
      today: clock.read(TimeZone.parse(owner.timeZone)).localDate,
      at: new Date(now),
    };

    const pending = await tx
      .select({ id: projectionInvalidation.id, area: projectionInvalidation.area, fromDate: projectionInvalidation.fromDate })
      .from(projectionInvalidation)
      .where(and(eq(projectionInvalidation.ownerPersonId, ownerPersonId), isNull(projectionInvalidation.processedAt)));
    const levels = await sharingLevels(tx, ownerPersonId, coupling.couplingId);
    for (const area of AreaKey.options) {
      const projector = projectors.get(area);
      // Gesundheitszusammenfassungen gibt es nur bei Freigabestufe `zusammengefasst`.
      if (projector === undefined || levels.get(area) !== 'zusammengefasst') continue;
      const invalidated = pending.some((invalidation) => invalidation.area === null || invalidation.area === area);
      await materializeSummary(tx, projector, recipient, invalidated);
    }
    await materializeDailyGoalStatus(tx, recipient);

    // Jeder aktuelle Zeitraum endet frühestens heute; eine künftige Invalidierung (etwa ein Plan ab
    // nächster Woche) bleibt offen, bis ihr Tag erreicht ist.
    const due = pending.filter((invalidation) => invalidation.fromDate <= recipient.today).map((invalidation) => invalidation.id);
    if (due.length > 0) await tx.update(projectionInvalidation).set({ processedAt: recipient.at }).where(inArray(projectionInvalidation.id, due));
  }

  return {
    registerProjector(projector) {
      if (projectors.has(projector.area)) throw new Error(`Projector für ${projector.area} ist schon angemeldet`);
      projectors.set(projector.area, projector);
    },
    prePullStep,
  };
}

/**
 * Hält höchstens eine nicht gelöschte Zusammenfassung des Bereichs: die des aktuellen Zeitraums, sofern der
 * Projector etwas zu zeigen hat. Ältere Zeiträume werden zur Löschmarkierung. Gerechnet wird nur, wenn die Zusammenfassung fehlt,
 * invalidiert ist oder ihr `dataAsOf` bestätigt werden muss; geschrieben nur bei neuem Stand.
 */
async function materializeSummary(tx: DbExecutor, registered: AnyPartnerSummaryProjector, recipient: Recipient, invalidated: boolean) {
  // Zeitraum und Inhalt passen je Bereich zusammen; über die Union verfolgt TypeScript das nicht.
  const projector: PartnerSummaryProjector = registered;
  const period = partnerSummaryPeriod(projector.area, recipient.today);
  const { from: periodFrom, to: periodTo } = partnerSummaryBounds(period);
  const key = and(recipientKey(partnerSummary, recipient), eq(partnerSummary.area, projector.area));
  const live = await tx.select().from(partnerSummary).where(and(key, isNull(partnerSummary.deletedAt)));
  const current = live.find((row) => row.periodFrom === periodFrom);
  for (const row of live) if (row !== current) await tombstoneProjection(tx, partnerSummary, row, recipient.at);

  const fresh = current !== undefined && !needsRefresh(current.dataAsOf, recipient.at);
  if (fresh && !invalidated) return;
  const content = await projector.project(tx, { ownerPersonId: EntityId.parse(recipient.ownerPersonId), period, today: recipient.today });
  // „Noch nichts zu zeigen“: Für diesen Zeitraum gibt es keine Zusammenfassung, auch keine frühere Fassung.
  if (content === null) {
    if (current !== undefined) await tombstoneProjection(tx, partnerSummary, current, recipient.at);
    return;
  }
  if (fresh && canonicalJson(current.content) === canonicalJson(content)) return;

  const serverVersion = await nextServerVersion(tx);
  const generation = current?.generation ?? (await nextGeneration(tx, partnerSummary, and(key, eq(partnerSummary.periodFrom, periodFrom))));
  const row = {
    id: current?.id ?? randomUUID(),
    couplingId: recipient.couplingId,
    ownerPersonId: recipient.ownerPersonId,
    recipientPersonId: recipient.recipientPersonId,
    area: projector.area,
    periodFrom,
    periodTo,
    generation,
    content,
    dataAsOf: recipient.at,
    createdAt: current?.createdAt ?? recipient.at,
    updatedAt: recipient.at,
    deletedAt: null,
    serverVersion,
  };
  // Zusätzliche oder unzulässige Werte eines Projectors werden nie gespeichert. Der Pull liefert dann
  // alles andere; der Bereich bleibt beim alten Stand, bis der Projector korrigiert ist.
  if (!isValidEnvelope(row)) {
    console.error(`[partner-projections] Projector ${projector.area} liefert keinen gültigen Inhalt`);
    return;
  }
  if (current !== undefined) await tx.update(partnerSummary).set(row).where(eq(partnerSummary.id, row.id));
  else await tx.insert(partnerSummary).values(row);
  await recordChange(tx, { position: serverVersion, entityType: 'partner_summary', entityId: row.id, operation: 'upsert',
    recipientPersonId: recipient.recipientPersonId, createdAt: recipient.at });
}

function isValidEnvelope(row: typeof partnerSummary.$inferSelect): boolean {
  try {
    summaryEnvelope(row);
    return true;
  } catch (error) {
    if (error instanceof PartnerResponseRejected) return false;
    throw error;
  }
}

type ProjectionTable = typeof partnerSummary | typeof partnerDailyGoalStatus;

/** Kopplung, Eigentümer und Empfänger: der gemeinsame Teil des natürlichen Schlüssels beider Projektionen. */
function recipientKey(table: ProjectionTable, recipient: Recipient) {
  return and(
    eq(table.couplingId, recipient.couplingId),
    eq(table.ownerPersonId, recipient.ownerPersonId),
    eq(table.recipientPersonId, recipient.recipientPersonId),
  );
}

/** Generation einer neuen Fassung: eins mehr als jede frühere desselben natürlichen Schlüssels. */
async function nextGeneration(tx: DbExecutor, table: ProjectionTable, naturalKey: SQL | undefined) {
  const [previous] = await tx.select({ generation: max(table.generation) }).from(table).where(naturalKey);
  return (previous?.generation ?? 0) + 1;
}

/** Grober Tageszielstand des heutigen Tags aus den Tageszielerfüllungen des Eigentümers; nie als Zahl. */
async function materializeDailyGoalStatus(tx: DbExecutor, recipient: Recipient) {
  const [completions] = await tx
    .select({ count: count() })
    .from(dailyGoalCompletion)
    .where(and(eq(dailyGoalCompletion.personId, recipient.ownerPersonId), eq(dailyGoalCompletion.localDate, recipient.today)));
  const stage = stages[Math.min(completions?.count ?? 0, stages.length - 1)]!;
  const key = recipientKey(partnerDailyGoalStatus, recipient);
  const live = await tx.select().from(partnerDailyGoalStatus).where(and(key, isNull(partnerDailyGoalStatus.deletedAt)));
  const current = live.find((row) => row.localDate === recipient.today);
  for (const row of live) if (row !== current) await tombstoneProjection(tx, partnerDailyGoalStatus, row, recipient.at);
  if (current !== undefined && current.stage === stage && !needsRefresh(current.dataAsOf, recipient.at)) return;

  const serverVersion = await nextServerVersion(tx);
  const stamp = { stage, dataAsOf: recipient.at, updatedAt: recipient.at, serverVersion };
  let id: string;
  if (current !== undefined) {
    id = current.id;
    await tx.update(partnerDailyGoalStatus).set(stamp).where(eq(partnerDailyGoalStatus.id, id));
  } else {
    id = randomUUID();
    await tx.insert(partnerDailyGoalStatus).values({
      id,
      couplingId: recipient.couplingId,
      ownerPersonId: recipient.ownerPersonId,
      recipientPersonId: recipient.recipientPersonId,
      localDate: recipient.today,
      generation: await nextGeneration(tx, partnerDailyGoalStatus, and(key, eq(partnerDailyGoalStatus.localDate, recipient.today))),
      createdAt: recipient.at,
      ...stamp,
    });
  }
  await recordChange(tx, { position: serverVersion, entityType: 'partner_daily_goal_status', entityId: id, operation: 'upsert',
    recipientPersonId: recipient.recipientPersonId, createdAt: recipient.at });
}

const needsRefresh = (dataAsOf: Date, at: Date) => at.getTime() - dataAsOf.getTime() >= dataAsOfRefreshMs;

/** Die aktive Kopplung der Person samt Partner, oder `null`. */
async function activeCouplingOf(tx: DbExecutor, personId: string): Promise<{ couplingId: string; partnerPersonId: string } | null> {
  const own = tx
    .select({ couplingId: couplingMember.couplingId })
    .from(couplingMember)
    .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')));
  const [partner] = await tx
    .select({ couplingId: couplingMember.couplingId, personId: couplingMember.personId })
    .from(couplingMember)
    .where(and(inArray(couplingMember.couplingId, own), sql`${couplingMember.personId} <> ${personId}`));
  return partner === undefined ? null : { couplingId: partner.couplingId, partnerPersonId: partner.personId };
}

async function sharingLevels(tx: DbExecutor, ownerPersonId: string, couplingId: string): Promise<ReadonlyMap<string, string>> {
  const rows = await tx
    .select({ area: partnerSharing.area, level: partnerSharing.level })
    .from(partnerSharing)
    .where(and(eq(partnerSharing.ownerPersonId, ownerPersonId), eq(partnerSharing.couplingId, couplingId)));
  return new Map(rows.map((row) => [row.area, row.level]));
}
