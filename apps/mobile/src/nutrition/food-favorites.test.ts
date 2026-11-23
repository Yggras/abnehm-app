/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, localDateAfter, TimeZone, type MealKey } from '@abnehm/contracts/base';
import {
  FoodFavoriteUpsert,
  foodFavoriteId,
  photoDraftSnapshot,
  type CaptureMethod,
  type FoodRef,
  type FoodValues,
  type NutritionSnapshot,
} from '@abnehm/contracts/nutrition';

import { insertPersonForTest } from '../daily-goals/testing/persisted';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { foodFavorite, offCache, ownFood } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createNutrition, foodFavoriteEntity, InvalidNutritionInputError, mealPhotoEntity, nutritionEntryEntity, ownFoodEntity, type FoodSearchResult, type QuickFoods } from '.';
import { offAttribution } from './food-product-source';
import { openTestCatalog, testCatalogFoods } from './testing/test-catalog';
import { withoutNetwork } from './testing/without-network';

// Nachweis für #158: Lebensmittelfavoriten und „Zuletzt verwendet“ im App-Modul „Ernährung“
// (Spezifikation 2, Abschnitte 4, 6 und 7) gegen eine echte SQLite-Datei mit denselben Migrationen wie die
// App, den BLS-Testkatalog und die Testuhr. Geprüft werden Markieren und Entfernen samt Outbox-Operation
// und deterministischer ID, das Markieren einer KI-Schätzung, Folgen und Rückfall in allen drei Fällen,
// „Zuletzt verwendet“ (eindeutig je Mahlzeit, 30-Tage-Grenze, ohne KI-Einträge ohne Referenz, Überdeckung)
// und die Rangfolge der Suche.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const morning = Instant.parse('2026-10-14T06:30:00.000Z');
const today = LocalDate.parse('2026-10-14');
const blsAttribution = 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0';

/** Ein BLS-Lebensmittel des Testkatalogs als Snapshot, wie ihn die Suche liefert. */
function bls(key: string): { ref: Extract<FoodRef, { type: 'bls' }>; snapshot: NutritionSnapshot } {
  const food = testCatalogFoods.find((candidate) => candidate.key === key);
  if (food === undefined) throw new Error(`${key} fehlt im Testkatalog`);
  return {
    ref: { type: 'bls', key },
    snapshot: {
      name: food.name,
      baseUnit: 'g',
      referenceAmount: 100_000,
      milliKcal: food.milliKcalPer100,
      proteinMg: food.proteinMgPer100,
      carbsMg: food.carbsMgPer100,
      fatMg: food.fatMgPer100,
      portions: [],
      source: 'bls',
      attribution: blsAttribution,
    },
  };
}

const oats = bls('C133000');
const apple = bls('F110100');
const juice = bls('F110600');

/** Ein Bircher-Müsli aus dem Glas: 100 g mit 150 kcal, ein Glas sind 250 g. */
const muesli: FoodValues = {
  name: 'Bircher-Müsli im Glas',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 150_000,
  proteinMg: 4_500,
  carbsMg: 21_000,
  fatMg: 5_200,
  portions: [{ unit: 'portion', label: '1 Glas', baseAmount: 250_000 }],
};

/** KI-Schätzung eines Fotoentwurfs: 180 g Bratkartoffeln, ohne Lebensmittelreferenz. */
const aiPotatoes = photoDraftSnapshot({ name: 'Bratkartoffeln', baseUnit: 'g', baseAmount: 180_000, milliKcal: 270_000, proteinMg: 4_000, carbsMg: 32_000, fatMg: 13_000 });

