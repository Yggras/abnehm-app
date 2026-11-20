import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { foodFavoriteId, type FoodFavoriteUpsert, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { foodFavorite as localFoodFavorite } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createNutrition, foodFavoriteEntity, nutritionEntryEntity, ownFoodEntity, type QuickFoods } from '../../mobile/src/nutrition/index.ts';
import { openTestCatalog } from '../../mobile/src/nutrition/testing/test-catalog.ts';
import { withoutPhotos } from '../../mobile/src/nutrition/testing/without-photos.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { foodFavorite } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { deleteOp, push, upsertOp } from './support/sync.ts';

// Nachweis für #158: Der Lebensmittelfavorit ist in der Entitäts-Registry beider Seiten angemeldet. Zwei
// Offline-Installationen derselben Person, die dasselbe Lebensmittel markieren, ergeben nach dem Sync über
// die echte Hono-App und Postgres genau einen Favoriten, weil die ID deterministisch aus Person und
// Lebensmittelreferenz folgt. Entfernen ist ein Upsert mit `removedAt`, kein Tombstone; ein erneutes
// Markieren derselben ID gelingt. Der Server lehnt eine ID ab, die nicht zu Eigentümer und Referenz passt,
// und kennt kein Löschen über den Sync.

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Hafer Flocken aus dem BLS 4.0 (C133000), wie der Testkatalog sie liefert. */
const oats = {
  ref: { type: 'bls', key: 'C133000' },
  snapshot: {
    name: 'Hafer Flocken', baseUnit: 'g', referenceAmount: 100_000, milliKcal: 348_000, proteinMg: 13_220, carbsMg: 53_300, fatMg: 6_650, portions: [],
    source: 'bls', attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0',
  } satisfies NutritionSnapshot,
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
  const registry = createSyncRegistry([...foundationSyncEntities, nutritionEntryEntity, ownFoodEntity, foodFavoriteEntity]);
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
  const nutrition = createNutrition({ ...withoutPhotos, database, clock, writer, newId, persistence: { reevaluateDailyGoals: () => {} } });
  return {
    nutrition,
    clock,
    sync: () => engine.sync(),
    rows: () => database.read((tx) => sqliteOf(tx).select().from(localFoodFavorite).all()),
    favorites() {
      let foods: QuickFoods | null = null;
      nutrition.observeQuickFoods(catalog.database, 'fruehstueck', (value) => (foods = value))();
      return (foods as QuickFoods | null)?.favorites.map((favorite) => favorite.snapshot.name) ?? [];
    },
  };
}

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

describe('Lebensmittelfavorit im Sync', () => {
  it('ergibt genau einen Favoriten, wenn zwei Offline-Installationen dasselbe Lebensmittel markieren', async () => {
    const { backend, anna, a, b } = await setup();
    const id = foodFavoriteId(EntityId.parse(anna.personId), oats.ref);

    // Beide Geräte sind offline: Jedes markiert, ohne vom anderen zu wissen.
    a.nutrition.markFoodFavorite(oats);
    b.nutrition.markFoodFavorite(oats);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });
    expect(await b.sync()).toEqual({ push: 'done', pull: 'done' });
    await a.sync();

    const stored = await backend.database.db.select().from(foodFavorite);
    expect(stored).toEqual([
      expect.objectContaining({ id, personId: anna.personId, foodRefType: 'bls', foodRefKey: 'C133000', removedAt: null, deletedAt: null }),
    ]);
    for (const device of [a, b]) {
      expect(device.rows()).toEqual([expect.objectContaining({ id, removedAt: null, serverVersion: stored[0]!.serverVersion.toString() })]);
      expect(device.favorites()).toEqual(['Hafer Flocken']);
    }
  });

  it('überträgt Entfernen als Upsert mit `removedAt`; danach lässt sich dieselbe ID erneut markieren', async () => {
    const { backend, anna, a, b } = await setup();
    a.nutrition.markFoodFavorite(oats);
    await a.sync();
    await b.sync();

    b.nutrition.unmarkFoodFavorite(oats);
    await b.sync();
    await a.sync();

    const [removed] = await backend.database.db.select().from(foodFavorite);
    expect(removed).toMatchObject({ id: foodFavoriteId(EntityId.parse(anna.personId), oats.ref), deletedAt: null });
    expect(removed!.removedAt).not.toBeNull();
    expect(a.favorites()).toEqual([]);

    a.clock.advanceBy(60_000);
    a.nutrition.markFoodFavorite(oats);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });
    await b.sync();

    expect(await backend.database.db.select().from(foodFavorite)).toEqual([expect.objectContaining({ removedAt: null, deletedAt: null })]);
    expect(b.favorites()).toEqual(['Hafer Flocken']);
  });

  const payload: FoodFavoriteUpsert = { foodRef: oats.ref, snapshot: { ...oats.snapshot, portions: [] }, removedAt: null };

  it('lehnt eine ID ab, die nicht aus Eigentümer und Referenz folgt, ohne etwas zu speichern', async () => {
    const { backend, anna } = await setup();

    const [result] = await push(backend, anna.device, [upsertOp(randomUUID(), payload, { entityType: 'food_favorite' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload', retryable: false } });
    expect(await backend.database.db.select().from(foodFavorite)).toEqual([]);
  });

  it('lehnt eine Fassung ab, die nicht zur Referenz passt', async () => {
    const { backend, anna } = await setup();

    const [result] = await push(backend, anna.device, [
      upsertOp(foodFavoriteId(EntityId.parse(anna.personId), oats.ref), { ...payload, snapshot: { ...payload.snapshot, source: 'eigen', attribution: null } }, { entityType: 'food_favorite' }),
    ]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
  });

  it('kennt kein Löschen über den Sync', async () => {
    const { backend, anna } = await setup();
    const id = foodFavoriteId(EntityId.parse(anna.personId), oats.ref);
    await push(backend, anna.device, [upsertOp(id, payload, { entityType: 'food_favorite' })]);

    const [result] = await push(backend, anna.device, [deleteOp(id, { entityType: 'food_favorite' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected' });
    expect(await backend.database.db.select().from(foodFavorite)).toEqual([expect.objectContaining({ id, deletedAt: null })]);
  });
});
