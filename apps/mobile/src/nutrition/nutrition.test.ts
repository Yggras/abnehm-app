/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { DailyGoalCause } from '@abnehm/contracts/daily-goals';
import { NutritionEntryAddedOutcome, NutritionEntryUpsert, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCompletionEntity } from '../daily-goals';
import { insertPersonForTest } from '../daily-goals/testing/persisted';
import { energyBookingEntity } from '../energy';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { dirtyDay, nutritionEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createNutrition, InvalidNutritionInputError, nutritionEntryEntity, type DayLog, type NutritionDependencies } from '.';

// Nachweis für #155: das App-Modul „Ernährung“ (Spezifikation 2, Abschnitte 1, 2 und 6) mit den
// Befehlen „Eintrag hinzufügen“ und „Rückgängig“ sowie den Abfragen Tagesprotokoll und Vorbelegung,
// gegen eine echte SQLite-Datei mit denselben Migrationen wie die App und mit der Testuhr. Jede
// Mutation ist genau eine lokale Transaktion aus Fachzeile, Outbox-Operation und `reevaluateDailyGoals`.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const berlin = TimeZone.parse('Europe/Berlin');
/** 8:30 in Berlin am Mittwoch, 14.10.2026 (Sommerzeit, UTC+2). */
const morning = Instant.parse('2026-10-14T06:30:00.000Z');
const today = LocalDate.parse('2026-10-14');
const yesterday = LocalDate.parse('2026-10-13');

/** Hafer Flocken aus dem BLS 4.0 (C133000), Werte je 100 g wie im Asset. */
const oats: NutritionSnapshot = {
  name: 'Hafer Flocken',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 348_000,
  proteinMg: 13_220,
  carbsMg: 53_300,
  fatMg: 6_650,
  portions: [],
  source: 'bls',
  attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0',
};
const oatsRef = { type: 'bls', key: 'C133000' } as const;
/** Apfel roh aus dem BLS 4.0 (F110100). */
const apple: NutritionSnapshot = { ...oats, name: 'Apfel roh', milliKcal: 58_000, proteinMg: 424, carbsMg: 11_700, fatMg: 500 };
const appleRef = { type: 'bls', key: 'F110100' } as const;

/** 60 g Hafer Flocken zum Frühstück aus der Suche. */
const breakfast = {
  localDate: today,
  meal: 'fruehstueck',
  captureMethod: 'suche',
  foodRef: oatsRef,
  snapshot: oats,
  displayUnit: 'g',
  displayAmountMilli: 60_000,
} as const;

type Report = { personId: EntityId; localDates: readonly LocalDate[]; cause: DailyGoalCause };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup({ failReevaluation = false }: { failReevaluation?: boolean } = {}) {
  let failing = failReevaluation;
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock: TestClock = createTestClock({ instant: morning, timeZone: berlin });
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, dailyGoalCompletionEntity, energyBookingEntity]), clock, newId });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock, writer, dispatcher });
  const reports: Report[] = [];
  const dependencies: NutritionDependencies = {
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
  const nutrition = createNutrition(dependencies);
  const rows = () => database.read((tx) => sqliteOf(tx).select().from(nutritionEntry).all());
  const operations = () => database.read((tx) => pendingOperations(tx, 100));
  const markers = () => database.read((tx) => sqliteOf(tx).select().from(dirtyDay).all());
  const failReevaluationFromNowOn = () => {
    failing = true;
  };
  return { database, clock, nutrition, reports, rows, operations, markers, failReevaluationFromNowOn };
}