/** Ein Haferdrink mit Barcode, wie ihn der Open-Food-Facts-Cache führt. */
const oatDrink: { ref: FoodRef; snapshot: NutritionSnapshot } = {
  ref: { type: 'off', key: '4006040001234' },
  snapshot: {
    name: 'Hafer Drink', baseUnit: 'ml', referenceAmount: 100, milliKcal: 46_000, proteinMg: 300, carbsMg: 6_700, fatMg: 1_500, portions: [],
    source: 'off', attribution: offAttribution,
  },
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup({ catalogFoods = testCatalogFoods }: { catalogFoods?: typeof testCatalogFoods } = {}) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const catalog = openTestCatalog(catalogFoods);
  cleanups.push(() => {
    catalog.close();
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock = createTestClock({ instant: morning, timeZone: TimeZone.parse('Europe/Berlin') });
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, ownFoodEntity, foodFavoriteEntity, mealPhotoEntity]), clock, newId });
  const nutrition = createNutrition({ ...withoutNetwork, database, clock, writer, newId, persistence: { reevaluateDailyGoals: () => {} } });

  /** Ein Eintrag aus Suche, Favorit oder „Zuletzt“; die Uhr läuft danach eine Minute weiter. */
  const add = (
    food: { ref: FoodRef; snapshot: NutritionSnapshot },
    grams: number,
    { meal = 'fruehstueck', localDate = today, captureMethod = 'suche' }: { meal?: MealKey; localDate?: LocalDate; captureMethod?: CaptureMethod } = {},
  ) => {
    const outcome = nutrition.addEntry({ localDate, meal, captureMethod, foodRef: food.ref, snapshot: food.snapshot, displayUnit: food.snapshot.baseUnit, displayAmountMilli: grams * 1_000 });
    clock.advanceBy(60_000);
    return outcome;
  };

  const quick = (meal: MealKey = 'fruehstueck'): QuickFoods => {
    let foods: QuickFoods | null = null;
    nutrition.observeQuickFoods(catalog.database, meal, (value) => (foods = value))();
    if (foods === null) throw new Error('Keine eigene Person');
    return foods;
  };

  return {
    database,
    catalog: catalog.database,
    clock,
    nutrition,
    add,
    quick,
    /** „Zuletzt verwendet“ als „Name · Menge“, in Rangfolge. */
    recent: (meal?: MealKey) => quick(meal).recent.map(({ snapshot, prefill }) => `${snapshot.name} · ${prefill.displayAmountMilli / 1_000} ${prefill.displayUnit}`),
    favoriteNames: () => quick().favorites.map(({ snapshot }) => snapshot.name),
    isFavorite(ref: FoodRef) {
      let marked: boolean | undefined;
      nutrition.observeFoodFavorite({ ref }, (value) => (marked = value))();
      return marked;
    },
    search: (input: string, meal: MealKey = 'fruehstueck') => hitsOf(nutrition.foodSearch(catalog.database, meal).search(input)),
    favorites: () => database.read((tx) => sqliteOf(tx).select().from(foodFavorite).all()),
    ownFoods: () => database.read((tx) => sqliteOf(tx).select().from(ownFood).all()),
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
  };
}

/** Treffer als „Quellenmarke: Name“, in Rangfolge. */
function hitsOf(result: FoodSearchResult): string[] | 'zu_kurz' {
  return result.type === 'zu_kurz' ? 'zu_kurz' : result.hits.map((hit) => `${hit.mark}: ${hit.snapshot.name}`);
}

