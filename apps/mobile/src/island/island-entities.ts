import { eq } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';

import type { EntityId, ServerVersion } from '@abnehm/contracts/base';
import { IslandProgress } from '@abnehm/contracts/island';
import {
  AreaUnlockRecord,
  BlueprintUnlockRecord,
  CommunityProjectRecord,
  IslandEventRecord,
  IslandFieldRecord,
} from '@abnehm/contracts/island-records';
import type { EntityData, SyncEntityType } from '@abnehm/contracts/sync';

import { areaUnlock, blueprintUnlock, communityProject, islandEvent, islandField, islandProgress } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { SyncEntityAdapter } from '../sync/registry';

// Inselinhalte im App-Sync (Spezifikation 0, Abschnitte 8 und 10; Spezifikation 4, Abschnitt 11): Felder,
// Freischaltungen, Gemeinschaftsprojekte, Ereignisse und der Inselfortschritt. Sie entstehen nur auf dem
// Server (Schlüpfen, später Bauen, Levelaufstieg und Ereigniserzeugung) und kommen per Pull. Ein
// generisches Upsert oder Löschen gibt es nicht, deshalb auch keine offenen Operationen, die erneut
// anzuwenden wären; eine Löschmarkierung schickt der Server für sie nicht.

type ServerRecordColumns = { id: AnySQLiteColumn<{ data: string }>; serverVersion: AnySQLiteColumn<{ data: string | null }> };

/** Nur lesbare Entität: Die Zeile ist der kanonische Datensatz samt ID; eine neuere lokale Version bleibt. */
function serverRecords<T extends SQLiteTable & ServerRecordColumns, R extends EntityData>(options: {
  entityType: SyncEntityType;
  record: z.ZodType<R>;
  table: T;
  row(id: EntityId, data: R): Omit<T['$inferInsert'], 'serverVersion'>;
}): SyncEntityAdapter<never, R> {
  const { table, entityType } = options;
  return {
    entityType,
    ownerField: 'couplingId',
    upsert: null,
    deletable: false,
    record: options.record,
    applyCanonical(tx, { entityId, serverVersion, data }) {
      const local = sqliteOf(tx).select({ serverVersion: table.serverVersion }).from(table as SQLiteTable).where(eq(table.id, entityId)).get() as
        | { serverVersion: ServerVersion | null }
        | undefined;
      if (local?.serverVersion != null && BigInt(local.serverVersion) > BigInt(serverVersion)) return;
      const row = { ...options.row(entityId, data), serverVersion };
      sqliteOf(tx)
        .insert(table)
        .values(row as never)
        .onConflictDoUpdate({ target: table.id, set: row as never })
        .run();
    },
    applyTombstone() {
      throw new Error(`${entityType} wird nicht über den Sync gelöscht`);
    },
    reconcileRejected() {
      throw new Error(`${entityType} entsteht nur auf dem Server`);
    },
  };
}

export const islandSyncEntities: readonly SyncEntityAdapter[] = [
  serverRecords({ entityType: 'island_field', record: IslandFieldRecord, table: islandField, row: (id, data) => ({ id, ...data }) }),
  serverRecords({ entityType: 'blueprint_unlock', record: BlueprintUnlockRecord, table: blueprintUnlock, row: (id, data) => ({ id, ...data }) }),
  serverRecords({ entityType: 'area_unlock', record: AreaUnlockRecord, table: areaUnlock, row: (id, data) => ({ id, ...data }) }),
  serverRecords({ entityType: 'community_project', record: CommunityProjectRecord, table: communityProject, row: (id, data) => ({ id, ...data, deletedAt: null }) }),
  serverRecords({ entityType: 'island_event', record: IslandEventRecord, table: islandEvent, row: (id, data) => ({ id, ...data, deletedAt: null }) }),
  serverRecords({
    entityType: 'island_progress',
    record: IslandProgress,
    table: islandProgress,
    // Hälften und Projekt stehen als Inhalt, die Serverversion in der Spalte; geändert wird die Projektion zum Datenstand.
    row: (id, { islandId, couplingId, level, levelNeed, members, activeProject, dataAsOf }) => ({
      id, islandId, couplingId, level, levelNeed, content: { members, activeProject }, dataAsOf, createdAt: dataAsOf, updatedAt: dataAsOf, deletedAt: null,
    }),
  }),
];

/** Der Inselfortschritt einer lokalen Zeile, geprüft am Vertrag; die Umkehrung von `row` oben. */
export function islandProgressOf(row: typeof islandProgress.$inferSelect): IslandProgress {
  if (row.serverVersion === null) throw new Error('Inselfortschritt ohne Serverversion');
  return IslandProgress.parse({
    islandId: row.islandId, couplingId: row.couplingId, level: row.level, levelNeed: row.levelNeed, ...row.content,
    dataAsOf: row.dataAsOf, serverVersion: row.serverVersion,
  });
}
