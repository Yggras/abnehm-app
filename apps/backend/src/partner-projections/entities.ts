import { inArray } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import { AreaKey, LocalDate } from '@abnehm/contracts/base';
import { partnerSummaryPeriodOf } from '@abnehm/contracts/partner';
import type { EntityData, SyncEntityType } from '@abnehm/contracts/sync';

import { partnerResponse } from '../authorization/authorization.ts';
import type { ResourceEntity } from '../authorization/authorization.ts';
import { partnerDailyGoalStatus, partnerSummary, revocationNotice } from '../db/schema/index.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';

// Partner-Projektionen und Revocation-Notices im Pull (Spezifikation 0, Abschnitte 5 und 10). Sie
// entstehen nur serverseitig; ein generisches Upsert oder Löschen gibt es nicht. Jeder Datensatz läuft
// vor dem Senden durch das geschlossene Vertragsschema (`partnerResponse`), sodass weder Rohdatensatz-IDs
// noch zusätzliche Partnerwerte das Gerät erreichen. Wer ihn lesen darf, entscheidet die Ressourcenregel.

const iso = (value: Date) => value.toISOString();

type Row = { id: string; serverVersion: bigint; deletedAt?: Date | null };

function serverProjected<T extends PgTable & { id: AnyPgColumn<{ data: string }> }>(options: {
  entityType: SyncEntityType;
  resource: ResourceEntity;
  table: T;
  record(row: T['$inferSelect'] & Row): EntityData;
}): ServerSyncEntity {
  return {
    entityType: options.entityType,
    resource: options.resource,
    upsert: null,
    deletable: false,
    async read(tx, ids) {
      if (ids.length === 0) return new Map();
      const rows = (await tx
        .select()
        .from(options.table as PgTable)
        .where(inArray(options.table.id, [...ids]))) as (T['$inferSelect'] & Row)[];
      return new Map(rows.map((row) => [row.id, { serverVersion: row.serverVersion, deletedAt: row.deletedAt ?? null, data: options.record(row) }]));
    },
    async write() {
      throw new Error(`${options.entityType} entsteht nur serverseitig`);
    },
    async remove() {
      throw new Error(`${options.entityType} wird nur serverseitig widerrufen`);
    },
  };
}

export function summaryEnvelope(row: typeof partnerSummary.$inferSelect) {
  const area = AreaKey.parse(row.area);
  return partnerResponse('partner_summary', {
    type: area,
    id: row.id,
    generation: row.generation,
    ownerPersonId: row.ownerPersonId,
    recipientPersonId: row.recipientPersonId,
    couplingId: row.couplingId,
    period: partnerSummaryPeriodOf(area, LocalDate.parse(row.periodFrom), LocalDate.parse(row.periodTo)),
    dataAsOf: iso(row.dataAsOf),
    serverVersion: row.serverVersion.toString(),
    content: row.content,
  });
}

export const partnerProjectionEntities: readonly ServerSyncEntity[] = [
  serverProjected({ entityType: 'partner_summary', resource: 'partner_summary', table: partnerSummary, record: summaryEnvelope }),
  serverProjected({
    entityType: 'partner_daily_goal_status',
    resource: 'partner_daily_goal_status',
    table: partnerDailyGoalStatus,
    record: (row) =>
      partnerResponse('partner_daily_goal_status', {
        id: row.id,
        ownerPersonId: row.ownerPersonId,
        recipientPersonId: row.recipientPersonId,
        couplingId: row.couplingId,
        localDate: row.localDate,
        stage: row.stage,
        dataAsOf: iso(row.dataAsOf),
        serverVersion: row.serverVersion.toString(),
      }),
  }),
  serverProjected({
    entityType: 'revocation_notice',
    resource: 'revocation_notice',
    table: revocationNotice,
    record: (row) =>
      partnerResponse('revocation_notice', {
        id: row.id,
        recipientPersonId: row.recipientPersonId,
        couplingId: row.couplingId,
        target: row.targetType === 'kopplung' ? { type: 'kopplung' } : { type: row.targetType, projectionId: row.projectionId },
        reason: row.reason,
        serverVersion: row.serverVersion.toString(),
      }),
  }),
];