describe('Lebensmittelfavorit markieren und entfernen', () => {
  it('markiert unter der deterministischen ID aus Person und Referenz, samt genau einer Outbox-Operation', async () => {
    const { nutrition, favorites, operations, isFavorite, favoriteNames } = await setup();

    expect(nutrition.markFoodFavorite(oats)).toEqual(oats.ref);

    const id = foodFavoriteId(philipp, oats.ref);
    expect(favorites()).toEqual([expect.objectContaining({ id, personId: philipp, foodRefType: 'bls', foodRefKey: 'C133000', removedAt: null, deletedAt: null })]);
    expect(operations()).toEqual([
      expect.objectContaining({
        type: 'upsert_entity', entityType: 'food_favorite', entityId: id, knownServerVersion: null,
        payload: FoodFavoriteUpsert.parse({ foodRef: oats.ref, snapshot: oats.snapshot, removedAt: null }),
      }),
    ]);
    expect(isFavorite(oats.ref)).toBe(true);
    expect(favoriteNames()).toEqual(['Hafer Flocken']);
  });

  it('ein zweites Markieren ändert nichts', async () => {
    const { nutrition, operations } = await setup();
    nutrition.markFoodFavorite(oats);

    nutrition.markFoodFavorite(oats);

    expect(operations()).toHaveLength(1);
  });

  it('entfernt die Markierung als Upsert mit `removedAt`, nie als Tombstone; erneutes Markieren nutzt dieselbe ID', async () => {
    const { nutrition, clock, favorites, operations, isFavorite, favoriteNames } = await setup();
    nutrition.markFoodFavorite(oats);
    clock.advanceBy(60_000);

    nutrition.unmarkFoodFavorite(oats);

    const id = foodFavoriteId(philipp, oats.ref);
    expect(favorites()).toEqual([expect.objectContaining({ id, removedAt: '2026-10-14T06:31:00.000Z', deletedAt: null })]);
    expect(isFavorite(oats.ref)).toBe(false);
    expect(favoriteNames()).toEqual([]);

    nutrition.markFoodFavorite(oats);

    expect(favorites()).toEqual([expect.objectContaining({ id, removedAt: null })]);
    expect(operations().map((operation) => [operation.type, 'entityId' in operation ? operation.entityId : null])).toEqual([
      ['upsert_entity', id],
      ['upsert_entity', id],
      ['upsert_entity', id],
    ]);
    expect(isFavorite(oats.ref)).toBe(true);
  });

  it('Entfernen ohne Favorit ändert nichts', async () => {
    const { nutrition, operations } = await setup();

    nutrition.unmarkFoodFavorite(oats);

    expect(operations()).toEqual([]);
  });

  it('legt beim Markieren einer KI-Schätzung ohne Referenz zuerst ein eigenes Lebensmittel aus ihrem Snapshot an', async () => {
    const { nutrition, ownFoods, favorites, operations, isFavorite, favoriteNames } = await setup();

    const ref = nutrition.markFoodFavorite({ ref: null, snapshot: aiPotatoes });

    expect(ref).toEqual({ type: 'eigen', key: expect.any(String) });
    expect(ownFoods()).toEqual([
      expect.objectContaining({ id: ref.key, name: 'Bratkartoffeln', baseUnit: 'g', referenceAmount: 180_000, milliKcal: 270_000, originType: null, deletedAt: null }),
    ]);
    expect(favorites()).toEqual([expect.objectContaining({ id: foodFavoriteId(philipp, ref), foodRefType: 'eigen', foodRefKey: ref.key })]);
    expect(favorites()[0]?.snapshot).toMatchObject({ name: 'Bratkartoffeln', source: 'eigen', attribution: null, referenceAmount: 180_000 });
    // Eigenes Lebensmittel und Favorit: zwei Operationen in einer Transaktion.
    expect(operations().map((operation) => `${operation.type} ${'entityType' in operation ? operation.entityType : ''}`)).toEqual([
      'upsert_entity own_food',
      'upsert_entity food_favorite',
    ]);
    expect(isFavorite(ref)).toBe(true);
    expect(favoriteNames()).toEqual(['Bratkartoffeln']);
  });

  it('erkennt eine schon markierte KI-Schätzung wieder: kein zweites eigenes Lebensmittel, Stern und Entfernen wirken', async () => {
    const { nutrition, ownFoods, favorites, operations, favoriteNames } = await setup();
    const estimate = { ref: null, snapshot: aiPotatoes } as const;
    const marked = () => {
      let value: boolean | undefined;
      nutrition.observeFoodFavorite(estimate, (current) => (value = current))();
      return value;
    };
    expect(marked()).toBe(false);
    const ref = nutrition.markFoodFavorite(estimate);

    // Erneut geöffnete Eintragsdetails kennen nur den Eintrag ohne Referenz.
    expect(marked()).toBe(true);
    expect(nutrition.markFoodFavorite(estimate)).toEqual(ref);
    nutrition.unmarkFoodFavorite(estimate);
    expect(marked()).toBe(false);
    expect(favoriteNames()).toEqual([]);
    expect(nutrition.markFoodFavorite(estimate)).toEqual(ref);

    expect(ownFoods()).toHaveLength(1);
    expect(favorites()).toEqual([expect.objectContaining({ foodRefKey: ref.key, removedAt: null })]);
    expect(operations().map((operation) => `${operation.type} ${'entityType' in operation ? operation.entityType : ''}`)).toEqual([
      'upsert_entity own_food',
      'upsert_entity food_favorite',
      'upsert_entity food_favorite',
      'upsert_entity food_favorite',
    ]);
  });

  it('weist eine Fassung zurück, die nicht zur Referenz passt, ohne etwas zu schreiben', async () => {
    const { nutrition, favorites, operations } = await setup();

    expect(() => nutrition.markFoodFavorite({ ref: apple.ref, snapshot: { ...oats.snapshot, source: 'eigen', attribution: null } })).toThrow(InvalidNutritionInputError);
    expect(favorites()).toEqual([]);
    expect(operations()).toEqual([]);
  });

  it('gilt für ein eigenes Lebensmittel, das die markierte Quelle überdeckt: dort entfernen entfernt den Favoriten der Quelle', async () => {
    const { nutrition, isFavorite, favoriteNames, quick } = await setup();
    nutrition.markFoodFavorite(apple);
    const corrected = nutrition.saveOwnFood(apple.ref, { ...muesli, name: 'Apfel roh', portions: [{ unit: 'stueck', label: '1 mittelgroßer', baseAmount: 180_000 }] });

    expect(isFavorite(corrected.ref)).toBe(true);
    expect(quick().favorites).toEqual([expect.objectContaining({ ref: corrected.ref, available: true })]);

    nutrition.unmarkFoodFavorite(corrected);

    expect(isFavorite(apple.ref)).toBe(false);
    expect(favoriteNames()).toEqual([]);
  });
});

