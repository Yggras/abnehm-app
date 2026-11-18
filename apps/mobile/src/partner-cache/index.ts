import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';

import { AreaKey, DisplayName, EntityId, LocalDate } from '@abnehm/contracts/base';
import {
  PartnerDailyGoalStatus,
  partnerSummaryBounds,
  PartnerSummaryEnvelope,
  partnerSummaryPeriodOf,
  RevocationNotice,
} from '@abnehm/contracts/partner';

import type { ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { coupling, couplingMember, partnerDailyGoalStatus, partnerSummary } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { CanonicalEntity, SyncEntityAdapter } from '../sync/registry';

// Widerrufbarer Partnercache der App (Spezifikation 0, Abschnitte 5 und 8). Partner-Zusammenfassungen
// und der grobe Tageszielstand kommen nur als serverseitige Projektionen per Pull; fremde
// Gesundheits-Rohdaten werden nie repliziert. Eine Löschmarkierung oder Revocation-Notice löscht den
// alten Inhalt in derselben Transaktion, in der die Pull-Seite übernommen wird. „Wir“ und „Heute“
// (Spezifikation 5) lesen den Partner ausschließlich über `readPartnerCache`.

type CacheTable = typeof partnerSummary | typeof partnerDailyGoalStatus;

function localVersion(tx: TransactionContext, table: CacheTable, entityId: EntityId) {
  return sqliteOf(tx).select({ serverVersion: table.serverVersion }).from(table).where(eq(table.id, entityId)).get()?.serverVersion;
}

/** Nur lesbarer Cacheeintrag: übernimmt neuere Stände, löscht ihn bei einer Löschmarkierung ganz. */
function cacheEntity<R extends PartnerSummaryEnvelope | PartnerDailyGoalStatus>(options: {
  entityType: 'partner_summary' | 'partner_daily_goal_status';
  table: CacheTable;
  record: { parse(data: unknown): R };
  row(record: R): typeof partnerSummary.$inferInsert | typeof partnerDailyGoalStatus.$inferInsert;
}): SyncEntityAdapter {
  const { table } = options;
  return {
    entityType: options.entityType,
    ownerField: 'ownerPersonId',
    upsert: null,
    deletable: false,
    record: options.record as SyncEntityAdapter['record'],
    applyCanonical(tx, { serverVersion, data }: CanonicalEntity<Record<string, unknown>>) {
      const record = options.record.parse(data);
      const local = localVersion(tx, table, record.id);
      if (local != null && BigInt(local) > BigInt(serverVersion)) return;
      const row = { ...options.row(record), serverVersion, deletedAt: null };
      sqliteOf(tx)
        .insert(table)
        .values(row as never)
        .onConflictDoUpdate({ target: table.id, set: row as never })
        .run();
    },
    applyTombstone(tx, tombstone) {
      sqliteOf(tx).delete(table).where(eq(table.id, tombstone.entityId)).run();
    },
    reconcileRejected() {
      throw new Error(`${options.entityType} hat keine lokalen Operationen`);
    },
  };
}

const summaryEntity = cacheEntity({
  entityType: 'partner_summary',
  table: partnerSummary,
  record: PartnerSummaryEnvelope,
  row: (summary) => ({
    id: summary.id,
    couplingId: summary.couplingId,
    ownerPersonId: summary.ownerPersonId,
    recipientPersonId: summary.recipientPersonId,
    area: summary.type,
    periodFrom: partnerSummaryBounds(summary.period).from,
    periodTo: partnerSummaryBounds(summary.period).to,
    generation: summary.generation,
    content: summary.content,
    dataAsOf: summary.dataAsOf,
    createdAt: summary.dataAsOf,
    updatedAt: summary.dataAsOf,
  }),
});

const statusEntity = cacheEntity({
  entityType: 'partner_daily_goal_status',
  table: partnerDailyGoalStatus,
  record: PartnerDailyGoalStatus,
  // Die Generation trennt nur serverseitig gelöschte Fassungen; das Gerät hält je Stand genau eine Zeile.
  row: (status) => ({
    id: status.id,
    couplingId: status.couplingId,
    ownerPersonId: status.ownerPersonId,
    recipientPersonId: status.recipientPersonId,
    localDate: status.localDate,
    generation: 1,
    stage: status.stage,
    dataAsOf: status.dataAsOf,
    createdAt: status.dataAsOf,
    updatedAt: status.dataAsOf,
  }),
});

/** Revocation-Notice: wird nicht gespeichert, sondern löscht den betroffenen Cache in derselben Transaktion. */
const revocationNoticeEntity: SyncEntityAdapter = {
  entityType: 'revocation_notice',
  ownerField: 'recipientPersonId',
  upsert: null,
  deletable: false,
  record: RevocationNotice as unknown as SyncEntityAdapter['record'],
  applyCanonical(tx, { data }) {
    const notice = RevocationNotice.parse(data);
    const db = sqliteOf(tx);
    switch (notice.target.type) {
      case 'partner_summary':
        db.delete(partnerSummary).where(eq(partnerSummary.id, notice.target.projectionId)).run();
        return;
      case 'partner_daily_goal_status':
        db.delete(partnerDailyGoalStatus).where(eq(partnerDailyGoalStatus.id, notice.target.projectionId)).run();
        return;
      case 'kopplung':
        db.delete(partnerSummary).where(eq(partnerSummary.couplingId, notice.couplingId)).run();
        db.delete(partnerDailyGoalStatus).where(eq(partnerDailyGoalStatus.couplingId, notice.couplingId)).run();
    }
  },
  // Notices sind unveränderlich; eine Löschmarkierung gibt es für sie nicht.
  applyTombstone: () => undefined,
  reconcileRejected() {
    throw new Error('revocation_notice hat keine lokalen Operationen');
  },
};

export const partnerCacheEntities: readonly SyncEntityAdapter[] = [summaryEntity, statusEntity, revocationNoticeEntity];

export type PartnerCache = Readonly<{
  /**
   * Der Partner der aktiven Kopplung; `null` ohne aktive Kopplung (solo). Der Anzeigename kommt ausschließlich
   * vom Kopplungsmitglied, das der Server pflegt (Spezifikation 0, Abschnitt 8).
   */
  partner: Readonly<{ personId: EntityId; displayName: DisplayName }> | null;
  /** Grober Tageszielstand des Partners; bei jeder aktiven Kopplung, ohne Bereichsfreigabe. */
  dailyGoalStatus: PartnerDailyGoalStatus | null;
  /** Je freigegebenem Bereich die aktuelle Zusammenfassung, in der Reihenfolge Ernährung, Wasser, Sport, Gewicht. */
  summaries: readonly PartnerSummaryEnvelope[];
}>;

/** Was die Person über ihren Partner sehen darf, aus dem Cache ihrer aktiven Kopplung. */
export function readPartnerCache(tx: ReadContext): PartnerCache {
  const db = sqliteOf(tx);
  const active = db.select({ id: coupling.id }).from(coupling).where(eq(coupling.status, 'aktiv'));
  const own = readOwnPerson(tx);
  const member = own === undefined ? undefined : db
    .select({ personId: couplingMember.personId, displayName: couplingMember.displayName })
    .from(couplingMember)
    .where(and(inArray(couplingMember.couplingId, active), ne(couplingMember.personId, own.id), isNull(couplingMember.deletedAt)))
    .get();
  const status = db
    .select()
    .from(partnerDailyGoalStatus)
    .where(and(inArray(partnerDailyGoalStatus.couplingId, active), isNull(partnerDailyGoalStatus.deletedAt)))
    .orderBy(asc(partnerDailyGoalStatus.localDate))
    .all()
    .at(-1);
  const rows = db
    .select()
    .from(partnerSummary)
    .where(and(inArray(partnerSummary.couplingId, active), isNull(partnerSummary.deletedAt)))
    .orderBy(asc(partnerSummary.periodFrom))
    .all();
  // Je Bereich der jüngste Zeitraum; ältere verschwinden spätestens mit der nächsten Pull-Seite.
  const newest = new Map(rows.map((row) => [row.area, row]));
  return {
    partner: member === undefined ? null : { personId: EntityId.parse(member.personId), displayName: DisplayName.parse(member.displayName) },
    dailyGoalStatus: status === undefined ? null : PartnerDailyGoalStatus.parse({
      id: status.id,
      ownerPersonId: status.ownerPersonId,
      recipientPersonId: status.recipientPersonId,
      couplingId: status.couplingId,
      localDate: status.localDate,
      stage: status.stage,
      dataAsOf: status.dataAsOf,
      serverVersion: status.serverVersion,
    }),
    summaries: AreaKey.options.flatMap((area) => {
      const row = newest.get(area);
      return row === undefined ? [] : [PartnerSummaryEnvelope.parse({
        type: area,
        id: row.id,
        generation: row.generation,
        ownerPersonId: row.ownerPersonId,
        recipientPersonId: row.recipientPersonId,
        couplingId: row.couplingId,
        period: partnerSummaryPeriodOf(area, LocalDate.parse(row.periodFrom), LocalDate.parse(row.periodTo)),
        dataAsOf: row.dataAsOf,
        serverVersion: row.serverVersion,
        content: row.content,
      })];
    }),
  };
}
