import { and, asc, eq, isNull } from 'drizzle-orm';

import { ServerVersion, type AreaKey } from '@abnehm/contracts/base';
import { revocationNoticeId, type RevocationNotice } from '@abnehm/contracts/partner';

import type { DbExecutor } from '../database.ts';
import { couplingMember, partnerDailyGoalStatus, partnerSummary, revocationNotice } from '../db/schema/index.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';

// Widerruf von Partner-Projektionen (Spezifikation 0, Abschnitt 5). Abschalten einer Freigabe und
// Entkoppeln beenden den Inhaltszugriff in derselben Transaktion: Die Projektion wird zur Löschmarkierung
// und der frühere Empfänger erhält eine adressierte, inhaltsfreie Revocation-Notice. Beides bleibt für
// ihn auch nach dem Rechteentzug abrufbar, damit sein Gerät den alten Cache löscht. Eine gelöschte
// Projektion wird nie wiederbelebt; eine erneute Freigabe erzeugt eine neue ID und Generation.
// Projektionen und Empfänger werden in fester Reihenfolge widerrufen, und die ID einer Notice folgt aus
// ihrer Serverversion. Derselbe Ausgangszustand ergibt so exakt denselben Widerruf (Seed-Sollzustand, #117).

type ProjectionTable = typeof partnerSummary | typeof partnerDailyGoalStatus;
type ProjectionRow = { id: string; recipientPersonId: string };

const entityTypeOf = (table: ProjectionTable) => (table === partnerSummary ? 'partner_summary' : 'partner_daily_goal_status');

/** Macht eine Projektion zur Löschmarkierung; der Empfänger erhält sie im nächsten Pull. */
export async function tombstoneProjection(tx: DbExecutor, table: ProjectionTable, row: ProjectionRow, at: Date): Promise<void> {
  const serverVersion = await nextServerVersion(tx);
  await tx.update(table).set({ deletedAt: at, updatedAt: at, serverVersion }).where(eq(table.id, row.id));
  await recordChange(tx, {
    position: serverVersion,
    entityType: entityTypeOf(table),
    entityId: row.id,
    operation: 'delete',
    recipientPersonId: row.recipientPersonId,
    createdAt: at,
  });
}

/** Freigabe eines Bereichs abgeschaltet: Die Zusammenfassungen dieses Bereichs enden für ihren Empfänger. */
export async function revokeSummaries(
  tx: DbExecutor,
  { ownerPersonId, couplingId, area }: { ownerPersonId: string; couplingId: string; area: AreaKey },
  at: Date,
): Promise<void> {
  const live = await tx
    .select({ id: partnerSummary.id, recipientPersonId: partnerSummary.recipientPersonId })
    .from(partnerSummary)
    .where(
      and(
        eq(partnerSummary.ownerPersonId, ownerPersonId),
        eq(partnerSummary.couplingId, couplingId),
        eq(partnerSummary.area, area),
        isNull(partnerSummary.deletedAt),
      ),
    )
    .orderBy(asc(partnerSummary.id));
  for (const row of live) {
    await tombstoneProjection(tx, partnerSummary, row, at);
    await addNotice(tx, { recipientPersonId: row.recipientPersonId, couplingId, target: { type: 'partner_summary', projectionId: row.id }, reason: 'freigabe_entzogen' }, at);
  }
}

/**
 * Entkopplung: Alle Projektionen der Kopplung enden, und beide früheren Mitglieder erhalten eine
 * Notice für die ganze Kopplung. Aufgerufen in der Transaktion, die die Kopplung archiviert.
 */
export async function revokeCoupling(tx: DbExecutor, couplingId: string, at: Date): Promise<void> {
  for (const table of [partnerSummary, partnerDailyGoalStatus] as const) {
    const live = await tx
      .select({ id: table.id, recipientPersonId: table.recipientPersonId })
      .from(table)
      .where(and(eq(table.couplingId, couplingId), isNull(table.deletedAt)))
      .orderBy(asc(table.id));
    for (const row of live) await tombstoneProjection(tx, table, row, at);
  }
  const members = await tx
    .select({ personId: couplingMember.personId })
    .from(couplingMember)
    .where(eq(couplingMember.couplingId, couplingId))
    .orderBy(asc(couplingMember.personId));
  for (const member of members) {
    await addNotice(tx, { recipientPersonId: member.personId, couplingId, target: { type: 'kopplung' }, reason: 'entkopplung' }, at);
  }
}

type Notice = Readonly<{
  recipientPersonId: string;
  couplingId: string;
  target: { type: Exclude<RevocationNotice['target']['type'], 'kopplung'>; projectionId: string } | { type: 'kopplung' };
  reason: RevocationNotice['reason'];
}>;

async function addNotice(tx: DbExecutor, notice: Notice, at: Date): Promise<void> {
  const serverVersion = await nextServerVersion(tx);
  const id = revocationNoticeId(ServerVersion.parse(serverVersion.toString()));
  await tx.insert(revocationNotice).values({
    id,
    recipientPersonId: notice.recipientPersonId,
    couplingId: notice.couplingId,
    targetType: notice.target.type,
    projectionId: notice.target.type === 'kopplung' ? null : notice.target.projectionId,
    reason: notice.reason,
    createdAt: at,
    serverVersion,
  });
  await recordChange(tx, {
    position: serverVersion,
    entityType: 'revocation_notice',
    entityId: id,
    operation: 'upsert',
    recipientPersonId: notice.recipientPersonId,
    createdAt: at,
  });
}