describe('Folgen und Rückfall', () => {
  it('folgt einem geänderten eigenen Lebensmittel; „Verwenden“ aktualisiert die gespeicherte Fassung', async () => {
    const { nutrition, catalog, quick, favorites, operations } = await setup();
    const own = nutrition.saveOwnFood(null, muesli);
    nutrition.markFoodFavorite(own);
    nutrition.saveOwnFood(own.ref, { ...muesli, milliKcal: 160_000 });

    expect(quick().favorites).toEqual([expect.objectContaining({ ref: own.ref, available: true, snapshot: expect.objectContaining({ milliKcal: 160_000 }) })]);
    // Die gespeicherte Fassung bleibt bis zum Verwenden.
    expect(favorites()[0]?.snapshot).toMatchObject({ milliKcal: 150_000 });

    nutrition.recordFavoriteUse(catalog, own.ref);

    expect(favorites()[0]?.snapshot).toMatchObject({ milliKcal: 160_000 });
    expect(operations().at(-1)).toMatchObject({ type: 'upsert_entity', entityType: 'food_favorite', payload: { snapshot: { milliKcal: 160_000 } } });
    // Ein zweites Verwenden ohne Änderung schreibt nichts.
    const count = operations().length;
    nutrition.recordFavoriteUse(catalog, own.ref);
    expect(operations()).toHaveLength(count);
  });

  it('nutzt die letzte Fassung, wenn das eigene Lebensmittel gelöscht ist', async () => {
    const { nutrition, quick } = await setup();
    const own = nutrition.saveOwnFood(null, muesli);
    nutrition.markFoodFavorite(own);
    nutrition.deleteOwnFood(own.ref.key);

    expect(quick().favorites).toEqual([
      expect.objectContaining({ ref: own.ref, available: false, snapshot: own.snapshot, prefill: { displayUnit: 'portion', displayAmountMilli: 1_000 } }),
    ]);
  });

  it('nutzt die letzte Fassung, wenn der Cache-Eintrag fehlt, und die aktuellen Werte, sobald er da ist', async () => {
    const { nutrition, database, catalog, quick, favorites } = await setup();
    nutrition.markFoodFavorite(oatDrink);

    expect(quick().favorites).toEqual([expect.objectContaining({ ref: oatDrink.ref, available: false, snapshot: oatDrink.snapshot })]);

    database.transaction((tx) =>
      sqliteOf(tx)
        .insert(offCache)
        .values({
          barcode: oatDrink.ref.key, name: 'Hafer Drink Barista', brand: 'Beispiel', baseUnit: 'ml',
          milliKcalPer100: 59_000, proteinMgPer100: 1_000, carbsMgPer100: 6_600, fatMgPer100: 3_000, portions: [], fetchedAt: morning,
        })
        .run(),
    );

    expect(quick().favorites).toEqual([expect.objectContaining({ available: true, snapshot: expect.objectContaining({ name: 'Hafer Drink Barista', milliKcal: 59_000 }) })]);
    nutrition.recordFavoriteUse(catalog, oatDrink.ref);
    expect(favorites()[0]?.snapshot).toMatchObject({ name: 'Hafer Drink Barista', source: 'off', attribution: offAttribution });
  });

  it('nutzt die letzte Fassung, wenn der BLS-Schlüssel nicht mehr im Katalog steht', async () => {
    const { nutrition, quick, catalog, favorites, operations } = await setup({ catalogFoods: testCatalogFoods.filter((food) => food.key !== 'C133000') });
    nutrition.markFoodFavorite(oats);

    expect(quick().favorites).toEqual([expect.objectContaining({ ref: oats.ref, available: false, snapshot: oats.snapshot })]);
    // Ohne verfügbare Referenz bleibt die gespeicherte Fassung.
    nutrition.recordFavoriteUse(catalog, oats.ref);
    expect(operations()).toHaveLength(1);
    expect(favorites()[0]?.snapshot).toEqual(oats.snapshot);
  });

  it('belegt die Menge eines Favoriten mit der zuletzt verwendeten vor', async () => {
    const { nutrition, add, quick } = await setup();
    nutrition.markFoodFavorite(oats);
    add(oats, 45, { meal: 'snacks' });

    expect(quick().favorites[0]?.prefill).toEqual({ displayUnit: 'g', displayAmountMilli: 45_000 });
  });

  it('ordnet Favoriten nach letzter Verwendung, nie verwendete danach nach Name', async () => {
    const { nutrition, add, favoriteNames } = await setup();
    for (const food of [juice, apple, oats, bls('F506100')]) nutrition.markFoodFavorite(food);
    add(apple, 150);
    add(oats, 60);

    expect(favoriteNames()).toEqual(['Hafer Flocken', 'Apfel roh', 'Apfelsaft', 'Granatapfel roh']);
  });
});