describe('Eintrag hinzufügen', () => {
  it('legt den Eintrag mit Snapshot und Summen samt Outbox-Operation an und meldet den Tag', async () => {
    const { nutrition, rows, operations, reports } = await setup();

    const outcome = nutrition.addEntry(breakfast);

    // 348 kcal je 100 g × 0,6 = 208,8 kcal, angezeigt kaufmännisch gerundet 209 kcal.
    expect(NutritionEntryAddedOutcome.parse(outcome)).toEqual({
      messageKey: 'ernaehrung.eintrag_hinzugefuegt',
      values: { meal: 'fruehstueck', kcal: 209 },
      undoToken: expect.any(String),
    });
    const [row] = rows();
    expect(rows()).toHaveLength(1);
    expect(row).toMatchObject({
      personId: philipp,
      consumedAt: morning,
      localDate: '2026-10-14',
      timeZone: 'Europe/Berlin',
      utcOffsetMinutes: 120,
      meal: 'fruehstueck',
      captureMethod: 'suche',
      foodRefType: 'bls',
      foodRefKey: 'C133000',
      baseAmount: 60_000,
      displayUnit: 'g',
      displayAmountMilli: 60_000,
      snapshotName: 'Hafer Flocken',
      snapshotMilliKcal: 348_000,
      snapshotSource: 'bls',
      totalMilliKcal: 208_800,
      totalProteinMg: 7_932,
      totalCarbsMg: 31_980,
      totalFatMg: 3_990,
      mealPhotoId: null,
      deletedAt: null,
      serverVersion: null,
    });
    expect(operations()).toEqual([
      expect.objectContaining({
        type: 'upsert_entity',
        entityType: 'nutrition_entry',
        entityId: row!.id,
        knownServerVersion: null,
        payload: NutritionEntryUpsert.parse({
          consumedAt: morning,
          localDate: '2026-10-14',
          timeZone: 'Europe/Berlin',
          utcOffsetMinutes: 120,
          meal: 'fruehstueck',
          captureMethod: 'suche',
          foodRef: oatsRef,
          snapshot: oats,
          amount: { baseAmount: 60_000, displayUnit: 'g', displayAmountMilli: 60_000 },
          totals: { milliKcal: 208_800, proteinMg: 7_932, carbsMg: 31_980, fatMg: 3_990 },
          mealPhotoId: null,
        }),
      }),
    ]);
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-14'], cause: 'eingabe' }]);
  });

  it('trägt am Vortag nach und meldet genau den Vortag', async () => {
    const { nutrition, rows, reports } = await setup();

    nutrition.addEntry({ ...breakfast, localDate: yesterday });

    expect(rows()).toEqual([expect.objectContaining({ localDate: '2026-10-13', consumedAt: morning })]);
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-13'], cause: 'eingabe' }]);
  });

  it.each([
    ['5 kg', 5_000_000, 5_000_000],
    ['1 mg', 1, 1],
    ['0,5 g', 500, 500],
  ])('nimmt die Menge %s an', async (_, displayAmountMilli, baseAmount) => {
    const { nutrition, rows } = await setup();

    nutrition.addEntry({ ...breakfast, displayAmountMilli });

    expect(rows().map((row) => row.baseAmount)).toEqual([baseAmount]);
  });

  it.each([
    ['0 g', { displayAmountMilli: 0 }],
    ['über 5 kg', { displayAmountMilli: 5_000_001 }],
    ['negative Menge', { displayAmountMilli: -60_000 }],
    ['Bruchteil eines Tausendstels', { displayAmountMilli: 0.5 }],
    ['Stück ohne Umrechnung', { displayUnit: 'stueck' as const, displayAmountMilli: 1_000 }],
    ['morgen', { localDate: LocalDate.parse('2026-10-15') }],
    ['KI-Schätzung aus der Suche', { foodRef: null, snapshot: { ...oats, source: 'ki' as const, attribution: null } }],
  ])('lehnt %s ab, ohne etwas zu schreiben oder zu melden', async (_, change) => {
    const { nutrition, rows, operations, reports, markers } = await setup();

    expect(() => nutrition.addEntry({ ...breakfast, ...change })).toThrow(InvalidNutritionInputError);

    expect(rows()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(reports).toEqual([]);
    expect(markers()).toEqual([]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleiben weder Eintrag noch Operation noch Dirty-Day-Marker', async () => {
    const { nutrition, rows, operations, markers } = await setup({ failReevaluation: true });

    expect(() => nutrition.addEntry(breakfast)).toThrow('Auswertung gescheitert');

    expect(rows()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(markers()).toEqual([]);
  });
});

describe('Tagesprotokoll', () => {
  it('gliedert die Einträge des Tags nach den vier Mahlzeiten, mit Summen und Tagesaufnahme', async () => {
    const { nutrition, clock } = await setup();
    nutrition.addEntry(breakfast);
    clock.advanceBy(60_000);
    // 150 g Apfel roh: 58 kcal je 100 g × 1,5 = 87 kcal.
    nutrition.addEntry({ ...breakfast, foodRef: appleRef, snapshot: apple, displayAmountMilli: 150_000 });
    // 40 g Hafer Flocken als Snack: 139,2 kcal.
    nutrition.addEntry({ ...breakfast, meal: 'snacks', displayAmountMilli: 40_000 });
    nutrition.addEntry({ ...breakfast, localDate: yesterday });
    const logs: (DayLog | null)[] = [];

    const stop = nutrition.observeDayLog(today, (log) => logs.push(log));
    stop();

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      localDate: '2026-10-14',
      // 208,8 + 87 + 139,2 = 435 kcal; gerundet wird erst die Summe.
      intakeKcal: 435,
      meals: [
        {
          meal: 'fruehstueck',
          kcal: 296,
          entries: [
            { id: expect.any(String), name: 'Hafer Flocken', displayUnit: 'g', displayAmountMilli: 60_000, kcal: 209, fromPhoto: false },
            { id: expect.any(String), name: 'Apfel roh', displayUnit: 'g', displayAmountMilli: 150_000, kcal: 87, fromPhoto: false },
          ],
        },
        { meal: 'mittagessen', kcal: 0, entries: [] },
        { meal: 'abendessen', kcal: 0, entries: [] },
        { meal: 'snacks', kcal: 139, entries: [{ id: expect.any(String), name: 'Hafer Flocken', displayUnit: 'g', displayAmountMilli: 40_000, kcal: 139, fromPhoto: false }] },
      ],
    });
  });

  it('liest nach jedem Commit neu und lässt entfernte Einträge weg', async () => {
    const { nutrition } = await setup();
    const intakes: (number | undefined)[] = [];
    const stop = nutrition.observeDayLog(today, (log) => intakes.push(log?.intakeKcal));

    const { undoToken } = nutrition.addEntry(breakfast);
    nutrition.undo(undoToken);
    stop();

    // Jeder Commit liest neu, auch der der Dirty-Day-Zustellung; hier zählt die Folge der Werte.
    expect(intakes.filter((intake, index) => intake !== intakes[index - 1])).toEqual([0, 209, 0]);
  });

  it('ist leer, solange die eigene Person fehlt', async () => {
    const files = createBetterSqliteFiles();
    const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
    cleanups.push(() => {
      databases.lock();
      files.remove();
    });
    const database = await databases.open('konto_b');
    const clock = createTestClock({ instant: morning, timeZone: berlin });
    const newId = () => EntityId.parse(randomUUID());
    const nutrition = createNutrition({
      database, clock, newId, persistence: { reevaluateDailyGoals() {} },
      writer: createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity]), clock, newId }),
    });
    const logs: (DayLog | null)[] = [];

    nutrition.observeDayLog(today, (log) => logs.push(log))();

    expect(logs).toEqual([null]);
  });
});

