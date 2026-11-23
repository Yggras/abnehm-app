/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import { OwnFoodRecord, OwnFoodUpsert, type FoodRef, type FoodValues, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import { insertPersonForTest } from '../daily-goals/testing/persisted';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { nutritionEntry, ownFood } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import {
  createNutrition,
  InvalidNutritionInputError,
  nutritionEntryEntity,
  ownFoodEntity,
  type DayLog,
  type FoodSearchResult,
} from '.';
import { checkAmountInput } from './amount-input';
import { openTestCatalog } from './testing/test-catalog';
import { withoutNetwork } from './testing/without-network';

// Nachweis für #157: eigene Lebensmittel im App-Modul „Ernährung“ (Spezifikation 2, Abschnitte 2–4)
// gegen eine echte SQLite-Datei mit denselben Migrationen wie die App, den BLS-Testkatalog und die
// Testuhr. Geprüft werden Anlegen, Ändern und Löschen samt Outbox-Operation, die Korrektur eines
// BLS-Lebensmittels mit Überdeckung in der Suche, die Snapshot-Stabilität gespeicherter Einträge, die
// Umrechnung mit Bruchteilen und der lokale FTS5-Index auch nach einer Pull-Übernahme.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const morning = Instant.parse('2026-10-14T06:30:00.000Z');
const today = LocalDate.parse('2026-10-14');

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

/** Apfel roh aus dem BLS 4.0 (F110100), wie ihn der Testkatalog liefert. */
const blsApple: NutritionSnapshot = {
  name: 'Apfel roh',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 58_000,
  proteinMg: 424,
  carbsMg: 11_700,
  fatMg: 500,
  portions: [],
  source: 'bls',
  attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0',
};
const blsAppleRef = { type: 'bls', key: 'F110100' } as const;

/** Die Werte eines Snapshots, wie sie das Formular vorbelegt. */
const valuesOf = ({ source: _source, attribution: _attribution, ...values }: NutritionSnapshot): FoodValues => values;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
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
  const writer = createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, ownFoodEntity]), clock, newId });
  const reports: LocalDate[][] = [];
  const nutrition = createNutrition({ ...withoutNetwork,
    database,
    clock,
    writer,
    newId,
    persistence: { reevaluateDailyGoals: (_tx, _personId, localDates) => void reports.push([...localDates]) },
  });
  const search = nutrition.foodSearch(catalog.database, 'fruehstueck');
  return {
    database,
    catalog: catalog.database,
    nutrition,
    reports,
    search: (input: string) => hitsOf(search.search(input)),
    ownFoods: () => database.read((tx) => sqliteOf(tx).select().from(ownFood).all()),
    entries: () => database.read((tx) => sqliteOf(tx).select().from(nutritionEntry).all()),
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
    dayLog() {
      let log: DayLog | null = null;
      nutrition.observeDayLog(today, (value) => (log = value))();
      return log as DayLog | null;
    },
  };
}

/** Treffer als „Quellenmarke: Name“, in Rangfolge. */
function hitsOf(result: FoodSearchResult): string[] | 'zu_kurz' {
  return result.type === 'zu_kurz' ? 'zu_kurz' : result.hits.map((hit) => `${hit.mark}: ${hit.snapshot.name}`);
}

const entryOf = (ref: FoodRef, snapshot: NutritionSnapshot, displayUnit: 'g' | 'stueck' | 'portion', displayAmountMilli: number) =>
  ({ localDate: today, meal: 'fruehstueck', captureMethod: 'eigenes_lebensmittel', foodRef: ref, snapshot, displayUnit, displayAmountMilli }) as const;

