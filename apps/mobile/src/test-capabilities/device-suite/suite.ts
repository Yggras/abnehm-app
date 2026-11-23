import { eq, getTableName, is, sql } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, ServerVersion, SyncCursor, TimeZone } from '@abnehm/contracts/base';
import { PersonRecord, PersonUpsert } from '@abnehm/contracts/person';
import { currentSyncSchemaVersion, InstallationId, type PullResponse } from '@abnehm/contracts/sync';

import type { LocalDatabase } from '../../local-db';
import type { OpenSqlite } from '../../local-db/connection';
import { createLocalDatabases, databaseFileName, type LocalDatabases } from '../../local-db/local-databases';
import bundledMigrations from '../../local-db/migrations/migrations';
import * as schema from '../../local-db/schema';
import { deviceState, dirtyDay, outbox, person, syncCursor } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities, updateOwnPerson, type SyncTransport } from '../../sync';

// On-Device-Suite (Spezifikation 0, Testing Decisions; #114): wiederholt mit dem produktiven
// `expo-sqlite` auf dem Gerät Migration, Transaktionsrollback, Persistenz nach Neustart sowie die
// atomare Übernahme von Pull-Seite und Cursor. Sie läuft gegen dieselben Module wie die App
// (`LocalDatabases`, gebündelte Migrationen, Sync-Engine) und nur auf eigenen Dateien
// (`konto-geraetetest-*.db`), nie auf einer Kontodatenbank.
//
// Die Suite hat zwei Phasen, weil ein Neustart nur von außen geht (Maestro `stopApp`/`launchApp`):
// `vor_neustart` prüft alles Übrige und legt den Neustart-Stand an, `nach_neustart` prüft ihn im neuen
// Prozess und räumt auf. Jest führt dieselbe Suite mit better-sqlite3 aus (`suite.test.ts`); so ist
// die Suite selbst geprüft, bevor sie auf dem Gerät läuft.

/** Die Phasen der Suite; der Deep Link `geraetetest?phase=…` nimmt genau diese an. */
export const deviceSuitePhases = ['vor_neustart', 'nach_neustart'] as const;
export type DeviceSuitePhase = (typeof deviceSuitePhases)[number];

/** Dateien der Suite: produktiv expo-sqlite, in Jest better-sqlite3. */
export type DeviceSuiteFiles = Readonly<{ openSqlite: OpenSqlite; remove(fileName: string): void }>;

export type DeviceCaseResult = Readonly<{ key: string; title: string; error: string | null }>;
export type DeviceSuiteReport = Readonly<{ phase: DeviceSuitePhase; results: readonly DeviceCaseResult[] }>;

const at = Instant.parse('2026-10-14T12:00:00.000Z');
const start = { instant: at, timeZone: TimeZone.parse('Europe/Berlin') };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERSON = EntityId.parse(uuid(1));
const ACCOUNT = EntityId.parse(uuid(2));
const installationId = InstallationId.parse(uuid(3));
const markerKey = 'geraetetest_neustart';

const accounts = {
  frisch: 'geraetetest-frisch',
  update: 'geraetetest-update',
  rollback: 'geraetetest-rollback',
  pull: 'geraetetest-pull',
  neustart: 'geraetetest-neustart',
} as const;

class CheckFailed extends Error {}

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new CheckFailed(message);
}

function equal(actual: unknown, expected: unknown, what: string) {
  check(JSON.stringify(actual) === JSON.stringify(expected), `${what}: ${JSON.stringify(actual)} statt ${JSON.stringify(expected)}`);
}

const upsert = (displayName: string): PersonUpsert =>
  PersonUpsert.parse({
    id: PERSON,
    displayName,
    calculationSex: null,
    birthDate: null,
    heightCm: null,
    activityLevel: null,
    pregnantOrBreastfeeding: null,
    knownEatingDisorder: null,
    disclaimerAcceptedAt: null,
    onboardingStatus: 'begonnen',
    onboardingCompletedAt: null,
    goalWeightReachedG: null,
    goalWeightReachedAt: null,
  });