describe('Vorbelegung der Mengenprüfung', () => {
  const ownApple: NutritionSnapshot = {
    ...apple,
    portions: [{ unit: 'stueck', label: null, baseAmount: 125_000 }, { unit: 'portion', label: '1 Schale', baseAmount: 200_000 }],
    source: 'eigen',
    attribution: null,
  };
  const ownAppleRef = { type: 'eigen', key: EntityId.parse('5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e01') } as const;
  const milk: NutritionSnapshot = { ...ownApple, name: 'Hafer Drink', baseUnit: 'ml', referenceAmount: 100, portions: [] };

  it('ohne eigene Einträge: 100 g bzw. 100 ml', async () => {
    const { nutrition } = await setup();

    expect(nutrition.prefillAmount(oatsRef, oats)).toEqual({ displayUnit: 'g', displayAmountMilli: 100_000 });
    expect(nutrition.prefillAmount(ownAppleRef, milk)).toEqual({ displayUnit: 'ml', displayAmountMilli: 100_000 });
  });

  it('ohne eigene Einträge, aber mit bekannter Portion: 1 Portion', async () => {
    const { nutrition } = await setup();

    expect(nutrition.prefillAmount(ownAppleRef, ownApple)).toEqual({ displayUnit: 'portion', displayAmountMilli: 1_000 });
    expect(nutrition.prefillAmount(ownAppleRef, { ...ownApple, portions: [ownApple.portions[0]!] })).toEqual({ displayUnit: 'stueck', displayAmountMilli: 1_000 });
  });

  it('die letzte Menge und Einheit dieses Lebensmittels aus den eigenen Einträgen, auch aus einer anderen Mahlzeit', async () => {
    const { nutrition, clock } = await setup();
    nutrition.addEntry({ ...breakfast, displayAmountMilli: 60_000 });
    clock.advanceBy(60_000);
    nutrition.addEntry({ ...breakfast, meal: 'snacks', displayAmountMilli: 45_500 });
    clock.advanceBy(60_000);
    nutrition.addEntry({ ...breakfast, foodRef: appleRef, snapshot: apple, displayAmountMilli: 150_000 });

    expect(nutrition.prefillAmount(oatsRef, oats)).toEqual({ displayUnit: 'g', displayAmountMilli: 45_500 });
  });

  it('übergeht entfernte Einträge und Einheiten, die der Snapshot nicht mehr kennt', async () => {
    const { nutrition, clock } = await setup();
    nutrition.addEntry({ ...breakfast, captureMethod: 'eigenes_lebensmittel', foodRef: ownAppleRef, snapshot: ownApple, displayUnit: 'g', displayAmountMilli: 80_000 });
    clock.advanceBy(60_000);
    const { undoToken } = nutrition.addEntry({ ...breakfast, captureMethod: 'eigenes_lebensmittel', foodRef: ownAppleRef, snapshot: ownApple, displayUnit: 'g', displayAmountMilli: 90_000 });
    nutrition.undo(undoToken);
    expect(nutrition.prefillAmount(ownAppleRef, ownApple)).toEqual({ displayUnit: 'g', displayAmountMilli: 80_000 });

    clock.advanceBy(60_000);
    nutrition.addEntry({ ...breakfast, captureMethod: 'eigenes_lebensmittel', foodRef: ownAppleRef, snapshot: ownApple, displayUnit: 'stueck', displayAmountMilli: 500 });
    expect(nutrition.prefillAmount(ownAppleRef, { ...ownApple, portions: [] })).toEqual({ displayUnit: 'g', displayAmountMilli: 100_000 });
  });
});