describe('Zuletzt verwendet', () => {
  it('liefert je Mahlzeit die Lebensmittel eindeutig nach Referenz, zuletzt verwendete zuerst, mit letzter Menge und Einheit', async () => {
    const { add, recent } = await setup();
    add(oats, 60);
    add(apple, 150);
    add(oats, 45);
    add(juice, 200, { meal: 'snacks' });

    expect(recent('fruehstueck')).toEqual(['Hafer Flocken · 45 g', 'Apfel roh · 150 g']);
    expect(recent('snacks')).toEqual(['Apfelsaft · 200 g']);
    expect(recent('abendessen')).toEqual([]);
  });

  it('reicht 30 Tage zurück, heute eingeschlossen, gemessen mit der Testuhr', async () => {
    const { add, recent, clock } = await setup();
    add(apple, 150, { localDate: localDateAfter(today, -30) });
    add(oats, 60, { localDate: localDateAfter(today, -29) });

    expect(recent()).toEqual(['Hafer Flocken · 60 g']);

    // Am nächsten Tag fällt auch der Eintrag vom 15.09. heraus.
    clock.set(Instant.parse('2026-10-15T06:30:00.000Z'));
    expect(recent()).toEqual([]);
  });

  it('zeigt Einträge ohne Referenz (KI-Schätzungen) nicht', async () => {
    const { nutrition, add, recent } = await setup();
    add(oats, 60);
    nutrition.confirmPhotoDraft({
      draftId: EntityId.parse('5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e03'),
      localDate: today,
      meal: 'fruehstueck',
      components: [{ foodRef: null, snapshot: aiPotatoes, displayUnit: 'g', displayAmountMilli: 180_000 }],
    });

    expect(recent()).toEqual(['Hafer Flocken · 60 g']);
  });

  it('zeigt eine überdeckte Quelle als eigenes Lebensmittel, einmal mit der letzten Menge', async () => {
    const { nutrition, add, quick } = await setup();
    add(apple, 150);
    const corrected = nutrition.saveOwnFood(apple.ref, { ...muesli, name: 'Apfel roh', portions: [{ unit: 'stueck', label: '1 mittelgroßer', baseAmount: 180_000 }] });
    add(corrected, 120, { captureMethod: 'zuletzt' });

    expect(quick().recent).toEqual([
      expect.objectContaining({ ref: corrected.ref, available: true, snapshot: corrected.snapshot, prefill: { displayUnit: 'g', displayAmountMilli: 120_000 } }),
    ]);
  });

  it('nutzt den Snapshot des Eintrags, wenn der BLS-Schlüssel fehlt oder das eigene Lebensmittel gelöscht ist', async () => {
    const { nutrition, add, recent, quick } = await setup({ catalogFoods: testCatalogFoods.filter((food) => food.key !== 'C133000') });
    add(oats, 60);
    const own = nutrition.saveOwnFood(null, muesli);
    add(own, 250);
    nutrition.deleteOwnFood(own.ref.key);

    expect(recent()).toEqual(['Bircher-Müsli im Glas · 250 g', 'Hafer Flocken · 60 g']);
    expect(quick().recent).toEqual([
      expect.objectContaining({ ref: own.ref, available: false, snapshot: own.snapshot, kcal: 375 }),
      expect.objectContaining({ ref: oats.ref, available: false, snapshot: oats.snapshot, kcal: 209 }),
    ]);
  });

  it('lässt gelöschte Einträge weg', async () => {
    const { nutrition, add, recent } = await setup();
    const added = add(oats, 60);
    nutrition.undo(added.undoToken);

    expect(recent()).toEqual([]);
  });
});

