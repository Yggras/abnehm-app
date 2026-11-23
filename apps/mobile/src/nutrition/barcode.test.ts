/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { ownFoodBarcodeId, type FoodValues } from '@abnehm/contracts/nutrition';

import { insertPersonForTest } from '../daily-goals/testing/persisted';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { offCache, ownFood } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createNutrition, foodFavoriteEntity, InvalidNutritionInputError, nutritionEntryEntity, ownFoodEntity, type FoodSearchResult, type Nutrition } from '.';
import { productLookupTimeoutMs } from './barcode';
import { offAttribution, type FoodProductSource, type OffProduct } from './food-product-source';
import { createFakeFoodProductSource, fakeProducts, unknownFakeBarcode, type FakeFoodProductSource } from './testing/fake-food-product-source';
import { openTestCatalog } from './testing/test-catalog';
import { withoutNetwork } from './testing/without-network';

// Nachweis für #160: Barcode-Auflösung im App-Modul „Ernährung“ (Spezifikation 2, Abschnitte 3–5 und 11)
// gegen eine echte SQLite-Datei mit denselben Migrationen wie die App, die Testuhr und den Fake der
// `FoodProductSource`. Geprüft werden die Reihenfolge eigenes Lebensmittel, OFF-Cache, OFF-API mit allen fünf
// Ergebnissen, die Zeitüberschreitung von 8 s, die Aktualisierung nach 30 Tagen, die deterministische ID eines
// eigenen Lebensmittels mit Barcode-Herkunft und die Überdeckung in Auflösung, Suche und „Zuletzt verwendet“.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const morning = Instant.parse('2026-10-14T06:30:00.000Z');
const today = LocalDate.parse('2026-10-14');
const day = 24 * 60 * 60 * 1_000;
const yoghurtBarcode = '4000000000013';
const juiceBarcode = '4000000000020';
const yoghurt = fakeProducts[yoghurtBarcode]!;

/** Die Werte eines vollständigen Produkts je 100 g bzw. 100 ml, wie sie das Formular vorbelegt. */
function valuesOf(product: OffProduct, change: Partial<FoodValues> = {}): FoodValues {
  return {
    name: product.name!,
    baseUnit: product.baseUnit,
    referenceAmount: product.baseUnit === 'g' ? 100_000 : 100,
    milliKcal: product.milliKcalPer100!,
    proteinMg: product.proteinMgPer100!,
    carbsMg: product.carbsMgPer100!,
    fatMg: product.fatMgPer100!,
    portions: [...product.portions],
    ...change,
  };
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  jest.useRealTimers();
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup({ source = createFakeFoodProductSource() }: { source?: FakeFoodProductSource | FoodProductSource } = {}) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const catalog = openTestCatalog();
  cleanups.push(() => {
    catalog.close();
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock = createTestClock({ instant: morning, timeZone: TimeZone.parse('Europe/Berlin') });
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, ownFoodEntity, foodFavoriteEntity]), clock, newId });
  const nutrition = createNutrition({
    ...withoutNetwork,
    database,
    clock,
    writer,
    newId,
    persistence: { reevaluateDailyGoals: () => undefined },
    foodProducts: source,
  });
  const search = nutrition.foodSearch(catalog.database, 'fruehstueck');
  return {
    clock,
    nutrition,
    catalog: catalog.database,
    search: (input: string) => hitsOf(search.search(input)),
    cache: () => database.read((tx) => sqliteOf(tx).select().from(offCache).all()),
    ownFoods: () => database.read((tx) => sqliteOf(tx).select().from(ownFood).all()),
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
  };
}

function hitsOf(result: FoodSearchResult) {
  if (result.type !== 'treffer') throw new Error(`Suche ergab ${result.type}`);
  return result.hits.map((hit) => ({ mark: hit.mark, ref: hit.ref, name: hit.snapshot.name }));
}

/** Das Lebensmittel einer Auflösung, die `found` sein muss. */
async function foundFood(nutrition: Nutrition, barcode: string) {
  const resolution = await nutrition.resolveBarcode(barcode);
  if (resolution.type !== 'found') throw new Error(`Auflösung ergab ${resolution.type}`);
  return resolution.food;
}

