import { CouplingMemberRecord, CouplingRecord } from '@abnehm/contracts/coupling';
import { IslandRecord, SharedAction } from '@abnehm/contracts/island';

import { coupling, couplingMember, island, sharedAction } from '../db/schema/index.ts';
import { iso, isoOrNull, serverManaged, type ServerSyncEntity } from '../sync/registry.ts';

// Kopplung, Mitglieder, Insel und gemeinsame Aktionen im Sync (Spezifikation 0, Abschnitte 8–10). Sie
// entstehen nur serverseitig (Kopplungsannahme, Fachbefehle gemeinsamer Aktionen, Entkopplungs-Kern);
// der Pull liefert sie den aktiven Mitgliedern, ein generisches Upsert oder Löschen gibt es nicht. Die
// Freigaben, die die Eigentümerin per Upsert ändert, meldet `partner-projections/sharing-entities.ts` an.


/** Die gemeinsame Aktion einer Zeile in der Form des Vertrags. */
function sharedActionRecord(row: typeof sharedAction.$inferSelect): SharedAction {
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
export const sharedActionEntity = serverManaged({ entityType: 'shared_action', resource: 'shared_action', table: sharedAction, record: sharedActionRecord });

/** Die Kopplung ist zugleich ihr Archivstatus: lesbar und im Pull für beide Mitglieder, auch nach dem Entkoppeln. */
export const couplingEntity = serverManaged({
  entityType: 'coupling',
  resource: 'coupling_archive_status',
  archiveStatus: true,
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
});

export const couplingSyncEntities: readonly ServerSyncEntity[] = [
  couplingEntity,
  sharedActionEntity,
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
