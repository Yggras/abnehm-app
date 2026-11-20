import {
  AreaUnlockRecord,
  BlueprintUnlockRecord,
  CommunityProjectRecord,
  IslandEventRecord,
  IslandEventStateRecord,
  IslandFieldRecord,
  IslandObjectRecord,
} from '@abnehm/contracts/island-records';

import { areaUnlock, blueprintUnlock, communityProject, islandEvent, islandEventState, islandField, islandObject, islandProgress } from '../db/schema/index.ts';
import { iso, isoOrNull, serverManaged, type ServerSyncEntity } from '../sync/registry.ts';
import { islandProgressRecord } from './progress-projector.ts';

// Inselinhalte im Sync (Spezifikation 0, Abschnitte 8 und 10; Spezifikation 4, Abschnitt 11): Felder,
// Objekte, Freischaltungen, Gemeinschaftsprojekte, Ereignisse und der Inselfortschritt. Sie gehören der Kopplung,
// entstehen nur serverseitig (Schlüpfen, später Bauen, Levelaufstieg und Ereigniserzeugung) und kommen
// per Pull zu beiden aktiven Mitgliedern; ein generisches Upsert oder Löschen gibt es nicht.

const owned = (row: { islandId: string; couplingId: string }) => ({ islandId: row.islandId, couplingId: row.couplingId });

/** Inselobjekt: entsteht nur in Fachbefehlen wie `buildObject` (#191), beide Mitglieder sehen es. */
export const islandObjectEntity = serverManaged({
  entityType: 'island_object',
  resource: 'island_object',
  table: islandObject,
  record: (row) =>
    IslandObjectRecord.parse({
      ...owned(row),
      ownerPersonId: row.ownerPersonId,
      catalogKey: row.catalogKey,
      origin: row.origin,
      level: row.level,
      fieldId: row.fieldId,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }),
});

/** Inselfortschritt: lesbar nur für aktive Mitglieder (Regel `inselfortschritt`); die Zeile kennt nur Felder des Vertrags. */
export const islandProgressEntity = serverManaged({ entityType: 'island_progress', resource: 'island_progress', table: islandProgress, record: islandProgressRecord });

/** Insel-Ereignis: entsteht beim Schlüpfen, beim Levelaufstieg und im Ereignisgenerator (#202). */
export const islandEventEntity = serverManaged({
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
});

/**
 * Ereignisstand je Person (#202): legt der Ereignisgenerator an, ändern nur `markEventsSeen` und
 * `claimEventReward`. Lesbar nur für die eigene Person in einer aktiven Kopplung.
 */
export const islandEventStateEntity = serverManaged({
  entityType: 'island_event_state',
  resource: 'island_event_state',
  table: islandEventState,
  record: (row) =>
    IslandEventStateRecord.parse({
      islandEventId: row.islandEventId,
      personId: row.personId,
      seenAt: isoOrNull(row.seenAt),
      claimedAt: isoOrNull(row.claimedAt),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    }),
});

/** Bauplanfreischaltung: beim Schlüpfen, beim Levelaufstieg und als Belohnung eines Besuchers (#202). */
export const blueprintUnlockEntity = serverManaged({
  entityType: 'blueprint_unlock',
  resource: 'blueprint_unlock',
  table: blueprintUnlock,
  record: (row) =>
    BlueprintUnlockRecord.parse({ ...owned(row), catalogKey: row.catalogKey, reason: row.reason, unlockedAt: iso(row.unlockedAt), createdAt: iso(row.createdAt) }),
});

export const islandFieldEntity = serverManaged({
  entityType: 'island_field',
  resource: 'island_field',
  table: islandField,
  record: (row) => IslandFieldRecord.parse({ ...owned(row), fieldKey: row.fieldKey, ownerPersonId: row.ownerPersonId, createdAt: iso(row.createdAt) }),
});

export const areaUnlockEntity = serverManaged({
  entityType: 'area_unlock',
  resource: 'area_unlock',
  table: areaUnlock,
  record: (row) => AreaUnlockRecord.parse({ ...owned(row), areaKey: row.areaKey, level: row.level, unlockedAt: iso(row.unlockedAt), createdAt: iso(row.createdAt) }),
});

export const islandSyncEntities: readonly ServerSyncEntity[] = [
  islandFieldEntity,
  blueprintUnlockEntity,
  areaUnlockEntity,
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
  islandEventEntity,
  islandEventStateEntity,
  islandObjectEntity,
  islandProgressEntity,
];