describe('Eigenes Lebensmittel anlegen, ändern und löschen', () => {
  it('legt es samt genau einer Outbox-Operation an und liefert Referenz und Snapshot der Quelle „eigen“', async () => {
    const { nutrition, ownFoods, operations, reports } = await setup();

    const saved = nutrition.saveOwnFood(null, muesli);

    expect(saved).toEqual({ ref: { type: 'eigen', key: expect.any(String) }, snapshot: { ...muesli, source: 'eigen', attribution: null } });
    expect(ownFoods()).toEqual([
      expect.objectContaining({ id: saved.ref.key, personId: philipp, name: 'Bircher-Müsli im Glas', originType: null, originKey: null, deletedAt: null }),
    ]);
    expect(operations()).toEqual([
      expect.objectContaining({
        type: 'upsert_entity',
        entityType: 'own_food',
        entityId: saved.ref.key,
        knownServerVersion: null,
        payload: OwnFoodUpsert.parse({ ...muesli, origin: null }),
      }),
    ]);
    // Ein eigenes Lebensmittel betrifft keinen Tag: Einträge tragen ihren eigenen Snapshot.
    expect(reports).toEqual([]);
  });

  it('ändert ein eigenes Lebensmittel unter derselben ID, statt ein zweites anzulegen', async () => {
    const { nutrition, ownFoods, operations } = await setup();
    const { ref } = nutrition.saveOwnFood(null, muesli);

    const changed = nutrition.saveOwnFood(ref, { ...muesli, milliKcal: 160_000 });

    expect(changed.ref).toEqual(ref);
    expect(changed.snapshot.milliKcal).toBe(160_000);
    expect(ownFoods()).toEqual([expect.objectContaining({ id: ref.key, milliKcal: 160_000 })]);
    expect(operations().map((operation) => [operation.type, 'entityId' in operation ? operation.entityId : null])).toEqual([
      ['upsert_entity', ref.key],
      ['upsert_entity', ref.key],
    ]);
  });

  it('löscht per Tombstone mit Delete-Operation; ein zweites Löschen ändert nichts', async () => {
    const { nutrition, ownFoods, operations, search } = await setup();
    const { ref } = nutrition.saveOwnFood(null, muesli);

    nutrition.deleteOwnFood(ref.key);
    nutrition.deleteOwnFood(ref.key);

    expect(ownFoods()).toEqual([expect.objectContaining({ id: ref.key, deletedAt: morning })]);
    expect(operations().map((operation) => operation.type)).toEqual(['upsert_entity', 'delete_entity']);
    expect(search('Bircher')).not.toContain('eigen: Bircher-Müsli im Glas');
  });

  it.each([
    ['negative kcal', { milliKcal: -1 }],
    ['Makros schwerer als die Bezugsmenge', { proteinMg: 50_000, carbsMg: 50_000, fatMg: 1 }],
    ['leerer Name', { name: '' }],
    ['Bezugsmenge 0', { referenceAmount: 0 }],
    ['zwei Portionen', { portions: [muesli.portions[0]!, { unit: 'portion' as const, label: null, baseAmount: 100_000 }] }],
  ])('lehnt %s ab, ohne etwas zu schreiben', async (_, change) => {
    const { nutrition, ownFoods, operations } = await setup();

    expect(() => nutrition.saveOwnFood(null, { ...muesli, ...change })).toThrow(InvalidNutritionInputError);

    expect(ownFoods()).toEqual([]);
    expect(operations()).toEqual([]);
  });

  it('lehnt das Ändern eines gelöschten eigenen Lebensmittels ab', async () => {
    const { nutrition, operations } = await setup();
    const { ref } = nutrition.saveOwnFood(null, muesli);
    nutrition.deleteOwnFood(ref.key);

    expect(() => nutrition.saveOwnFood(ref, muesli)).toThrow(InvalidNutritionInputError);
    expect(operations()).toHaveLength(2);
  });
});

