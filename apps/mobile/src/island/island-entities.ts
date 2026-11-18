import { IslandProgress } from '@abnehm/contracts/island';
import {
  AreaUnlockRecord,
  BlueprintUnlockRecord,
  CommunityProjectRecord,
  IslandEventRecord,
  IslandFieldRecord,
} from '@abnehm/contracts/island-records';

import { areaUnlock, blueprintUnlock, communityProject, islandEvent, islandField, islandProgress } from '../local-db/schema';
import { serverManagedEntity, sqliteEntity, type SyncEntityAdapter } from '../sync';

// Inselinhalte im App-Sync (Spezifikation 0, Abschnitte 8 und 10; Spezifikation 4, Abschnitt 11): Felder,
// Freischaltungen, Gemeinschaftsprojekte, Ereignisse und der Inselfortschritt. Sie entstehen nur auf dem
// Server (Schlüpfen, später Bauen, Levelaufstieg und Ereigniserzeugung) und kommen per Pull. Felder und
// Freischaltungen sind unveränderlich; eine Löschmarkierung für sie ist ein Integrationsfehler.

const coupled = { ownerField: 'couplingId' } as const;

export const islandSyncEntities: readonly SyncEntityAdapter[] = [
  serverManagedEntity({ entityType: 'island_field', ...coupled, record: IslandFieldRecord, table: islandField }),
  serverManagedEntity({ entityType: 'blueprint_unlock', ...coupled, record: BlueprintUnlockRecord, table: blueprintUnlock }),
  serverManagedEntity({ entityType: 'area_unlock', ...coupled, record: AreaUnlockRecord, table: areaUnlock }),
  serverManagedEntity({ entityType: 'community_project', ...coupled, record: CommunityProjectRecord, table: communityProject }),
  serverManagedEntity({ entityType: 'island_event', ...coupled, record: IslandEventRecord, table: islandEvent }),
  sqliteEntity({
    entityType: 'island_progress',
    ...coupled,
    upsert: null,
    deletable: false,
    record: IslandProgress,
    table: islandProgress,
    // Hälften und Projekt stehen als Inhalt, die Serverversion in der Spalte; geändert wird die Projektion zum Datenstand.
    row: (id, { islandId, couplingId, level, levelNeed, members, activeProject, dataAsOf }) => ({
      id, islandId, couplingId, level, levelNeed, content: { members, activeProject }, dataAsOf, createdAt: dataAsOf, updatedAt: dataAsOf,
    }),
    replay: () => undefined,
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
