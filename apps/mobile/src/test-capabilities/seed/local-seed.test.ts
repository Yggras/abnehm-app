/**
 * @jest-environment node
 */
import { eq } from 'drizzle-orm';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import { seedIds, seedManifests, SeedManifest } from '@abnehm/contracts/seeds';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { createLocalDatabases } from '../../local-db/local-databases';
import { person } from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import { createNutrition } from '../../nutrition';
import { openTestCatalog } from '../../nutrition/testing/test-catalog';
import { canonicalDevice, dumpLocalDatabase, seedLocalDatabase } from './local-seed';
import { withoutPhotos } from '../../nutrition/testing/without-photos';

// Nachweis für #112: Seed der lokalen Kontodatenbank auf echtem SQLite (better-sqlite3, dieselben Migrationen).

const solo = seedManifests.solo;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function openDatabase() {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({
    openSqlite: files.openSqlite,
    onError: (error) => {
      throw error;
    },
  });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  return databases.open(solo.accounts[0]!.accountId);
}

describe('Seed der lokalen Datenbank', () => {
  it('stellt den Gerätezustand des Manifests exakt her: Fachzeilen, Cursor und leere Outbox', async () => {
    const database = await openDatabase();
    seedLocalDatabase(database, solo, 'philipp-iphone');
    expect(dumpLocalDatabase(database)).toEqual(canonicalDevice(solo.initial.devices['philipp-iphone']!));
  });

  it('baut den lokalen Suchindex der eigenen Lebensmittel aus den Seed-Zeilen auf (#157)', async () => {
    const database = await openDatabase();
    const catalog = openTestCatalog();
    cleanups.push(catalog.close);
    const unused = () => {
      throw new Error('Die Suche schreibt nichts');
    };
    // Die Uhr des Manifests: „Zuletzt verwendet“ in der Suche reicht 30 Tage zurück (#158).
    const clock = createTestClock({ instant: Instant.parse(solo.clock.instant), timeZone: TimeZone.parse(solo.clock.timeZone) });
    const nutrition = createNutrition({ ...withoutPhotos, database, clock, writer: { upsert: unused, delete: unused, command: unused }, persistence: { reevaluateDailyGoals: unused }, newId: unused });

    seedLocalDatabase(database, solo, 'philipp-iphone');

    // Das Abendessen hat in `solo` keine Einträge, also auch kein „Zuletzt verwendet“.
    const result = nutrition.foodSearch(catalog.database, 'abendessen').search('Apfel roh');
    expect(result.type === 'treffer' && result.hits.map((hit) => `${hit.mark}: ${hit.snapshot.name}`)).toEqual([
      'eigen: Apfel roh', 'bls: Apfel geschält, roh', 'bls: Granatapfel roh',
    ]);
    const muesli = nutrition.foodSearch(catalog.database, 'abendessen').search('Bircher');
    // Das selbst gemachte Bircher-Müsli ist in `solo` Lebensmittelfavorit (#158).
    expect(muesli.type === 'treffer' && muesli.hits[0]).toMatchObject({ mark: 'favorit', snapshot: { name: 'Bircher-Müsli, selbst gemacht' } });
  });

  it('ist idempotent und setzt einen veränderten Stand zurück', async () => {
    const database = await openDatabase();
    seedLocalDatabase(database, solo, 'philipp-iphone');
    const first = dumpLocalDatabase(database);
    database.transaction((tx) => sqliteOf(tx).update(person).set({ displayName: 'Geändert' }).where(eq(person.id, seedIds.person.philipp)).run());

    seedLocalDatabase(database, solo, 'philipp-iphone');
    expect(dumpLocalDatabase(database)).toEqual(first);
  });

  it('stellt offene Operationen in Reihenfolge und einen fehlenden Cursor her', async () => {
    const operation = (n: number, displayName: string): OutboxOperation => ({
      type: 'upsert_entity',
      operationId: EntityId.parse(`5eed00f0-0000-4000-8000-00000000000${n}`),
      entityType: 'person',
      entityId: EntityId.parse(seedIds.person.philipp),
      knownServerVersion: ServerVersion.parse('1'),
      schemaVersion: currentSyncSchemaVersion,
      createdAt: Instant.parse('2026-10-14T11:00:00.000Z'),
      payload: { displayName },
    });
    const device = { ...solo.initial.devices['philipp-iphone']!, cursor: null, outbox: [operation(1, 'Phil'), operation(2, 'Philipp D.')] };
    const manifest = SeedManifest.parse({ ...solo, initial: { ...solo.initial, devices: { 'philipp-iphone': device } } });
    const database = await openDatabase();
    seedLocalDatabase(database, manifest, 'philipp-iphone');
    expect(dumpLocalDatabase(database)).toEqual(canonicalDevice(device));
  });

  it('kennt nur Installationen des Szenarios', async () => {
    const database = await openDatabase();
    expect(() => seedLocalDatabase(database, solo, 'anna-android')).toThrow('Seed: Szenario solo kennt keine Installation anna-android');
  });
});
