import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import type { OwnFoodUpsert } from '@abnehm/contracts/nutrition';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { ownFood as localOwnFood } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createNutrition, nutritionEntryEntity, ownFoodEntity, type FoodSearchResult } from '../../mobile/src/nutrition/index.ts';
import { openTestCatalog } from '../../mobile/src/nutrition/testing/test-catalog.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { changeLog, ownFood } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { push, upsertOp } from './support/sync.ts';

// Nachweis für #157: Das eigene Lebensmittel ist in der Entitäts-Registry beider Seiten angemeldet
// (Upsert/Delete, Last-Write-Wins, Löschen ist ein Tombstone). Eine Korrektur eines BLS-Lebensmittels
// aus dem App-Modul „Ernährung“ geht über die echte Hono-App nach Postgres und kommt per Pull auf einem
// zweiten Gerät derselben Person an; dort überdeckt sie die Quelle auch in der Suche. Der Server prüft
// nicht negative Nährwerte und Makros höchstens in Höhe der Bezugsmenge (Spezifikation 2, Abschnitt 11).

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Apfel roh aus dem BLS 4.0 (F110100), korrigiert um ein Stück von 180 g. */
const correctedApple = {
  name: 'Apfel roh',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 54_000,
  proteinMg: 424,
  carbsMg: 11_700,
  fatMg: 500,
  portions: [{ unit: 'stueck', label: '1 mittelgroßer', baseAmount: 180_000 }],
} as const;

async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const catalog = openTestCatalog();
  cleanups.push(() => {
    catalog.close();
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(start);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry([...foundationSyncEntities, nutritionEntryEntity, ownFoodEntity]);
  const writer = createSyncWriter({ registry, clock, newId });
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId(), onCanonicalChanges: () => {} });
  const nutrition = createNutrition({ database, clock, writer, newId, persistence: { reevaluateDailyGoals: () => {} } });
  const search = nutrition.foodSearch(catalog.database);
  return {
    nutrition,
    sync: () => engine.sync(),
    rows: () => database.read((tx) => sqliteOf(tx).select().from(localOwnFood).all()),
    search: (input: string) => names(search.search(input)),
  };
}

const names = (result: FoodSearchResult) => (result.type === 'treffer' ? result.hits.map((hit) => `${hit.mark}: ${hit.snapshot.name}`) : []);

async function setup() {
  const backend = await createTestBackend({ clock: createTestClock(start) });
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
  const a = await phone(backend, anna.accountId, anna.device);
  const b = await phone(backend, anna.accountId, second);
  await a.sync();
  await b.sync();
  return { backend, anna, a, b };
}

describe('Eigenes Lebensmittel im Sync', () => {
  it('pusht eine BLS-Korrektur, pullt sie auf dem zweiten Gerät samt Überdeckung und dort auch die Löschung', async () => {
    const { backend, anna, a, b } = await setup();

    const { ref } = a.nutrition.saveOwnFood({ type: 'bls', key: 'F110100' }, correctedApple);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    const [stored] = await backend.database.db.select().from(ownFood).where(eq(ownFood.id, ref.key));
    expect(stored).toMatchObject({
      personId: anna.personId, name: 'Apfel roh', milliKcal: 54_000, portions: correctedApple.portions, originType: 'bls', originKey: 'F110100', deletedAt: null,
    });
    expect(await backend.database.db.select().from(changeLog).where(eq(changeLog.entityId, ref.key))).toMatchObject([{ entityType: 'own_food', operation: 'upsert' }]);

    expect(b.search('Apfel roh')[0]).toBe('bls: Apfel roh');
    await b.sync();
    expect(b.rows()).toEqual([expect.objectContaining({ id: ref.key, originType: 'bls', originKey: 'F110100', serverVersion: stored!.serverVersion.toString() })]);
    expect(b.search('Apfel roh')).toEqual(['eigen: Apfel roh', 'bls: Apfel geschält, roh', 'bls: Granatapfel roh']);

    b.nutrition.deleteOwnFood(ref.key);
    await b.sync();
    await a.sync();

    const [tombstone] = await backend.database.db.select().from(ownFood).where(eq(ownFood.id, ref.key));
    expect(tombstone!.deletedAt).not.toBeNull();
    expect(a.rows()).toEqual([expect.objectContaining({ id: ref.key, deletedAt: tombstone!.deletedAt!.toISOString() })]);
    expect(a.search('Apfel roh')[0]).toBe('bls: Apfel roh');
  });

  it('übernimmt eine Änderung mit Last-Write-Wins unter derselben ID', async () => {
    const { backend, a, b } = await setup();
    const { ref } = a.nutrition.saveOwnFood(null, { ...correctedApple, name: 'Omas Apfelkuchen', portions: [] });
    await a.sync();
    await b.sync();

    b.nutrition.saveOwnFood(ref, { ...correctedApple, name: 'Omas Apfelkuchen', milliKcal: 260_000, portions: [] });
    await b.sync();
    await a.sync();

    expect((await backend.database.db.select().from(ownFood)).map((row) => [row.id, row.milliKcal])).toEqual([[ref.key, 260_000]]);
    expect(a.rows()).toEqual([expect.objectContaining({ id: ref.key, milliKcal: 260_000 })]);
  });

  const payload: OwnFoodUpsert = { ...correctedApple, portions: [...correctedApple.portions], origin: null };

  it.each([
    ['negative kcal', { milliKcal: -1 }],
    ['negatives Eiweiß', { proteinMg: -1 }],
    ['Makros schwerer als die Bezugsmenge', { proteinMg: 40_000, carbsMg: 40_000, fatMg: 20_001 }],
    ['Herkunft ohne gültigen BLS-Schlüssel', { origin: { type: 'bls', key: 'apfel' } }],
    ['ohne Fett', { fatMg: undefined }],
  ])('lehnt %s dauerhaft ab, ohne etwas zu speichern', async (_, change) => {
    const { backend, anna } = await setup();

    const [result] = await push(backend, anna.device, [upsertOp(randomUUID(), { ...payload, ...change }, { entityType: 'own_food' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload', retryable: false } });
    expect(await backend.database.db.select().from(ownFood)).toEqual([]);
  });

  it('nimmt Makros genau in Höhe der Bezugsmenge an, bei ml ohne Vergleich mit der Bezugsmenge', async () => {
    const { backend, anna } = await setup();

    const results = await push(backend, anna.device, [
      upsertOp(randomUUID(), { ...payload, proteinMg: 0, carbsMg: 0, fatMg: 100_000 }, { entityType: 'own_food' }),
      upsertOp(randomUUID(), { ...payload, baseUnit: 'ml', referenceAmount: 100, portions: [] }, { entityType: 'own_food' }),
    ]);

    expect(results).toMatchObject([{ type: 'applied' }, { type: 'applied' }]);
    expect(await backend.database.db.select().from(ownFood)).toHaveLength(2);
  });
});