const personRecord = (displayName: string) =>
  PersonRecord.parse({ ...upsert(displayName), accountId: ACCOUNT, timeZone: start.timeZone, createdAt: at, updatedAt: at });

/** IDs der Suite: fortlaufend und reproduzierbar, ohne Zufall. */
function idSequence(from: number) {
  let next = from;
  return () => EntityId.parse(uuid(next++));
}

const clock = createTestClock(start);
const registry = createSyncRegistry(foundationSyncEntities);
const writer = createSyncWriter({ registry, clock, newId: idSequence(100) });

function insertPerson(database: LocalDatabase, displayName: string) {
  const row = personRecord(displayName);
  database.transaction((tx) => sqliteOf(tx).insert(person).values({ ...row, id: PERSON, accountId: ACCOUNT }).run());
}

const readPerson = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(person).where(eq(person.id, PERSON)).get());
const readOutbox = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(outbox).all());
const readCursor = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(syncCursor).get());

type Case = Readonly<{ key: string; title: string; run(files: DeviceSuiteFiles): Promise<void> }>;

/** Wie `migrateLocalDatabase` es zählt: Drizzle führt je angewandter Migration eine Zeile. */
const appliedMigrations = (database: LocalDatabase) =>
  database.read((tx) => sqliteOf(tx).all<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`))[0]?.n;

const schemaTables = (Object.values(schema) as unknown[])
  .filter((value): value is SQLiteTable => is(value, SQLiteTable))
  .map((table) => getTableName(table))
  .sort();

/** Lokale FTS5-Indizes außerhalb der Drizzle-Schemas: die eigenen Lebensmittel (Migration `0004_own_food_search`, #157). */
const localSearchIndexes = ['off_cache_search', 'own_food_search'];

/** Löscht eine Datei der Suite und prüft, dass sie danach leer ist. */
function clearFile(files: DeviceSuiteFiles, fileName: string) {
  files.remove(fileName);
  const connection = files.openSqlite(fileName);
  try {
    const tables = connection.db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`);
    check(tables.length === 0, `${fileName} ist nach dem Löschen nicht leer`);
  } finally {
    connection.close();
  }
}

type SuiteDatabaseOptions = Readonly<{
  /** Die bestehende Datei öffnen statt einer frischen, etwa nach dem Neustart. */
  existing?: boolean;
  /** Schreibt vor dem Öffnen in die leere Datei, etwa einen älteren App-Stand. */
  prepare?(fileName: string): void;
  /** Lässt die Datenbank offen wie bei einer beendeten App, statt sie zu schließen und zu löschen. */
  keepOpen?(databases: LocalDatabases): void;
}>;

/**
 * Öffnet die Kontodatenbank eines Falls über `LocalDatabases` (migriert dabei), führt `work` aus und
 * prüft danach, dass weder Beobachter noch Nach-Commit-Rückmeldungen Fehler meldeten. Danach ist die
 * Datei geschlossen und gelöscht, außer `keepOpen` übernimmt sie.
 */
async function withSuiteDatabase(
  files: DeviceSuiteFiles,
  account: string,
  work: (database: LocalDatabase) => Promise<void> | void,
  { existing = false, prepare, keepOpen }: SuiteDatabaseOptions = {},
) {
  const fileName = databaseFileName(account);
  if (!existing) clearFile(files, fileName);
  prepare?.(fileName);
  const errors: unknown[] = [];
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => errors.push(error) });
  try {
    await work(await databases.open(account));
    equal(errors, [], 'Fehler');
  } finally {
    if (keepOpen) {
      keepOpen(databases);
    } else {
      databases.lock();
      files.remove(fileName);
    }
  }
}

