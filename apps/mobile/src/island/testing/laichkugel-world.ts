import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, LocalDate, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import { dailyGoalKey } from '@abnehm/contracts/daily-goals';
import { energyBookingId } from '@abnehm/contracts/energy';
import { IslandProgress, type IslandRole } from '@abnehm/contracts/island';
import type { PlanReader } from '@abnehm/contracts/ports';
import { IslandEventRecord, islandContentId, islandEventId, islandEventStateId, type IslandObjectOrigin, type VisitorEventDetails } from '@abnehm/contracts/island-records';
import { areaOccasionKey, areaUnlockAt, discoveryStatus, sidesOf } from '@abnehm/game-rules/areas';
import { gameCatalog } from '@abnehm/game-rules/content';
import { visitorOccasionKey } from '@abnehm/game-rules/events';
import { hatching } from '@abnehm/game-rules/hatching';
import { levelNeed } from '@abnehm/game-rules/progress';
import { levelOccasionKey } from '@abnehm/game-rules/unlocks';

import { dailyGoalCompletionEntity } from '../../daily-goals';
import { insertCompletionForTest, insertDailyGoalForTest, insertPersonForTest } from '../../daily-goals/testing/persisted';
import { appendBooking, energyBookingEntity } from '../../energy';
import type { Haptics } from '../../haptics/haptics';
import type { LocalDatabase } from '../../local-db';
import { createLocalDatabases } from '../../local-db/local-databases';
import {
  areaUnlock,
  blueprintUnlock,
  challenge,
  communityProject,
  coupling,
  couplingMember,
  island,
  islandEvent,
  islandEventState,
  islandField,
  islandObject,
  islandProgress,
  sharedAction,
} from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import type { Refresh } from '../../shell/followed-source';
import { createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncWriter } from '../../sync';
import { pendingOperations } from '../../sync/outbox';
import { createGameService, type GameService } from '../game-service';
import { islandProgressOf, islandSyncEntities } from '../island-entities';
import { anna, philipp } from './persons';
import { quietGameDependencies } from './quiet-game';
import { everyDayPlan, weeklyPlanReader } from './challenge-plans';

// Testaufbau für Laichkugel, Rollenwahl und Schlüpfen (#180, #184): echte SQLite-Datei mit denselben
// Migrationen wie die App, Philipp als eigene Person, Sync-Writer und der echte Spieldienst. Kopplung,
// Insel, Vorschläge, die geschlüpfte Insel, Energie, Objekte (#194) und Besucher (#202) legt der Test an, wie sie der Pull
// ablegen würde; einen Levelaufstieg (#200) übernimmt er über die Sync-Adapter wie ein echter Pull. Ein Gebiet mit
// Entdeckung (#204) entsteht wie auf dem Server aus den Spielregeln.
// Die Uhr gibt der Test hinein, auf Wunsch auch Haptik und Takt des Spieldienstes (#188).

const at = '2026-10-14T12:00:00.000Z';
const synced = { createdAt: at, updatedAt: at, serverVersion: '1' };
export const couplingId = EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c01');
export const islandId = EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c02');

