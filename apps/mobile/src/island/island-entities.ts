import { and, eq, isNull, ne } from 'drizzle-orm';

import { IslandProgress } from '@abnehm/contracts/island';
import {
  AreaUnlockRecord,
  BlueprintUnlockRecord,
  CommunityProjectRecord,
  IslandEventRecord,
  IslandEventStateRecord,
  IslandFieldRecord,
  IslandObjectRecord,
  ProjectContributionRecord,
} from '@abnehm/contracts/island-records';

import { areaUnlock, blueprintUnlock, communityProject, islandEvent, islandEventState, islandField, islandObject, islandProgress, projectContribution } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { serverManagedEntity, sqliteEntity, type SyncEntityAdapter } from '../sync';

// Inselinhalte im App-Sync (Spezifikation 0, Abschnitte 8 und 10; Spezifikation 4, Abschnitt 11): Felder,
// Objekte, Freischaltungen, Gemeinschaftsprojekte, Ereignisse und der Inselfortschritt. Sie entstehen auf
// dem Server (Schlüpfen, Bauen, später Levelaufstieg und Ereigniserzeugung) und kommen per Pull. Nur ein
// eigenes gebautes Objekt legt das Gerät vorab an (`build-object.ts`); der kanonische Datensatz ersetzt es.
// Felder und Freischaltungen sind unveränderlich; eine Löschmarkierung für sie ist ein Integrationsfehler.

const coupled = { ownerField: 'couplingId' } as const;

const objectEntity = serverManagedEntity({ entityType: 'island_object', ...coupled, record: IslandObjectRecord, table: islandObject });

/**
 * Inselobjekte mit derselben Feldregel wie auf dem Server (`field-occupancy.ts` im Backend, #194): Ein Feld
 * trägt höchstens ein Objekt. Kommt ein Objekt auf ein Feld, auf dem lokal noch ein anderes steht, wechselt
 * dieses ins Lager. Sonst bräche der Unique-Index der Feldbelegung, etwa wenn ein Pull das Objekt eines
 * anderen eigenen Geräts bringt, bevor die eigene Änderung des älteren Objekts gesichert ist. Der Server
 * entscheidet in Eingangsreihenfolge genauso; sein kanonischer Stand folgt mit dem nächsten Sync.
 */
const islandObjectEntity: typeof objectEntity = {
  ...objectEntity,
  applyCanonical(tx, record) {
    const { fieldId } = record.data;
    if (fieldId !== null) {
      sqliteOf(tx)
        .update(islandObject)
        .set({ fieldId: null })
        .where(and(eq(islandObject.fieldId, fieldId), ne(islandObject.id, record.entityId)))
        .run();
    }
    objectEntity.applyCanonical(tx, record);
  },
};

const unlockEntity = serverManagedEntity({ entityType: 'blueprint_unlock', ...coupled, record: BlueprintUnlockRecord, table: blueprintUnlock });

/**
 * Bauplanfreischaltungen; je Insel ist ein Bauplan höchstens einmal freigeschaltet. Eine vorläufig
 * abgeholte Besucher-Belohnung (#202) steht lokal unbestätigt mit eigener ID; schaltet der Server denselben
 * Bauplan anders frei, etwa über den Besuch der Partnerin, weicht die unbestätigte Zeile.
 */
const blueprintUnlockEntity: typeof unlockEntity = {
  ...unlockEntity,
  applyCanonical(tx, record) {
    sqliteOf(tx)
      .delete(blueprintUnlock)
      .where(and(eq(blueprintUnlock.islandId, record.data.islandId), eq(blueprintUnlock.catalogKey, record.data.catalogKey), ne(blueprintUnlock.id, record.entityId), isNull(blueprintUnlock.serverVersion)))
      .run();
    unlockEntity.applyCanonical(tx, record);
  },
};

export const islandSyncEntities: readonly SyncEntityAdapter[] = [
  serverManagedEntity({ entityType: 'island_field', ...coupled, record: IslandFieldRecord, table: islandField }),
  islandObjectEntity,
  blueprintUnlockEntity,
  serverManagedEntity({ entityType: 'area_unlock', ...coupled, record: AreaUnlockRecord, table: areaUnlock }),
  serverManagedEntity({ entityType: 'community_project', ...coupled, record: CommunityProjectRecord, table: communityProject }),
  // Eigene Projekteinzahlungen (#208): nur die eigenen kommen per Pull; lokal vorab legt sie `contributeToProject` an.
  serverManagedEntity({ entityType: 'project_contribution', ownerField: 'personId', record: ProjectContributionRecord, table: projectContribution }),
  serverManagedEntity({ entityType: 'island_event', ...coupled, record: IslandEventRecord, table: islandEvent }),
  // Ereignisstand je Person (#202): nur der eigene kommt per Pull; ändern nur `markEventsSeen` und `claimEventReward`.
  serverManagedEntity({ entityType: 'island_event_state', ownerField: 'personId', record: IslandEventStateRecord, table: islandEventState }),
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
