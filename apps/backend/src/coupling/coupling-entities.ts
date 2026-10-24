import { inArray } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import { CouplingMemberRecord, CouplingRecord } from '@abnehm/contracts/coupling';
import { IslandRecord, SharedAction } from '@abnehm/contracts/island';
import type { EntityData, SyncEntityType } from '@abnehm/contracts/sync';

import type { ResourceEntity } from '../authorization/authorization.ts';
import { coupling, couplingMember, island, sharedAction } from '../db/schema/index.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';

// Kopplung, Mitglieder, Insel und gemeinsame Aktionen im Sync (Spezifikation 0, Abschnitte 8–10). Sie
// entstehen nur serverseitig (Kopplungsannahme, Fachbefehle gemeinsamer Aktionen, Entkopplungs-Kern);
// der Pull liefert sie den aktiven Mitgliedern, ein generisches Upsert oder Löschen gibt es nicht. Die
// Freigaben, die die Eigentümerin per Upsert ändert, meldet `partner-projections/sharing-entities.ts` an.

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => (value === null ? null : value.toISOString());

type ServerRow = { id: string; serverVersion: bigint; deletedAt: Date | null };

/** Nur lesbare Entität einer Tabelle; Schreiben läuft nie über den generischen Sync. */
function serverManaged<T extends PgTable & { id: AnyPgColumn<{ data: string }> }>(options: {
  entityType: SyncEntityType;
  resource: ResourceEntity;
  table: T;
  record(row: T['$inferSelect']): EntityData;
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
        .where(inArray(options.table.id, [...ids]))) as (T['$inferSelect'] & ServerRow)[];
      return new Map(rows.map((row) => [row.id, { serverVersion: row.serverVersion, deletedAt: row.deletedAt, data: options.record(row) }]));
    },
    async write() {
      throw new Error(`${options.entityType} entsteht nur serverseitig`);
    },
    async remove() {
      throw new Error(`${options.entityType} wird nicht über den Sync gelöscht`);
    },
  };
}

/** Die gemeinsame Aktion einer Zeile in der Form des Vertrags. */
export function sharedActionOf(row: typeof sharedAction.$inferSelect): SharedAction {
  return SharedAction.parse({
    id: row.id,
    couplingId: row.couplingId,
    requesterPersonId: row.requesterPersonId,
    type: row.kind,
    payload: row.payload,
    status: row.status,
    createdAt: iso(row.createdAt),
    decidedAt: isoOrNull(row.decidedAt),
  });
}

/** Gemeinsame Aktion; ändern nur `requestSharedAction`, `decideSharedAction` und der Entkopplungs-Kern. */
export const sharedActionEntity = serverManaged({ entityType: 'shared_action', resource: 'shared_action', table: sharedAction, record: sharedActionOf });

export const couplingSyncEntities: readonly ServerSyncEntity[] = [
  sharedActionEntity,
  serverManaged({
    entityType: 'coupling',
    // Der Datensatz ist der Archivstatus: lesbar für beide Mitglieder, auch nach dem Entkoppeln.
    resource: 'coupling_archive_status',
    table: coupling,
    record: (row) =>
      CouplingRecord.parse({
        personLowId: row.personLowId,
        personHighId: row.personHighId,
        status: row.status,
        startedAt: iso(row.startedAt),
        endedAt: isoOrNull(row.endedAt),
        reactivatedAt: isoOrNull(row.reactivatedAt),
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      }),
  }),
  serverManaged({
    entityType: 'coupling_member',
    resource: 'coupling_member',
    table: couplingMember,
    record: (row) =>
      CouplingMemberRecord.parse({
        couplingId: row.couplingId,
        personId: row.personId,
        role: row.role,
        displayName: row.displayName,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      }),
  }),
  serverManaged({
    entityType: 'island',
    resource: 'island',
    table: island,
    record: (row) =>
      IslandRecord.parse({
        couplingId: row.couplingId,
        state: row.state,
        hatchedAt: isoOrNull(row.hatchedAt),
        timeZone: row.timeZone,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      }),
  }),
];