describe('Korrektur eines BLS-Lebensmittels', () => {
  it('legt ein eigenes Lebensmittel mit Herkunftsreferenz an; es überdeckt die Quelle in der Suche', async () => {
    const { nutrition, ownFoods, search } = await setup();
    expect(search('Apfel')).toContain('bls: Apfel roh');

    const corrected = nutrition.saveOwnFood(blsAppleRef, { ...valuesOf(blsApple), milliKcal: 54_000 });

    expect(corrected.ref.type).toBe('eigen');
    expect(ownFoods()).toEqual([expect.objectContaining({ id: corrected.ref.key, originType: 'bls', originKey: 'F110100', milliKcal: 54_000 })]);
    // Die Quelle erscheint nur einmal, als eigenes Lebensmittel vor dem BLS.
    expect(search('Apfel')).toEqual([
      'eigen: Apfel roh',
      'bls: Apfel geschält, roh',
      'bls: Apfelsaft',
      'bls: Apfelessig',
      'bls: Rotkohl mit Apfel gedünstet',
      'bls: Granatapfel roh',
    ]);
  });

  it('überdeckt die Quelle auch nach einer Umbenennung, und das Löschen gibt sie wieder frei', async () => {
    const { nutrition, search } = await setup();

    const { ref } = nutrition.saveOwnFood(blsAppleRef, { ...valuesOf(blsApple), name: 'Elstar aus dem Garten' });

    expect(search('Apfel roh')).toEqual(['bls: Apfel geschält, roh', 'bls: Granatapfel roh']);
    expect(search('Elstar')).toEqual(['eigen: Elstar aus dem Garten']);
    nutrition.deleteOwnFood(ref.key);
    expect(search('Apfel roh')).toEqual(['bls: Apfel roh', 'bls: Apfel geschält, roh', 'bls: Granatapfel roh']);
  });
});

describe('Suche über eigene Lebensmittel', () => {
  it('nutzt dieselbe Normalisierung: Umlaute, ß und Groß- und Kleinschreibung', async () => {
    const { nutrition, search } = await setup();
    nutrition.saveOwnFood(null, muesli);
    nutrition.saveOwnFood(null, { ...muesli, name: 'Omas Kloß', portions: [] });

    const own = (input: string) => [search(input)].flat().filter((hit) => hit.startsWith('eigen'));
    for (const input of ['Bircher-Müsli', 'bircher muesli', 'BIRCHER MUSLI', 'musli']) {
      expect(own(input)).toEqual(['eigen: Bircher-Müsli im Glas']);
    }
    expect(own('kloss')).toEqual(['eigen: Omas Kloß']);
    expect(own('Kloß')).toEqual(['eigen: Omas Kloß']);
  });

  it('stellt eigene Lebensmittel vor den BLS, innerhalb der Gruppe in derselben Rangfolge', async () => {
    const { nutrition, search } = await setup();
    nutrition.saveOwnFood(null, { ...muesli, name: 'Granatapfelkerne', portions: [] });
    nutrition.saveOwnFood(null, { ...muesli, name: 'Apfelringe getrocknet', portions: [] });

    expect(search('Apfel').slice(0, 3)).toEqual(['eigen: Apfelringe getrocknet', 'eigen: Granatapfelkerne', 'bls: Apfel roh']);
  });

  it('zeigt kcal je 100 g bzw. je 100 ml, auch bei anderer Bezugsmenge', async () => {
    const { nutrition, catalog } = await setup();
    nutrition.saveOwnFood(null, { ...muesli, name: 'Eistee', baseUnit: 'ml', referenceAmount: 250, milliKcal: 70_000, proteinMg: 0, carbsMg: 17_500, fatMg: 0, portions: [] });

    const result = nutrition.foodSearch(catalog, 'fruehstueck').search('Eistee');

    expect(result).toEqual({ type: 'treffer', hits: [expect.objectContaining({ mark: 'eigen', kcalPer100: 28 })] });
  });
});