const migrationFresh: Case = {
  key: 'migration_frisch',
  title: 'Migration einer neuen Kontodatenbank',
  run: (files) =>
    withSuiteDatabase(files, accounts.frisch, (database) => {
      equal(appliedMigrations(database), bundledMigrations.journal.entries.length, 'angewandte Migrationen');
      const all = database.read((tx) =>
        sqliteOf(tx).all<{ name: string; virtual: number }>(
          sql`select name, sql like 'CREATE VIRTUAL TABLE%' as virtual from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '__drizzle_migrations'`,
        ),
      );
      const virtual = all.filter((table) => table.virtual === 1).map(({ name }) => name).sort();
      // FTS5 legt zu jeder virtuellen Tabelle eigene Schattentabellen `<name>_data` usw. an (https://www.sqlite.org/fts5.html).
      const tables = all
        .filter((table) => table.virtual !== 1 && !virtual.some((name) => table.name.startsWith(`${name}_`)))
        .map(({ name }) => name)
        .sort();
      equal(tables, schemaTables, 'Tabellen');
      equal(virtual, localSearchIndexes, 'lokale Suchindizes');
      equal(database.read((tx) => sqliteOf(tx).all<{ foreign_keys: number }>(sql`pragma foreign_keys`))[0]?.foreign_keys, 1, 'Fremdschlüssel eingeschaltet');
    }),
};

/**
 * Ein älterer App-Stand: nur die erste Migration, angewandt wie Drizzles Migrator (Hash leer, Zeitpunkt
 * aus dem Journal; https://unpkg.com/drizzle-orm@0.45.4/expo-sqlite/migrator.js), dazu offline
 * erfasste Zeilen samt nie gesendeter Outbox-Operation der Vertragsversion 1.
 */
function createOldestAppVersion(files: DeviceSuiteFiles, fileName: string) {
  const [first] = bundledMigrations.journal.entries;
  check(first !== undefined, 'Das Journal hat keine Migration');
  const connection = files.openSqlite(fileName);
  try {
    connection.db.run(sql`create table __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`);
    const migration = bundledMigrations.migrations[`m${String(first.idx).padStart(4, '0')}` as keyof typeof bundledMigrations.migrations];
    for (const statement of migration.split('--> statement-breakpoint')) connection.db.run(sql.raw(statement));
    connection.db.run(sql`insert into __drizzle_migrations (hash, created_at) values ('', ${first.when})`);
    const row = personRecord('Vor dem Update');
    connection.db.run(sql`insert into person (id, account_id, display_name, onboarding_status, time_zone, created_at, updated_at)
      values (${PERSON}, ${ACCOUNT}, ${row.displayName}, 'begonnen', ${row.timeZone}, ${at}, ${at})`);
    connection.db.run(sql`insert into dirty_day (person_id, local_date, cause, created_at) values (${PERSON}, '2026-10-14', 'eingabe', ${at})`);
    connection.db.run(sql`insert into outbox (operation_id, sequence, type, entity_type, entity_id, business_key, payload, known_server_version,
      schema_version, created_at, attempt_count, last_attempt_at, last_error_code)
      values (${uuid(10)}, 1, 'upsert_entity', 'person', ${PERSON}, null, ${JSON.stringify(upsert('Offline geändert'))}, null, 1, ${at}, 0, null, null)`);
  } finally {
    connection.close();
  }
}

