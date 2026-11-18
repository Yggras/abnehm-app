import {
  AreaUnlockRecord,
  BlueprintUnlockRecord,
  CommunityProjectRecord,
  IslandEventRecord,
  IslandFieldRecord,
} from '@abnehm/contracts/island-records';

import { areaUnlock, blueprintUnlock, communityProject, islandEvent, islandField, islandProgress } from '../db/schema/index.ts';
import { iso, isoOrNull, serverManaged, type ServerSyncEntity } from '../sync/registry.ts';
import { islandProgressRecord } from './progress-projector.ts';

// Inselinhalte im Sync (Spezifikation 0, Abschnitte 8 und 10; Spezifikation 4, Abschnitt 11): Felder,
// Freischaltungen, Gemeinschaftsprojekte, Ereignisse und der Inselfortschritt. Sie gehören der Kopplung,
// entstehen nur serverseitig (Schlüpfen, später Bauen, Levelaufstieg und Ereigniserzeugung) und kommen
// per Pull zu beiden aktiven Mitgliedern; ein generisches Upsert oder Löschen gibt es nicht.

const owned = (row: { islandId: string; couplingId: string }) => ({ islandId: row.islandId, couplingId: row.couplingId });

export const islandSyncEntities: readonly ServerSyncEntity[] = [
  serverManaged({
    entityType: 'island_field',
    resource: 'island_field',
    table: islandField,
    record: (row) => IslandFieldRecord.parse({ ...owned(row), fieldKey: row.fieldKey, ownerPersonId: row.ownerPersonId, createdAt: iso(row.createdAt) }),
  }),
  serverManaged({
    entityType: 'blueprint_unlock',
    resource: 'blueprint_unlock',
    table: blueprintUnlock,
    record: (row) =>
      BlueprintUnlockRecord.parse({ ...owned(row), catalogKey: row.catalogKey, reason: row.reason, unlockedAt: iso(row.unlockedAt), createdAt: iso(row.createdAt) }),
  }),
  serverManaged({
    entityType: 'area_unlock',
    resource: 'area_unlock',
    table: areaUnlock,
    record: (row) => AreaUnlockRecord.parse({ ...owned(row), areaKey: row.areaKey, level: row.level, unlockedAt: iso(row.unlockedAt), createdAt: iso(row.createdAt) }),
  }),
  serverManaged({
    entityType: 'community_project',
    resource: 'community_project',
    table: communityProject,
    record: (row) =>
      CommunityProjectRecord.parse({
        ...owned(row),
        sequenceNumber: row.sequenceNumber,
        templateKey: row.templateKey,
        buildNeed: row.buildNeed,
        natureNeed: row.natureNeed,
        status: row.status,
        completedAt: isoOrNull(row.completedAt),
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      }),
  }),
  serverManaged({
    entityType: 'island_event',
    resource: 'island_event',
    table: islandEvent,
    record: (row) =>
      IslandEventRecord.parse({
        ...owned(row),
        type: row.type,
        templateKey: row.templateKey,
        responsiblePersonId: row.responsiblePersonId,
        occasionKey: row.occasionKey,
        status: row.status,
        reward: row.reward,
        occurredAt: iso(row.occurredAt),
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      }),
  }),
  // Lesbar nur für aktive Mitglieder (Regel `inselfortschritt`); die Zeile kennt nur Felder des Vertrags.
  serverManaged({ entityType: 'island_progress', resource: 'island_progress', table: islandProgress, record: islandProgressRecord }),
];