describe('Einträge aus eigenen Lebensmitteln', () => {
  it('rechnet Stück und Portion mit Bruchteilen in Tausendsteln', async () => {
    const { nutrition, entries } = await setup();
    const { ref, snapshot } = nutrition.saveOwnFood(null, muesli);
    const half = checkAmountInput(snapshot, 'portion', '0,5');
    expect(half).toMatchObject({ type: 'menge', amount: { baseAmount: 125_000, displayUnit: 'portion', displayAmountMilli: 500 } });

    nutrition.addEntry(entryOf(ref, snapshot, 'portion', 500));

    // Ein halbes Glas sind 125 g: 150 kcal je 100 g × 1,25 = 187,5 kcal.
    expect(entries()).toEqual([
      expect.objectContaining({ foodRefType: 'eigen', foodRefKey: ref.key, displayUnit: 'portion', displayAmountMilli: 500, baseAmount: 125_000, totalMilliKcal: 187_500 }),
    ]);
  });

  it('lässt gespeicherte Einträge nach einer Korrektur unverändert; künftige nutzen die neue Fassung', async () => {
    const { nutrition, entries, dayLog } = await setup();
    const first = nutrition.saveOwnFood(null, muesli);
    nutrition.addEntry(entryOf(first.ref, first.snapshot, 'portion', 1_000));

    const corrected = nutrition.saveOwnFood(first.ref, { ...muesli, milliKcal: 200_000 });
    nutrition.addEntry(entryOf(corrected.ref, corrected.snapshot, 'portion', 1_000));

    expect(entries().map((entry) => [entry.snapshotMilliKcal, entry.totalMilliKcal])).toEqual([
      [150_000, 375_000],
      [200_000, 500_000],
    ]);
    expect(dayLog()?.intakeKcal).toBe(875);
  });

  it('behält Einträge nach dem Löschen über ihren Snapshot nutzbar', async () => {
    const { nutrition, dayLog } = await setup();
    const { ref, snapshot } = nutrition.saveOwnFood(null, muesli);
    nutrition.addEntry(entryOf(ref, snapshot, 'portion', 1_000));

    nutrition.deleteOwnFood(ref.key);

    const breakfast = dayLog()?.meals.find((meal) => meal.meal === 'fruehstueck');
    expect(breakfast?.entries).toEqual([expect.objectContaining({ name: 'Bircher-Müsli im Glas', displayUnit: 'portion', displayAmountMilli: 1_000 })]);
    expect(dayLog()?.intakeKcal).toBe(375);
  });

  it('speichert eine fehlende Umrechnung am eigenen Lebensmittel, bei einer externen Quelle entsteht eines', async () => {
    const { nutrition, ownFoods } = await setup();
    const own = nutrition.saveOwnFood(null, { ...muesli, portions: [] });
    const piece = { unit: 'stueck', label: null, baseAmount: 180_000 } as const;

    const ownWithPiece = nutrition.saveOwnFood(own.ref, { ...valuesOf(own.snapshot), portions: [piece] });
    const appleWithPiece = nutrition.saveOwnFood(blsAppleRef, { ...valuesOf(blsApple), portions: [piece] });

    expect(ownWithPiece.ref).toEqual(own.ref);
    expect(appleWithPiece.ref).not.toEqual(own.ref);
    expect(ownFoods()).toEqual([
      expect.objectContaining({ id: own.ref.key, portions: [piece], originType: null }),
      expect.objectContaining({ id: appleWithPiece.ref.key, name: 'Apfel roh', milliKcal: 58_000, portions: [piece], originType: 'bls', originKey: 'F110100' }),
    ]);
    expect(checkAmountInput(appleWithPiece.snapshot, 'stueck', '1')).toMatchObject({ type: 'menge', totals: { milliKcal: 104_400 } });
  });
});

describe('Suchindex und Sync', () => {
  it('nimmt ein per Pull übernommenes eigenes Lebensmittel in den Index auf und entfernt es mit dem Tombstone', async () => {
    const { database, search } = await setup();
    const entityId = EntityId.parse(randomUUID());
    const record = OwnFoodRecord.parse({ ...muesli, name: 'Linsensuppe', portions: [], origin: null, personId: philipp, createdAt: morning, updatedAt: morning });

    database.transaction((tx) => ownFoodEntity.applyCanonical(tx, { entityId, serverVersion: ServerVersion.parse('7'), data: record }));
    expect(search('Linsen')).toEqual(['eigen: Linsensuppe']);

    database.transaction((tx) =>
      ownFoodEntity.applyCanonical(tx, { entityId, serverVersion: ServerVersion.parse('8'), data: { ...record, name: 'Rote Linsensuppe' } }));
    expect(search('Linsen')).toEqual(['eigen: Rote Linsensuppe']);

    database.transaction((tx) => ownFoodEntity.applyTombstone(tx, { entityId, serverVersion: ServerVersion.parse('9'), deletedAt: morning }));
    expect(search('Linsen')).toEqual([]);
  });
});