export type LaichkugelWorld = Readonly<{
  /** Die geöffnete Kontodatenbank; nach `restart()` die neu geöffnete. */
  database: LocalDatabase;
  /** Der Spieldienst; nach `restart()` der neu erzeugte. */
  game: GameService;
  writer: SyncWriter;
  /** Neustart der App: Datenbank schließen, dieselbe Datei neu öffnen und den Spieldienst neu erzeugen. */
  restart(): Promise<void>;
  /** Philipp und Anna gekoppelt; die Insel wartet auf die Rollen. */
  couple(): void;
  /**
   * Momo ist geschlüpft, wie es der Pull nach der Annahme ablegt: Philipp Bauen, Anna Natur, Grundinsel,
   * Start-Baupläne, Projekt 1, das Ereignis und der Inselfortschritt auf Level 1. Setzt `couple()` voraus;
   * `progress: false` lässt den Inselfortschritt weg, als stünde er erst auf der nächsten Pull-Seite.
   */
  hatch(options?: Readonly<{ progress?: boolean }>): void;
  /** Ein vom Server bestätigter offener Vorschlag. */
  proposeOnServer(by: 'philipp' | 'anna', proposerRole: IslandRole): EntityId;
  /**
   * Ein vom Server bestätigter Challenge-Vorschlag, wie der Pull ihn ablegt (#210): heute um 12:00 Uhr UTC
   * vorgeschlagen, Verfall 48 Stunden später. Setzt `couple()` voraus.
   */
  challengeOnServer(by: 'philipp' | 'anna', templateKey: string): EntityId;
  /** Gutschriften für erfüllte Tagesziele, wie sie der Pull ablegt. */
  credit(amount: number): void;
  /** ID des materialisierten Inselfelds zum Feldschlüssel (#194). */
  fieldId(fieldKey: string): EntityId;
  /** Ein vom Server bestätigtes Inselobjekt, etwa eines des Partners, auf einem Feld oder im Lager (`null`) (#194). */
  objectOnServer(object: Readonly<{ owner: 'philipp' | 'anna'; fieldKey: string | null; catalogKey: string; level?: number; origin?: IslandObjectOrigin }>): EntityId;
  /**
   * Ein Besucher mit Wunsch, wie der Pull ihn ablegt (#202): das Ereignis und, für Philipp, sein Ereignisstand;
   * den Stand der Partnerin bekommt Philipps Gerät nie. Liefert die ID des Ereignisstands.
   */
  /** Vom Server bestätigte Freischaltungen, etwa Besucher-Baupläne früherer Besuche (#202). */
  unlockOnServer(catalogKeys: readonly string[]): void;
  visitOnServer(visit: Readonly<{ to: 'philipp' | 'anna'; n: number; templateKey: string; details: VisitorEventDetails; status?: 'offen' | 'erfuellbar'; seen?: boolean }>): EntityId;
  /**
   * Ein Pull mit dem Inselfortschritt auf `level` und den Levelaufstiegs-Ereignissen der Level `events`, wie
   * der Server sie nach einem Bau des Partners schreibt (#200). Übernommen über die Sync-Adapter der Insel.
   */
  pullProgress(level: number, events?: readonly number[]): void;
  /**
   * Gebiet und Entdeckung des Levels `level`, wie der Pull sie nach der Freischaltung ablegt (#204): Freischaltung,
   * Felder beider Personen, Entdeckungs-Baupläne, das Ereignis und Philipps Ereignisstand. Liefert dessen ID.
   */
  areaOnServer(level: number, options?: Readonly<{ seen?: boolean }>): EntityId;
  operations(): ReturnType<typeof pendingOperations>;
  close(): void;
}>;

export type LaichkugelWorldOptions = Readonly<{
  haptics?: Haptics;
  refresh?: Refresh;
  /** Eigener Wochenplan für die Vorschau der Challenge-Anteile (#210); standardmäßig jeden Tag alles geplant. */
  planReader?: PlanReader;
}>;