const migrationUpdate: Case = {
  key: 'migration_update',
  title: 'Migration nach App-Update mit offener Outbox',
  run: (files) =>
    withSuiteDatabase(
      files,
      accounts.update,
      (database) => {
        equal(appliedMigrations(database), bundledMigrations.journal.entries.length, 'angewandte Migrationen');
        equal(readPerson(database)?.displayName, 'Vor dem Update', 'Person');
        equal(database.read((tx) => sqliteOf(tx).select({ revision: dirtyDay.revision }).from(dirtyDay).all()), [{ revision: 0 }], 'Dirty-Day-Revision');
        const [operation, ...rest] = readOutbox(database);
        equal(rest.length, 0, 'weitere Outbox-Operationen');
        check(operation !== undefined, 'Die Outbox-Operation fehlt nach dem Update');
        equal(
          { id: operation.operationId, version: operation.schemaVersion, error: operation.lastErrorCode, refs: operation.affectedRefs, paths: operation.referencePaths },
          { id: uuid(10), version: currentSyncSchemaVersion, error: null, refs: [], paths: [] },
          'Outbox-Operation',
        );
        equal(operation.payload, upsert('Offline geändert'), 'Outbox-Nutzlast');
      },
      { prepare: (fileName) => createOldestAppVersion(files, fileName) },
    ),
};

const rollback: Case = {
  key: 'rollback',
  title: 'Transaktionsrollback samt Outbox',
  run: (files) =>
    withSuiteDatabase(files, accounts.rollback, (database) => {
      insertPerson(database, 'Unverändert');
      let committed = false;
      let failed = false;
      try {
        database.transaction((tx) => {
          tx.afterCommit(() => {
            committed = true;
          });
          updateOwnPerson(tx, writer, { displayName: 'Zurückgerollt' }, at);
          throw new Error('Abbruch in der Transaktion');
        });
      } catch {
        failed = true;
      }
      check(failed, 'Die Transaktion ist nicht gescheitert');
      check(!committed, 'afterCommit lief trotz Rollback');
      equal(readPerson(database)?.displayName, 'Unverändert', 'Person');
      equal(readOutbox(database), [], 'Outbox');
    }),
};

const pullPageAndCursor: Case = {
  key: 'pull_seite_cursor',
  title: 'Pull-Seite und Cursor atomar',
  run: (files) =>
    withSuiteDatabase(files, accounts.pull, async (database) => {
      const pages: Record<'erste' | 'zweite', PullResponse> = {
        erste: {
          changes: [{ type: 'record', entityType: 'person', entityId: PERSON, serverVersion: ServerVersion.parse('3'), data: personRecord('Seite 1') }],
          next: { type: 'page', pageToken: 'geraetetest.seite.2' },
        },
        zweite: {
          changes: [{ type: 'record', entityType: 'person', entityId: PERSON, serverVersion: ServerVersion.parse('4'), data: personRecord('Seite 2') }],
          next: { type: 'complete', cursor: SyncCursor.parse('4') },
        },
      };
      const transport: SyncTransport = {
        push: async () => ({ type: 'ok', body: { results: [] } }),
        pull: async (request) => ({ type: 'ok', body: request.pageToken === null ? pages.erste : pages.zweite }),
      };
      let failSecondPage = true;
      const engine = createSyncEngine({
        database,
        registry,
        transport,
        clock,
        installationId,
        onCanonicalChanges(tx, changes) {
          const name = sqliteOf(tx).select({ displayName: person.displayName }).from(person).where(eq(person.id, PERSON)).get()?.displayName;
          if (failSecondPage && name === 'Seite 2' && changes.length > 0) throw new Error('Seite 2 scheitert mitten in der Übernahme');
        },
      });

      let failed = false;
      try {
        await engine.sync();
      } catch {
        failed = true;
      }
      check(failed, 'Der Sync ist trotz scheiternder Seite nicht gescheitert');
      // Seite 1 ist vollständig übernommen, von Seite 2 nichts; der endgültige Cursor fehlt noch.
      equal({ name: readPerson(database)?.displayName, version: readPerson(database)?.serverVersion }, { name: 'Seite 1', version: '3' }, 'nach Seite 1');
      equal({ cursor: readCursor(database)?.cursor, pageToken: readCursor(database)?.pageToken }, { cursor: null, pageToken: 'geraetetest.seite.2' }, 'Cursor nach Seite 1');

      failSecondPage = false;
      await engine.sync();
      equal({ name: readPerson(database)?.displayName, version: readPerson(database)?.serverVersion }, { name: 'Seite 2', version: '4' }, 'nach Seite 2');
      equal({ cursor: readCursor(database)?.cursor, pageToken: readCursor(database)?.pageToken }, { cursor: '4', pageToken: null }, 'Cursor nach Seite 2');
    }),
};

