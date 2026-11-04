import { and, eq, ne } from 'drizzle-orm';
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

/**
 * Die gemeinsame Aktion einer lokalen Zeile, geprüft am Vertrag; die Umkehrung von `row` im Adapter unten.
 * Bereiche lesen gemeinsame Aktionen nur hierüber, nie über das Spaltenmapping selbst.
 */
export function sharedActionOf(row: typeof sharedAction.$inferSelect): SharedAction {
  return SharedAction.parse({
    id: row.id, couplingId: row.couplingId, requesterPersonId: row.requesterPersonId, type: row.kind,
    payload: row.payload, status: row.status, createdAt: row.createdAt, decidedAt: row.decidedAt,
  });
}

// Gemeinsame Aktion: Die Art steht im Vertrag als `type`, lokal als `kind`. Eine Aktion ändert sich nur
// einmal, mit ihrer Entscheidung; das ist ihr letzter Änderungszeitpunkt.
const sharedActionRows = sqliteEntity({
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
});

/**
 * Höchstens eine offene Rollenwahl je Kopplung, lokal wie in Postgres (`shared_action_open_role_choice_uq`).
 * Das Ergebnis eines eigenen Antrags kann vor dem Pull ankommen, der eine ältere Rollenwahl als beendet
 * meldet; deren lokale Zeile ist dann veraltet. Sie weicht der neueren und kommt mit ihrem Endzustand im
 * nächsten Pull wieder, denn ihre spätere Änderung liegt hinter dem Cursor. Ist umgekehrt die lokal offene
 * Zeile neuer, ist der eingehende Datensatz veraltet und wartet ebenso auf den Pull (#180).
 */
const sharedActionEntity: SyncEntityAdapter<EntityData, SharedAction> = {
  ...sharedActionRows,
  applyCanonical(tx, record) {
    const action = record.data;
    if (action.type === 'rollenwahl' && action.status === 'offen') {
      const db = sqliteOf(tx);
      const others = db
        .select({ id: sharedAction.id, serverVersion: sharedAction.serverVersion })
        .from(sharedAction)
        .where(and(eq(sharedAction.couplingId, action.couplingId), eq(sharedAction.kind, 'rollenwahl'), eq(sharedAction.status, 'offen'), ne(sharedAction.id, record.entityId)))
        .all();
      const incoming = BigInt(record.serverVersion);
      if (others.some((other) => other.serverVersion !== null && BigInt(other.serverVersion) > incoming)) return;
      for (const other of others) db.delete(sharedAction).where(eq(sharedAction.id, other.id)).run();
    }
    sharedActionRows.applyCanonical(tx, record);
  },
};

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
  sharedActionEntity,
];