export async function createLaichkugelWorld(
  clock: Clock,
  { haptics = quietGameDependencies.haptics, refresh = quietGameDependencies.refresh, planReader = weeklyPlanReader(everyDayPlan) }: LaichkugelWorldOptions = {},
): Promise<LaichkugelWorld> {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  let database = await databases.open('konto_philipp');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry: createSyncRegistry([...foundationSyncEntities, dailyGoalCompletionEntity, energyBookingEntity]), clock, newId });
  const gameOf = (opened: LocalDatabase) => createGameService({ database: opened, writer, clock, newId, haptics, refresh, planReader });
  let game = gameOf(database);
  const fieldIdOf = (fieldKey: string) => {
    const field = database.read((tx) => sqliteOf(tx).select({ id: islandField.id }).from(islandField).where(eq(islandField.fieldKey, fieldKey)).get());
    if (field === undefined) throw new Error(`Feld ${fieldKey} fehlt`);
    return EntityId.parse(field.id);
  };
  return {
    get database() {
      return database;
    },
    get game() {
      return game;
    },
    writer,
    async restart() {
      databases.lock();
      database = await databases.open('konto_philipp');
      game = gameOf(database);
    },
    couple() {
      database.transaction((tx) => {
        const db = sqliteOf(tx);
        const [low, high] = philipp < anna ? [philipp, anna] : [anna, philipp];
        db.insert(coupling).values({ id: couplingId, personLowId: low, personHighId: high, status: 'aktiv', startedAt: at, ...synced }).run();
        for (const [person, displayName] of [[philipp, 'Philipp'], [anna, 'Anna']] as const) {
          db.insert(couplingMember).values({ id: newId(), couplingId, couplingStatus: 'aktiv', personId: person, displayName, ...synced }).run();
        }
        db.insert(island).values({ id: islandId, couplingId, state: 'wartet_auf_rollen', ...synced }).run();
      });
    },
    hatch({ progress = true } = {}) {
      const plan = hatching(gameCatalog, { proposerPersonId: anna, proposerRole: 'natur', partnerPersonId: philipp });
      const owned = { islandId, couplingId };
      const projectId = newId();
      database.transaction((tx) => {
        const db = sqliteOf(tx);
        for (const [role, personId] of Object.entries(plan.roles)) {
          db.update(couplingMember).set({ role }).where(eq(couplingMember.personId, personId)).run();
        }
        db.update(island).set({ state: 'aktiv', hatchedAt: at, timeZone: 'Europe/Berlin' }).where(eq(island.id, islandId)).run();
        for (const field of plan.fields) {
          db.insert(islandField).values({ id: newId(), ...owned, fieldKey: field.key, ownerPersonId: field.ownerPersonId, createdAt: at, serverVersion: '1' }).run();
        }
        for (const blueprint of plan.blueprints) {
          db.insert(blueprintUnlock).values({ id: newId(), ...owned, catalogKey: blueprint.key, reason: blueprint.reason, unlockedAt: at, createdAt: at, serverVersion: '1' }).run();
        }
        db.insert(communityProject).values({ id: projectId, ...owned, ...plan.project, status: 'aktiv', ...synced }).run();
        db.insert(islandEvent).values({ id: newId(), ...owned, ...plan.event, status: 'abgeschlossen', occurredAt: at, ...synced }).run();
        if (!progress) return;
        db.insert(islandProgress)
          .values({
            id: newId(), ...owned, level: plan.progress.level, levelNeed: plan.progress.levelNeed, dataAsOf: at, ...synced,
            content: {
              members: plan.progress.members,
              activeProject: { projectId, templateKey: plan.project.templateKey, sequenceNumber: 1, stage: 'gestartet' },
            },
          })
          .run();
      });
    },
    proposeOnServer(by, proposerRole) {
      const id = newId();
      database.transaction((tx) =>
        sqliteOf(tx)
          .insert(sharedAction)
          .values({ id, couplingId, kind: 'rollenwahl', requesterPersonId: by === 'philipp' ? philipp : anna, payload: { proposerRole }, status: 'offen', ...synced })
          .run(),
      );
      return id;
    },
    challengeOnServer(by, templateKey) {
      const id = newId();
      database.transaction((tx) =>
        sqliteOf(tx)
          .insert(challenge)
          .values({
            id, couplingId, templateKey, proposerPersonId: by === 'philipp' ? philipp : anna, status: 'vorgeschlagen',
            proposedAt: at, proposalExpiresAt: '2026-10-16T12:00:00.000Z', ...synced,
          })
          .run(),
      );
      return id;
    },
    credit(amount) {
      database.transaction((tx) => {
        for (let day = 1; day <= amount; day++) {
          const localDate = LocalDate.parse(`2026-10-${String(day).padStart(2, '0')}`);
          const snapshot = { type: 'gewogen', personId: philipp, localDate, slot: 1, timeZone: TimeZone.parse('Europe/Berlin'), dayEndsAt: Instant.parse(at) } as const;
          const [goal, completion] = [newId(), newId()];
          insertDailyGoalForTest(tx, goal, snapshot);
          insertCompletionForTest(tx, completion, goal, snapshot, at);
          const bookingKey = dailyGoalKey(philipp, localDate, 1);
          appendBooking(tx, {
            type: 'daily_goal_credit', id: energyBookingId(bookingKey), personId: philipp, localDate, bookingKey, createdAt: Instant.parse(at),
            amount: 1, trigger: { dailyGoalCompletionId: EntityId.parse(completion), slot: 1 },
          });
        }
      });
    },
    fieldId: fieldIdOf,
    objectOnServer({ owner, fieldKey, catalogKey, level = 1, origin = 'gebaut' }) {
      const id = newId();
      const fieldId = fieldKey === null ? null : fieldIdOf(fieldKey);
      database.transaction((tx) =>
        sqliteOf(tx)
          .insert(islandObject)
          .values({ id, islandId, couplingId, ownerPersonId: owner === 'philipp' ? philipp : anna, catalogKey, origin, level, fieldId, ...synced })
          .run(),
      );
      return id;
    },
    unlockOnServer(catalogKeys) {
      database.transaction((tx) => {
        for (const catalogKey of catalogKeys) {
          sqliteOf(tx).insert(blueprintUnlock).values({ id: newId(), islandId, couplingId, catalogKey, reason: 'besucher', unlockedAt: at, createdAt: at, serverVersion: '1' }).run();
        }
      });
    },
    visitOnServer({ to, n, templateKey, details, status = 'offen', seen = false }) {
      const occasionKey = visitorOccasionKey('2026-10-14', n);
      const eventId = islandEventId(islandId, occasionKey);
      const responsible = to === 'philipp' ? philipp : anna;
      const stateId = islandEventStateId(eventId, EntityId.parse(responsible));
      database.transaction((tx) => {
        const db = sqliteOf(tx);
        db.insert(islandEvent)
          .values({ id: eventId, islandId, couplingId, type: 'besuch', templateKey, responsiblePersonId: responsible, occasionKey, status, reward: details, occurredAt: at, ...synced })
          .run();
        if (to === 'philipp') db.insert(islandEventState).values({ id: stateId, islandEventId: eventId, personId: philipp, seenAt: seen ? at : null, claimedAt: null, ...synced }).run();
      });
      return stateId;
    },
    pullProgress(level, events = []) {
      const adapterOf = (entityType: string) => islandSyncEntities.find((entity) => entity.entityType === entityType)!;
      database.transaction((tx) => {
        const row = sqliteOf(tx).select().from(islandProgress).where(eq(islandProgress.islandId, islandId)).get();
        if (row === undefined) throw new Error('Inselfortschritt fehlt; zuerst hatch()');
        const current = islandProgressOf(row);
        const members = current.members.map(({ personId }) => ({ personId, halfPercent: 0, halfFull: false }));
        const progress = IslandProgress.parse({
          ...current, level, levelNeed: levelNeed(level), members, dataAsOf: at, serverVersion: String(Number(current.serverVersion) + 1),
        });
        adapterOf('island_progress').applyCanonical(tx, { entityId: EntityId.parse(row.id), serverVersion: progress.serverVersion, data: progress });
        for (const eventLevel of events) {
          const occasionKey = levelOccasionKey(islandId, eventLevel);
          const id = islandEventId(islandId, occasionKey);
          const data = IslandEventRecord.parse({
            islandId, couplingId, type: 'levelaufstieg', templateKey: null, responsiblePersonId: null, occasionKey, status: 'abgeschlossen', reward: null,
            occurredAt: at, createdAt: at, updatedAt: at,
          });
          adapterOf('island_event').applyCanonical(tx, { entityId: id, serverVersion: ServerVersion.parse(progress.serverVersion), data });
        }
      });
    },
    areaOnServer(level, { seen = false } = {}) {
      return database.transaction((tx) => {
        const db = sqliteOf(tx);
        const fields = db.select({ key: islandField.fieldKey, ownerPersonId: islandField.ownerPersonId }).from(islandField).all();
        const sides = sidesOf(gameCatalog, fields);
        const unlock = sides === null ? null : areaUnlockAt(gameCatalog, { level, sides });
        if (unlock === null) throw new Error(`Kein Gebiet bei Level ${level}; zuerst hatch()`);
        const owned = { islandId, couplingId };
        // IDs wie auf dem Server (`islandContentId`).
        const idOf = (entityType: Parameters<typeof islandContentId>[0], key: string) => islandContentId(entityType, islandId, key);
        db.insert(areaUnlock).values({ id: idOf('area_unlock', unlock.area.key), ...owned, areaKey: unlock.area.key, level, unlockedAt: at, createdAt: at, serverVersion: '1' }).run();
        for (const field of unlock.fields) {
          db.insert(islandField).values({ id: idOf('island_field', field.key), ...owned, fieldKey: field.key, ownerPersonId: field.ownerPersonId, createdAt: at, serverVersion: '1' }).run();
        }
        for (const catalogKey of unlock.discovery.blueprints) {
          db.insert(blueprintUnlock).values({ id: idOf('blueprint_unlock', catalogKey), ...owned, catalogKey, reason: 'entdeckung', unlockedAt: at, createdAt: at, serverVersion: '1' }).run();
        }
        const occasionKey = areaOccasionKey(islandId, unlock.area.key);
        const eventId = islandEventId(islandId, occasionKey);
        const status = discoveryStatus(unlock.discovery);
        db.insert(islandEvent)
          .values({ id: eventId, ...owned, type: 'entdeckung', templateKey: null, responsiblePersonId: null, occasionKey, status, reward: unlock.discovery, occurredAt: at, ...synced })
          .run();
        const stateId = islandEventStateId(eventId, philipp);
        db.insert(islandEventState).values({ id: stateId, islandEventId: eventId, personId: philipp, seenAt: seen ? at : null, claimedAt: null, ...synced }).run();
        return stateId;
      });
    },
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
    close() {
      databases.lock();
      files.remove();
    },
  };
}
