import { randomUUID } from 'node:crypto';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, TimeZone, type LocalDate } from '@abnehm/contracts/base';
import type { DailyGoalCause } from '@abnehm/contracts/daily-goals';

import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCompletionEntity } from '../../daily-goals';
import { insertPersonForTest } from '../../daily-goals/testing/persisted';
import { energyBookingEntity } from '../../energy';
import type { LocalDatabase } from '../../local-db';
import { createLocalDatabases } from '../../local-db/local-databases';
import { dirtyDay, weightEntry } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter, type SyncRegistry } from '../../sync';
import { pendingOperations } from '../../sync/outbox';
import { createTrackers, waterEntryEntity, weightEntryEntity, type TrackerDependencies, type Trackers } from '..';

// Testaufbau des Tracker-Moduls: echte SQLite-Datei mit denselben Migrationen wie die App, eigene
// Person, Sync-Writer und der echte Persistenzdienst der Tagesziele. Die Uhr, in der Regel die Testuhr,
// gibt der Test hinein. Jeder Aufruf von `reevaluateDailyGoals` wird mitgeschrieben; auf Wunsch
// scheitert er, damit Tests das Zurückrollen der Transaktion sehen.

export const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
export const berlin = TimeZone.parse('Europe/Berlin');
/** 12:00 in Berlin am Mittwoch, 14.10.2026 (Sommerzeit, UTC+2): Startzeit der Testuhr. */
export const noon = Instant.parse('2026-10-14T10:00:00.000Z');

export type DayReport = { personId: EntityId; localDates: readonly LocalDate[]; cause: DailyGoalCause };

export type TrackerWorld = Readonly<{
  database: LocalDatabase;
  trackers: Trackers;
  dependencies: TrackerDependencies;
  /** Sync-Registry mit den Entitäten des Tracker-Moduls, etwa für einen zweiten Sync-Writer. */
  syncRegistry: SyncRegistry;
  reports: DayReport[];
  weights(): (typeof weightEntry.$inferSelect)[];
  operations(): ReturnType<typeof pendingOperations>;
  markers(): (typeof dirtyDay.$inferSelect)[];
  failReevaluation(failing: boolean): void;
  close(): void;
}>;

let ids = 0;

/**
 * Neue Welt über der Uhr des Tests; `close` sperrt die Datenbank und löscht ihre Datei. Ohne `person`
 * fehlt die eigene Person wie vor dem ersten Pull.
 */
export async function createTrackerWorld(clock: Clock, { deterministicIds = false, person = true }: { deterministicIds?: boolean; person?: boolean } = {}): Promise<TrackerWorld> {
  let failing = false;
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_a');
  if (person) database.transaction((tx) => insertPersonForTest(tx, philipp));
  const newId = deterministicIds
    ? () => EntityId.parse(`10000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`)
    : () => EntityId.parse(randomUUID());
  const syncRegistry = createSyncRegistry([waterEntryEntity, weightEntryEntity, dailyGoalCompletionEntity, energyBookingEntity]);
  const writer = createSyncWriter({ registry: syncRegistry, clock, newId });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock, writer, dispatcher });
  const reports: DayReport[] = [];
  const dependencies: TrackerDependencies = {
    database,
    clock,
    writer,
    newId,
    persistence: {
      reevaluateDailyGoals(tx, personId, localDates, cause) {
        reports.push({ personId, localDates: [...localDates], cause });
        persistence.reevaluateDailyGoals(tx, personId, localDates, cause);
        if (failing) throw new Error('Auswertung gescheitert');
      },
    },
  };
  return {
    database,
    trackers: createTrackers(dependencies),
    dependencies,
    syncRegistry,
    reports,
    weights: () => database.read((tx) => sqliteOf(tx).select().from(weightEntry).all()),
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
    markers: () => database.read((tx) => sqliteOf(tx).select().from(dirtyDay).all()),
    failReevaluation: (value) => {
      failing = value;
    },
    close: () => {
      databases.lock();
      files.remove();
    },
  };
}