describe('Rückgängig', () => {
  it('entfernt den Eintrag genau einmal, mit einer Löschoperation, und meldet seinen Tag', async () => {
    const { nutrition, rows, operations, reports } = await setup();
    const { undoToken } = nutrition.addEntry({ ...breakfast, localDate: yesterday });
    reports.length = 0;

    expect(nutrition.undo(undoToken)).toEqual({ type: 'undone' });
    expect(nutrition.undo(undoToken)).toEqual({ type: 'noop' });

    const [row] = rows();
    expect(row).toMatchObject({ deletedAt: expect.any(String) });
    expect(operations().map(({ type }) => type)).toEqual(['upsert_entity', 'delete_entity']);
    expect(reports).toEqual([{ personId: philipp, localDates: ['2026-10-13'], cause: 'rueckgaengig' }]);
  });

  it('ist eine Transaktion: Scheitert die Auswertung, bleiben Eintrag und Outbox unverändert, und der Token ist verbraucht', async () => {
    const { nutrition, rows, operations, failReevaluationFromNowOn } = await setup();
    const { undoToken } = nutrition.addEntry(breakfast);
    failReevaluationFromNowOn();

    expect(() => nutrition.undo(undoToken)).toThrow('Auswertung gescheitert');

    expect(rows()).toEqual([expect.objectContaining({ deletedAt: null })]);
    expect(operations().map(({ type }) => type)).toEqual(['upsert_entity']);
    expect(nutrition.undo(undoToken)).toEqual({ type: 'noop' });
  });

  it('ist nach Ablauf der Meldung ein No-op', async () => {
    const { nutrition, rows, operations } = await setup();
    const { undoToken } = nutrition.addEntry(breakfast);

    nutrition.expire(undoToken);

    expect(nutrition.undo(undoToken)).toEqual({ type: 'noop' });
    expect(rows()).toEqual([expect.objectContaining({ deletedAt: null })]);
    expect(operations().map(({ type }) => type)).toEqual(['upsert_entity']);
  });
});