describe('Rangfolge der Suche', () => {
  it('Lebensmittelfavoriten, „Zuletzt verwendet“, eigene Lebensmittel, BLS; jedes Lebensmittel einmal', async () => {
    const { nutrition, add, search } = await setup();
    nutrition.saveOwnFood(null, { ...muesli, name: 'Apfelmus selbst gemacht', portions: [] });
    nutrition.markFoodFavorite(bls('F506100'));
    add(juice, 200);
    add(bls('F506100'), 100);

    expect(search('Apfel')).toEqual([
      'favorit: Granatapfel roh',
      'zuletzt: Apfelsaft',
      'eigen: Apfelmus selbst gemacht',
      'bls: Apfel roh',
      'bls: Apfel geschält, roh',
      'bls: Apfelessig',
      'bls: Rotkohl mit Apfel gedünstet',
    ]);
  });

  it('„Zuletzt verwendet“ gilt für die gewählte Mahlzeit', async () => {
    const { add, search } = await setup();
    add(juice, 200, { meal: 'snacks' });

    expect(search('Apfelsaft', 'snacks')).toEqual(['zuletzt: Apfelsaft']);
    expect(search('Apfelsaft', 'fruehstueck')).toEqual(['bls: Apfelsaft']);
  });

  it('stellt in einer Gruppe Präfixtreffer am Wortanfang vor sonstige Treffer', async () => {
    const { nutrition, search } = await setup();
    for (const key of ['F506100', 'F110100', 'X537063']) nutrition.markFoodFavorite(bls(key));

    expect(search('Apfel').slice(0, 3)).toEqual(['favorit: Apfel roh', 'favorit: Rotkohl mit Apfel gedünstet', 'favorit: Granatapfel roh']);
  });

  it('liefert mit dem Treffer die Vorbelegung und den Rückfall', async () => {
    const { nutrition, add, catalog } = await setup();
    add(oats, 45);

    const result = nutrition.foodSearch(catalog, 'fruehstueck').search('Hafer Flocken');

    expect(result.type === 'treffer' && result.hits[0]).toMatchObject({ mark: 'zuletzt', available: true, prefill: { displayUnit: 'g', displayAmountMilli: 45_000 } });
  });
});