/** Die Kontodatenbank des Neustart-Falls bleibt bis zum Prozessende offen, wie bei einer beendeten App. */
let restartDatabases: LocalDatabases | null = null;

const prepareRestart = (runtime: string): Case => ({
  key: 'neustart_vorbereiten',
  title: 'Stand für den Neustart anlegen',
  run(files) {
    restartDatabases?.lock();
    return withSuiteDatabase(
      files,
      accounts.neustart,
      (database) => {
        insertPerson(database, 'Unverändert');
        database.transaction((tx) => {
          updateOwnPerson(tx, writer, { displayName: 'Vor dem Neustart' }, at);
          sqliteOf(tx).insert(syncCursor).values({ scope: 'konto', cursor: '7', pageToken: null, updatedAt: at }).run();
          sqliteOf(tx).insert(deviceState).values({ key: markerKey, value: { runtime }, updatedAt: at }).run();
        });
        try {
          database.transaction((tx) => {
            updateOwnPerson(tx, writer, { displayName: 'Nie gespeichert' }, at);
            throw new Error('Abbruch in der Transaktion');
          });
        } catch {
          // erwartet: Diese Änderung darf den Neustart nicht überstehen.
        }
        equal(readPerson(database)?.displayName, 'Vor dem Neustart', 'Person vor dem Neustart');
      },
      { keepOpen: (databases) => (restartDatabases = databases) },
    );
  },
});

const verifyRestart = (runtime: string): Case => ({
  key: 'neustart_pruefen',
  title: 'Persistenz nach Neustart',
  run: (files) =>
    withSuiteDatabase(
      files,
      accounts.neustart,
      (database) => {
        const marker = database.read((tx) => sqliteOf(tx).select().from(deviceState).where(eq(deviceState.key, markerKey)).get());
        check(marker !== undefined, 'Kein Stand vor dem Neustart; zuerst die Phase vor_neustart ausführen');
        const before = (marker.value as { runtime: string }).runtime;
        check(before !== runtime, 'Die App wurde seit der Phase vor_neustart nicht neu gestartet');
        equal(readPerson(database)?.displayName, 'Vor dem Neustart', 'Person nach dem Neustart');
        const operations = readOutbox(database);
        equal(operations.map((operation) => (operation.payload as { displayName?: string }).displayName), ['Vor dem Neustart'], 'Outbox nach dem Neustart');
        equal(readCursor(database)?.cursor, '7', 'Cursor nach dem Neustart');
      },
      { existing: true },
    ),
});

async function runCase(testCase: Case, files: DeviceSuiteFiles): Promise<DeviceCaseResult> {
  try {
    await testCase.run(files);
    return { key: testCase.key, title: testCase.title, error: null };
  } catch (error) {
    return { key: testCase.key, title: testCase.title, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Führt eine Phase der Suite aus; die Fälle laufen nacheinander und unabhängig. `runtime`
 * kennzeichnet den laufenden Prozess, damit `nach_neustart` einen echten Neustart erkennt.
 */
export async function runDeviceSuite(phase: DeviceSuitePhase, files: DeviceSuiteFiles, runtime: string): Promise<DeviceSuiteReport> {
  const cases = phase === 'vor_neustart' ? [migrationFresh, migrationUpdate, rollback, pullPageAndCursor, prepareRestart(runtime)] : [verifyRestart(runtime)];
  const results: DeviceCaseResult[] = [];
  for (const testCase of cases) results.push(await runCase(testCase, files));
  return { phase, results };
}