/** Lässt laufende Hintergrundarbeit (Abfrage und Cache-Schreiben) fertig werden. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('Barcode-Auflösung (#160)', () => {
  it('found: ein unbekannter Barcode kommt von der OFF-API, landet im Cache und führt mit Quellenangabe in die Mengenprüfung', async () => {
    const { nutrition, cache } = await setup();
    const resolution = await nutrition.resolveBarcode(yoghurtBarcode);
    expect(resolution).toEqual({
      type: 'found',
      food: {
        ref: { type: 'off', key: yoghurtBarcode },
        snapshot: expect.objectContaining({ name: 'Naturjoghurt 3,5 %', baseUnit: 'g', referenceAmount: 100_000, milliKcal: 64_000, source: 'off', attribution: offAttribution }),
      },
    });
    expect(cache()).toEqual([expect.objectContaining({ barcode: yoghurtBarcode, name: 'Naturjoghurt 3,5 %', brand: 'Testmolkerei', fetchedAt: morning })]);
  });

  it('found: ein gescanntes Produkt findet sich danach auch offline wieder', async () => {
    const source = createFakeFoodProductSource();
    const { nutrition } = await setup({ source });
    await nutrition.resolveBarcode(juiceBarcode);
    source.setMode('offline');
    expect(await nutrition.resolveBarcode(juiceBarcode)).toMatchObject({ type: 'found', food: { ref: { type: 'off', key: juiceBarcode }, snapshot: { baseUnit: 'ml', referenceAmount: 100 } } });
    expect(source.calls).toEqual([juiceBarcode]);
  });

  it('incomplete: fehlt kcal oder ein Makro, liefert die Auflösung alle bekannten Werte und speichert den Eintrag', async () => {
    const source = createFakeFoodProductSource({ mode: 'unvollstaendig' });
    const { nutrition, cache, search } = await setup({ source });
    expect(await nutrition.resolveBarcode(yoghurtBarcode)).toEqual({ type: 'incomplete', barcode: yoghurtBarcode, product: { ...yoghurt, milliKcalPer100: null } });
    expect(cache()).toEqual([expect.objectContaining({ barcode: yoghurtBarcode, milliKcalPer100: null })]);
    // Ein unvollständiges Produkt lässt sich nicht erfassen und erscheint deshalb nicht in der Suche.
    expect(search('Naturjoghurt')).toEqual([]);
  });

  it('not_found: OFF kennt den Barcode nicht; der Cache bleibt leer', async () => {
    const { nutrition, cache } = await setup();
    expect(await nutrition.resolveBarcode(unknownFakeBarcode)).toEqual({ type: 'not_found', barcode: unknownFakeBarcode });
    expect(cache()).toEqual([]);
  });

  it('offline_unknown: ohne Netz und ohne Cache-Eintrag', async () => {
    const { nutrition } = await setup({ source: createFakeFoodProductSource({ mode: 'offline' }) });
    expect(await nutrition.resolveBarcode(yoghurtBarcode)).toEqual({ type: 'offline_unknown', barcode: yoghurtBarcode });
  });

  it.each(['http_429', 'http_503'] as const)('unavailable: %s ist erneut versuchbar', async (mode) => {
    const { nutrition, cache } = await setup({ source: createFakeFoodProductSource({ mode }) });
    expect(await nutrition.resolveBarcode(yoghurtBarcode)).toEqual({ type: 'unavailable', barcode: yoghurtBarcode, retryable: true });
    expect(cache()).toEqual([]);
  });

  it('unavailable: nach 8 s ohne Antwort bricht die Abfrage ab, nicht früher', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    const { nutrition } = await setup({ source: createFakeFoodProductSource({ mode: 'zeitueberschreitung' }) });
    let outcome: unknown = 'läuft';
    void nutrition.resolveBarcode(yoghurtBarcode).then((resolution) => (outcome = resolution));
    await jest.advanceTimersByTimeAsync(productLookupTimeoutMs - 1);
    expect(outcome).toBe('läuft');
    await jest.advanceTimersByTimeAsync(1);
    expect(outcome).toEqual({ type: 'unavailable', barcode: yoghurtBarcode, retryable: true });
  });

  it('ein Barcode, den die Lebensmittelreferenz nicht nimmt, wird abgelehnt, ohne OFF zu fragen', async () => {
    const source = createFakeFoodProductSource();
    const { nutrition } = await setup({ source });
    await expect(nutrition.resolveBarcode('12345')).rejects.toBeInstanceOf(InvalidNutritionInputError);
    expect(source.calls).toEqual([]);
  });
});

describe('OFF-Cache nach 30 Tagen (#160, Testuhr)', () => {
  async function cachedThenAged(days: number) {
    const source = createFakeFoodProductSource();
    const context = await setup({ source });
    await context.nutrition.resolveBarcode(yoghurtBarcode);
    context.clock.advanceBy(days * day);
    return { ...context, source };
  }

  it('ein Eintrag bis 30 Tage gilt ohne neue Abfrage', async () => {
    const { nutrition, source } = await cachedThenAged(30);
    expect(await nutrition.resolveBarcode(yoghurtBarcode)).toMatchObject({ type: 'found' });
    await settle();
    expect(source.calls).toEqual([yoghurtBarcode]);
  });

  it('ein älterer Eintrag gilt sofort und wird im Hintergrund aktualisiert', async () => {
    const changed: OffProduct = { ...yoghurt, name: 'Naturjoghurt mild', milliKcalPer100: 61_000 };
    const source = createFakeFoodProductSource({ products: { [yoghurtBarcode]: yoghurt } });
    const { nutrition, clock, cache } = await setup({ source });
    await nutrition.resolveBarcode(yoghurtBarcode);
    clock.advanceBy(31 * day);
    const later = Instant.parse(clock.read().instant);
    // Die neue Fassung bei OFF: Die Auflösung liefert noch die alte, der Cache danach die neue.
    const refreshed = createFakeFoodProductSource({ products: { [yoghurtBarcode]: changed } });
    Object.assign(source, { lookup: refreshed.lookup });
    expect(await nutrition.resolveBarcode(yoghurtBarcode)).toMatchObject({ type: 'found', food: { snapshot: { name: 'Naturjoghurt 3,5 %' } } });
    await settle();
    expect(cache()).toEqual([expect.objectContaining({ name: 'Naturjoghurt mild', milliKcalPer100: 61_000, fetchedAt: later })]);
  });

  it.each(['offline', 'nicht_gefunden', 'http_503'] as const)('ein Fehlschlag (%s) lässt den älteren Eintrag unverändert', async (mode) => {
    const { nutrition, source, cache } = await cachedThenAged(31);
    source.setMode(mode);
    expect(await nutrition.resolveBarcode(yoghurtBarcode)).toMatchObject({ type: 'found' });
    await settle();
    expect(source.calls).toEqual([yoghurtBarcode, yoghurtBarcode]);
    expect(cache()).toEqual([expect.objectContaining({ name: 'Naturjoghurt 3,5 %', fetchedAt: morning })]);
  });
});

describe('Eigenes Lebensmittel mit Barcode-Herkunft (#160)', () => {
  it('Korrigieren legt ein eigenes Lebensmittel mit deterministischer ID und Herkunftsreferenz an, samt Outbox-Operation', async () => {
    const { nutrition, ownFoods, operations, cache } = await setup();
    await nutrition.resolveBarcode(yoghurtBarcode);
    const saved = nutrition.saveOwnFood({ type: 'off', key: yoghurtBarcode }, valuesOf(yoghurt, { milliKcal: 70_000 }));
    const id = ownFoodBarcodeId(philipp, yoghurtBarcode);
    expect(saved.ref).toEqual({ type: 'eigen', key: id });
    expect(ownFoods()).toEqual([expect.objectContaining({ id, originType: 'off', originKey: yoghurtBarcode, milliKcal: 70_000 })]);
    expect(operations()).toEqual([expect.objectContaining({ entityType: 'own_food', entityId: id, type: 'upsert_entity' })]);
    // Die externen Daten bleiben unverändert.
    expect(cache()).toEqual([expect.objectContaining({ milliKcalPer100: 64_000 })]);
  });

  it('ein zweites Korrigieren desselben Barcodes ändert dasselbe eigene Lebensmittel, wie auf einem zweiten Gerät', async () => {
    const { nutrition, ownFoods } = await setup();
    nutrition.saveOwnFood({ type: 'off', key: yoghurtBarcode }, valuesOf(yoghurt, { milliKcal: 70_000 }));
    nutrition.saveOwnFood({ type: 'off', key: yoghurtBarcode }, valuesOf(yoghurt, { milliKcal: 72_000 }));
    expect(ownFoods()).toEqual([expect.objectContaining({ id: ownFoodBarcodeId(philipp, yoghurtBarcode), milliKcal: 72_000 })]);
  });

  it('ein unbekanntes Produkt (not_found) wird aus dem Formular zum eigenen Lebensmittel und danach ohne OFF aufgelöst', async () => {
    const source = createFakeFoodProductSource();
    const { nutrition } = await setup({ source });
    expect(await nutrition.resolveBarcode(unknownFakeBarcode)).toMatchObject({ type: 'not_found' });
    nutrition.saveOwnFood({ type: 'off', key: unknownFakeBarcode }, valuesOf(yoghurt, { name: 'Hofmilch' }));
    source.setMode('offline');
    expect(await nutrition.resolveBarcode(unknownFakeBarcode)).toMatchObject({
      type: 'found',
      food: { ref: { type: 'eigen', key: ownFoodBarcodeId(philipp, unknownFakeBarcode) }, snapshot: { name: 'Hofmilch', source: 'eigen' } },
    });
    expect(source.calls).toEqual([unknownFakeBarcode]);
  });

  it('überdeckt Cache und API in Auflösung, Suche und „Zuletzt verwendet“', async () => {
    const source = createFakeFoodProductSource();
    const { nutrition, search, catalog } = await setup({ source });
    await nutrition.resolveBarcode(yoghurtBarcode);
    // Vor der Korrektur: das Produkt in seiner Gruppe zwischen eigenen Lebensmitteln und BLS.
    expect(search('Naturjoghurt')).toEqual([{ mark: 'produkt', ref: { type: 'off', key: yoghurtBarcode }, name: 'Naturjoghurt 3,5 %' }]);
    nutrition.addEntry({ localDate: today, meal: 'fruehstueck', captureMethod: 'barcode', foodRef: { type: 'off', key: yoghurtBarcode }, snapshot: (await foundFood(nutrition, yoghurtBarcode)).snapshot, displayUnit: 'portion', displayAmountMilli: 1_000 });

    const own = nutrition.saveOwnFood({ type: 'off', key: yoghurtBarcode }, valuesOf(yoghurt, { name: 'Naturjoghurt (korrigiert)', milliKcal: 70_000 }));
    expect(await nutrition.resolveBarcode(yoghurtBarcode)).toEqual({ type: 'found', food: own });
    expect(search('Naturjoghurt')).toEqual([
      // Zuletzt verwendet in der Mahlzeit, aufgelöst zum eigenen Lebensmittel; Produkt und eigene Gruppe zeigen es nicht noch einmal.
      { mark: 'zuletzt', ref: own.ref, name: 'Naturjoghurt (korrigiert)' },
    ]);
    let recent: readonly { ref: unknown; snapshot: { name: string } }[] = [];
    nutrition.observeQuickFoods(catalog, 'fruehstueck', (foods) => (recent = foods?.recent ?? []))();
    expect(recent.map(({ ref, snapshot }) => ({ ref, name: snapshot.name }))).toEqual([{ ref: own.ref, name: 'Naturjoghurt (korrigiert)' }]);
    expect(source.calls).toEqual([yoghurtBarcode]);
  });

  it('lässt sich nicht löschen; ein eigenes Lebensmittel ohne Barcode schon', async () => {
    const { nutrition, ownFoods, operations } = await setup();
    const product = nutrition.saveOwnFood({ type: 'off', key: yoghurtBarcode }, valuesOf(yoghurt));
    const plain = nutrition.saveOwnFood(null, valuesOf(yoghurt, { name: 'Hausjoghurt' }));
    expect(nutrition.isOwnFoodDeletable(product.ref.key)).toBe(false);
    expect(nutrition.isOwnFoodDeletable(plain.ref.key)).toBe(true);
    expect(() => nutrition.deleteOwnFood(product.ref.key)).toThrow(InvalidNutritionInputError);
    expect(ownFoods().find((row) => row.id === product.ref.key)?.deletedAt).toBeNull();
    expect(operations()).toHaveLength(2);
  });
});

describe('Suche: gescannte Produkte (#160)', () => {
  it('stehen als „Produkt“ zwischen eigenen Lebensmitteln und BLS, normalisiert wie die übrigen Gruppen', async () => {
    const { nutrition, search } = await setup({
      source: createFakeFoodProductSource({ products: { [yoghurtBarcode]: { ...yoghurt, name: 'Apfelsaft naturtrüb' } } }),
    });
    await nutrition.resolveBarcode(yoghurtBarcode);
    nutrition.saveOwnFood(null, valuesOf(yoghurt, { name: 'Apfelkuchen von Oma' }));
    expect(search('apfel').slice(0, 3)).toEqual([
      { mark: 'eigen', ref: expect.objectContaining({ type: 'eigen' }), name: 'Apfelkuchen von Oma' },
      { mark: 'produkt', ref: { type: 'off', key: yoghurtBarcode }, name: 'Apfelsaft naturtrüb' },
      expect.objectContaining({ mark: 'bls' }),
    ]);
    expect(search('NATURTRUEB')).toEqual([{ mark: 'produkt', ref: { type: 'off', key: yoghurtBarcode }, name: 'Apfelsaft naturtrüb' }]);
  });
});
