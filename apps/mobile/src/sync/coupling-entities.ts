import { eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';

import type { EntityId } from '@abnehm/contracts/base';
import { CouplingMemberRecord, CouplingRecord } from '@abnehm/contracts/coupling';
import { IslandRecord, SharedAction } from '@abnehm/contracts/island';
import type { EntityData, SyncEntityType } from '@abnehm/contracts/sync';

import type { TransactionContext } from '../local-db';
import { coupling, couplingMember, island, sharedAction } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { SyncEntityAdapter } from './registry';
import { sqliteEntity } from './sqlite-entity';

// Kopplung, Mitglieder, Insel und gemeinsame Aktionen im App-Sync (Spezifikation 0, Abschnitte 8–10).
// Sie entstehen nur auf dem Server und kommen per Pull; ein generisches Upsert oder Löschen gibt es
// nicht, deshalb auch keine offenen Operationen, die erneut anzuwenden wären. Nach einer Entkopplung
// kommt nur noch die archivierte Kopplung; Mitglieder samt Anzeigenamen bleiben lokal erhalten. Die
// Freigaben stehen in `sharing-entities.ts`.

type SyncedTable = Parameters<typeof sqliteEntity>[0]['table'];

/** Nur lesbare Entität: Die Zeile ist der kanonische Datensatz samt ID, ergänzt um gespiegelte Spalten. */
function serverManaged<T extends SyncedTable & SQLiteTable, R extends EntityData>(options: {
  entityType: SyncEntityType;
  /** Feld mit der Eigentumsgrenze; es setzt nur der Server. */
  ownerField: string;
  record: z.ZodType<R>;
  table: T;
  mirrored?: (data: R, tx: TransactionContext) => Partial<T['$inferInsert']>;
}): SyncEntityAdapter {
  return sqliteEntity({
    entityType: options.entityType,
    ownerField: options.ownerField,
    upsert: null,
    deletable: false,
    record: options.record,
    table: options.table,
    row: (id: EntityId, data: R, tx: TransactionContext) => ({ id, ...data, ...options.mirrored?.(data, tx) }) as T['$inferInsert'],
    replay: () => undefined,
  });
}

export const couplingSyncEntities: readonly SyncEntityAdapter[] = [
  // Die Kopplung ist selbst die Eigentumsgrenze; ihr Paar setzt nur der Server.
  serverManaged({ entityType: 'coupling', ownerField: 'personLowId', record: CouplingRecord, table: coupling }),
  serverManaged({
    entityType: 'coupling_member',
    ownerField: 'couplingId',
    record: CouplingMemberRecord,
    table: couplingMember,
    // Den Status spiegelt das Mitglied von seiner Kopplung; der Pull liefert sie mit kleinerer Position zuerst.
    mirrored(data, tx) {
      const parent = sqliteOf(tx).select({ status: coupling.status }).from(coupling).where(eq(coupling.id, data.couplingId)).get();
      if (parent === undefined) throw new Error('Kopplungsmitglied ohne lokale Kopplung');
      return { couplingStatus: parent.status };
    },
  }),
  serverManaged({ entityType: 'island', ownerField: 'couplingId', record: IslandRecord, table: island }),
  // Gemeinsame Aktion: Die Art steht im Vertrag als `type`, lokal als `kind`. Eine Aktion ändert sich nur
  // einmal, mit ihrer Entscheidung; das ist ihr letzter Änderungszeitpunkt.
  sqliteEntity({
    entityType: 'shared_action',
    ownerField: 'couplingId',
    upsert: null,
    deletable: false,
    record: SharedAction,
    table: sharedAction,
    row: (id: EntityId, { type, decidedAt, createdAt, ...data }: SharedAction) => ({
      ...data,
      id,
      kind: type,
      decidedAt,
      createdAt,
      updatedAt: decidedAt ?? createdAt,
    }),
    replay: () => undefined,
  }),
];
