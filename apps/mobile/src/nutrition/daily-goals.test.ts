/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone, type BausteinKey, type MealKey } from '@abnehm/contracts/base';
import { DailyGoalSnapshot, type DailyGoalEvaluation } from '@abnehm/contracts/daily-goals';
import type { NutritionSnapshot } from '@abnehm/contracts/nutrition';
import { DailyIntakeSeries, EffectivePlan } from '@abnehm/contracts/ports';

import { composeAreaPorts } from '../area-ports';
import { fakePlanReader, fakeWeightRecorder, fakeWeightTrendReader } from '../area-ports/testing/fakes';
import {
  createDailyGoalPersistence,
  createDailyGoalRegistry,
  createDaysChangedDispatcher,
  dailyGoalCompletionEntity,
  type DailyGoalRegistry,
  type DailyGoalSnapshotOf,
  type ValidPlan,
} from '../daily-goals';
import { completionConformanceCases } from '../daily-goals/testing/completion-conformance';
import { bausteinConformanceCases, checkInConformanceCases, type BausteinTruthRow, type CheckInTruthRow } from '../daily-goals/testing/conformance';
import { insertDailyGoalForTest, insertPersonForTest } from '../daily-goals/testing/persisted';
import { energyBookingEntity } from '../energy';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { dailyGoalCompletion, energyBooking } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createNutrition, intakeReaderOf, nutritionDailyGoals, nutritionEntryEntity, type NutritionDayFacts } from '.';
import { withoutPhotos } from './testing/without-photos';

// Nachweis für #166: die Beiträge der Ernährung zu den Verträgen aus Spezifikation 0, Abschnitt 3
// (Spezifikation 2, Abschnitt 10). Die Evaluatoren für „Ernährung erfasst“ und „Im Kalorienbudget“ und
// der Tages-Check-in `ernaehrung` bestehen das Konformitäts-Testkit aus #104 mit ihren Wahrheitstabellen.
// Danach laufen Reader, Registry, Persistenzdienst und `IntakeReader` gegen eine echte SQLite-Datei mit
// denselben Migrationen wie die App, über die Befehle des Moduls statt über künstliche Zeilen.

const [mealsRecorded, calorieBudget] = nutritionDailyGoals.bausteine;
const [checkIn] = nutritionDailyGoals.checkIns;

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const berlin = TimeZone.parse('Europe/Berlin');
const today = LocalDate.parse('2026-10-14');
const yesterday = LocalDate.parse('2026-10-13');
/** Mittwoch, 14.10.2026, in Berlin (Sommerzeit, UTC+2): Mittag, Abend und Tagesende. */
const noon = Instant.parse('2026-10-14T10:00:00.000Z');
const evening = Instant.parse('2026-10-14T17:00:00.000Z');
const dayEnd = Instant.parse('2026-10-14T22:00:00.000Z');
const afterDayEnd = Instant.parse('2026-10-14T22:00:00.001Z');

const snapshotBase = { personId: philipp, localDate: today, slot: 1, timeZone: berlin, dayEndsAt: dayEnd } as const;
const mealsSnapshot = DailyGoalSnapshot.parse({ ...snapshotBase, type: 'ernaehrung_erfasst', minimumMealCategories: 2 }) as DailyGoalSnapshotOf<'ernaehrung_erfasst'>;
const budgetSnapshot = DailyGoalSnapshot.parse({ ...snapshotBase, type: 'im_kalorienbudget', budgetKcal: 2_417, lowerBoundKcal: 1_882 }) as DailyGoalSnapshotOf<'im_kalorienbudget'>;

/** Philipps Zielversion; für den Tages-Check-in der Ernährung zählt sie nicht. */
const goalVersion = {
  id: EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2c02'),
  calorieBudgetMilliKcal: 2_417_875,
  lowerBoundMilliKcal: 1_882_500,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 78_000,
  waterTargetMl: 2_500,
  weeklySportTargetMinutes: 150,
} as const;

/** Gültiger Plan eines Tags mit Philipps Zielversion und den Bausteinen des Wochenplantags. */
const validPlan = (localDate: LocalDate, bausteine: [BausteinKey, BausteinKey, BausteinKey]): ValidPlan =>
  EffectivePlan.parse({
    type: 'gueltig',
    localDate,
    goal: { ...goalVersion, validFrom: '2026-10-01' },
    weeklyPlanDay: { weeklyPlanVersionId: '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2c01', validFrom: '2026-10-01', bausteine },
  }) as ValidPlan;

const facts = (recordedMealCategories: number, intakeKcal = 0): NutritionDayFacts => ({ recordedMealCategories, intakeKcal });

describe('Konformitäts-Testkit: Ernährung erfasst', () => {
  const progress = (recordedMealCategories: number) => ({ type: 'ernaehrung_erfasst' as const, recordedMealCategories, minimumMealCategories: 2 });
  const rows: BausteinTruthRow<'ernaehrung_erfasst', NutritionDayFacts>[] = [
    { name: '0 Mahlzeiten: offen', snapshot: mealsSnapshot, at: noon, facts: facts(0), expected: { currentState: 'offen', progress: progress(0) } },
    { name: '1 Mahlzeit: teilweise', snapshot: mealsSnapshot, at: noon, facts: facts(1, 450), expected: { currentState: 'teilweise', progress: progress(1) } },
    { name: '2 Mahlzeiten: erfüllt', snapshot: mealsSnapshot, at: evening, facts: facts(2, 1_300), expected: { currentState: 'erfuellt', progress: progress(2) } },
    { name: '3 Mahlzeiten: erfüllt', snapshot: mealsSnapshot, at: afterDayEnd, facts: facts(3, 2_100), expected: { currentState: 'erfuellt', progress: progress(3) } },
    { name: '0 Mahlzeiten nach Tagesende: offen', snapshot: mealsSnapshot, at: afterDayEnd, facts: facts(0), expected: { currentState: 'offen', progress: progress(0) } },
  ];
  for (const { name, run } of bausteinConformanceCases(mealsRecorded, rows)) test(name, run);
});

describe('Konformitäts-Testkit: Im Kalorienbudget', () => {
  const progress = (intakeKcal: number) => ({ type: 'im_kalorienbudget' as const, intakeKcal, budgetKcal: 2_417, lowerBoundKcal: 1_882 });
  const row = (name: string, at: Instant, intakeKcal: number, currentState: 'offen' | 'erfuellt' | 'tagesende'): BausteinTruthRow<'im_kalorienbudget', NutritionDayFacts> => ({
    name,
    snapshot: budgetSnapshot,
    at,
    facts: facts(intakeKcal === 0 ? 0 : 3, intakeKcal),
    expected: { currentState, progress: progress(intakeKcal) },
  });
  const rows = [
    row('Untergrenze −1 vor Tagesende: tagesende', evening, 1_881, 'tagesende'),
    row('Untergrenze ±0 vor Tagesende: tagesende', evening, 1_882, 'tagesende'),
    row('Budget ±0 vor Tagesende: tagesende', evening, 2_417, 'tagesende'),
    row('Budget +1 vor Tagesende: tagesende', evening, 2_418, 'tagesende'),
    row('letzte Millisekunde vor dayEndsAt: tagesende', Instant.parse('2026-10-14T21:59:59.999Z'), 2_000, 'tagesende'),
    row('Untergrenze −1 nach Tagesende: offen', dayEnd, 1_881, 'offen'),
    row('Untergrenze ±0 nach Tagesende: erfüllt', dayEnd, 1_882, 'erfuellt'),
    row('Budget ±0 nach Tagesende: erfüllt', afterDayEnd, 2_417, 'erfuellt'),
    row('Budget +1 nach Tagesende: offen', afterDayEnd, 2_418, 'offen'),
    row('0 Einträge nach Tagesende: Aufnahme 0, offen', afterDayEnd, 0, 'offen'),
    row('0 Einträge vor Tagesende: tagesende', noon, 0, 'tagesende'),
  ];
  for (const { name, run } of bausteinConformanceCases(calorieBudget, rows)) test(name, run);
});

describe('Konformitäts-Testkit: Tages-Check-in Ernährung', () => {
  const plan = validPlan(today, ['ernaehrung_erfasst', 'wasserziel', 'gewogen']);
  const row = (moment: 'mittag' | 'abend', meals: number, behind: boolean): CheckInTruthRow<'ernaehrung', NutritionDayFacts> => ({
    name: `${moment} mit ${meals} Mahlzeiten: ${behind ? 'hinterher' : 'nicht hinterher'}`,
    moment,
    plan,
    facts: facts(meals, meals * 600),
    expected: { behind, reason: { type: 'ernaehrung', recordedMealCategories: meals } },
  });
  const rows = [row('mittag', 0, true), row('mittag', 1, false), row('abend', 0, true), row('abend', 1, true), row('abend', 2, false), row('abend', 4, false)];
  for (const { name, run } of checkInConformanceCases(checkIn, rows)) test(name, run);

  it('Das Kalorienbudget ist kein Check-in-Tracker: Ernährung registriert nur `ernaehrung`', () => {
    expect(nutritionDailyGoals.checkIns.map((evaluator) => evaluator.tracker)).toEqual(['ernaehrung']);
    expect(nutritionDailyGoals.bausteine.map((evaluator) => evaluator.baustein)).toEqual(['ernaehrung_erfasst', 'im_kalorienbudget']);
  });
});

describe('Konformitäts-Testkit, Teil 2: Erfüllung über den Orchestrator', () => {
  for (const { name, run } of [
    ...completionConformanceCases({
      evaluator: mealsRecorded,
      snapshot: mealsSnapshot,
      fulfilled: { at: evening, facts: facts(2, 1_300) },
      corrected: { at: Instant.parse('2026-10-14T18:00:00.000Z'), facts: facts(1, 700) },
    }),
    ...completionConformanceCases({
      evaluator: calorieBudget,
      snapshot: budgetSnapshot,
      fulfilled: { at: afterDayEnd, facts: facts(3, 2_000) },
      corrected: { at: Instant.parse('2026-10-15T07:00:00.000Z'), facts: facts(4, 2_600) },
    }),
  ]) {
    test(name, run);
  }
});

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

/** `grams` Hafer Flocken, also 3,48 kcal je g; 60 g ergeben 208,8 kcal. */
const oatsEntry = (localDate: LocalDate, meal: MealKey, grams: number) => ({
  localDate,
  meal,
  captureMethod: 'suche' as const,
  foodRef: { type: 'bls' as const, key: 'C133000' },
  snapshot: oats,
  displayUnit: 'g' as const,
  displayAmountMilli: grams * 1_000,
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Philipp mit dem echten Modul, der echten Registry der Ernährung und dem Persistenzdienst. */
async function world({ at = noon }: { at?: Instant } = {}) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => {
    insertPersonForTest(tx, philipp);
    insertPersonForTest(tx, anna);
  });
  const clock: TestClock = createTestClock({ instant: at, timeZone: berlin });
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity, dailyGoalCompletionEntity, energyBookingEntity]), clock, newId });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const registry: DailyGoalRegistry = createDailyGoalRegistry(nutritionDailyGoals);
  const persistence = createDailyGoalPersistence({ registry, clock, writer, dispatcher });
  const nutrition = createNutrition({ ...withoutPhotos, database, clock, writer, persistence, newId });
  const goals: Record<string, { id: string; snapshot: DailyGoalSnapshot }> = {};
  return {
    database,
    clock,
    nutrition,
    intakeReader: intakeReaderOf(database),
    persistence,
    registry,
    /** Legt ein Tagesziel an, wie es die Materialisierung aus Spezifikation 1 täte. */
    goal(name: string, snapshot: DailyGoalSnapshot) {
      const id = EntityId.parse(randomUUID());
      database.transaction((tx) => insertDailyGoalForTest(tx, id, snapshot));
      goals[name] = { id, snapshot };
    },
    evaluate(name: string, evaluatedAt: Instant = Instant.parse(clock.read().instant)): DailyGoalEvaluation {
      return database.read((tx) => registry.evaluateDailyGoal(tx, goals[name]!.snapshot, evaluatedAt));
    },
    facts: (personId: EntityId, localDate: LocalDate) => database.read((tx) => mealsRecorded.readFacts(tx, personId, localDate)),
    completions: () => database.read((tx) => sqliteOf(tx).select().from(dailyGoalCompletion).all()),
    bookings: () => database.read((tx) => sqliteOf(tx).select().from(energyBooking).all()),
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
  };
}

describe('Bereichsreader der Ernährung', () => {
  it('liefert bei 0 Einträgen 0 Mahlzeiten und 0 kcal', async () => {
    const { facts: read } = await world();
    expect(read(philipp, today)).toEqual({ recordedMealCategories: 0, intakeKcal: 0 });
  });

  it('zählt Mahlzeiten mit mindestens einem nicht gelöschten Eintrag und rundet erst die Tagessumme', async () => {
    const { nutrition, facts: read } = await world();
    // 3 × 0,5 kcal: einzeln gerundet wären es 3 kcal, die Tagessumme 1,5 kcal ergibt 2 kcal.
    nutrition.addEntry({ ...oatsEntry(today, 'fruehstueck', 0), displayAmountMilli: 144 });
    nutrition.addEntry({ ...oatsEntry(today, 'fruehstueck', 0), displayAmountMilli: 144 });
    const snack = nutrition.addEntry({ ...oatsEntry(today, 'snacks', 0), displayAmountMilli: 144 });
    expect(read(philipp, today)).toEqual({ recordedMealCategories: 2, intakeKcal: 2 });

    // Ein gelöschter Eintrag zählt weder als Mahlzeit noch als Aufnahme.
    nutrition.undo(snack.undoToken);
    expect(read(philipp, today)).toEqual({ recordedMealCategories: 1, intakeKcal: 1 });
  });

  it('liest nur die Einträge der Person an diesem lokalen Tag', async () => {
    const { nutrition, facts: read } = await world();
    nutrition.addEntry(oatsEntry(today, 'fruehstueck', 60));
    nutrition.addEntry(oatsEntry(today, 'mittagessen', 100));
    nutrition.addEntry(oatsEntry(today, 'abendessen', 100));
    nutrition.addEntry(oatsEntry(today, 'snacks', 100));
    nutrition.addEntry(oatsEntry(yesterday, 'abendessen', 500));

    // 208,8 + 3 × 348 kcal = 1252,8 kcal.
    expect(read(philipp, today)).toEqual({ recordedMealCategories: 4, intakeKcal: 1_253 });
    expect(read(philipp, yesterday)).toEqual({ recordedMealCategories: 1, intakeKcal: 1_740 });
    expect(read(anna, today)).toEqual({ recordedMealCategories: 0, intakeKcal: 0 });
  });
});

describe('Tagesziele über Registry und Persistenzdienst', () => {
  it('„Ernährung erfasst“: die zweite Mahlzeit erfüllt das Tagesziel und bucht genau einmal +1', async () => {
    const created = await world({ at: evening });
    created.goal('meals', { ...mealsSnapshot, slot: 1 });

    created.nutrition.addEntry(oatsEntry(today, 'fruehstueck', 60));
    expect(created.evaluate('meals')).toMatchObject({ currentState: 'teilweise', completion: { type: 'nie' }, messageKey: 'tagesziel.ernaehrung_erfasst.teilweise', values: { recordedMealCategories: 1, minimumMealCategories: 2 } });
    expect(created.completions()).toEqual([]);

    created.nutrition.addEntry(oatsEntry(today, 'mittagessen', 100));
    created.nutrition.addEntry(oatsEntry(today, 'abendessen', 100));
    expect(created.evaluate('meals')).toMatchObject({ currentState: 'erfuellt', completion: { type: 'festgehalten', firstCompletedAt: evening } });
    expect(created.completions()).toHaveLength(1);
    expect(created.bookings().map((booking) => booking.type)).toEqual(['daily_goal_credit']);
  });

  it('Nachtragen am Vortag erfüllt das Tagesziel von gestern', async () => {
    const created = await world({ at: noon });
    const yesterdaysSnapshot = { ...mealsSnapshot, localDate: yesterday, dayEndsAt: Instant.parse('2026-10-13T22:00:00.000Z') };
    created.goal('gestern', yesterdaysSnapshot);

    created.nutrition.addEntry(oatsEntry(yesterday, 'mittagessen', 100));
    created.nutrition.addEntry(oatsEntry(yesterday, 'abendessen', 100));

    expect(created.evaluate('gestern')).toMatchObject({ currentState: 'erfuellt', dayClosed: true, completion: { type: 'festgehalten', firstCompletedAt: noon } });
    expect(created.completions()).toMatchObject([{ localDate: yesterday, slot: 1, baustein: 'ernaehrung_erfasst' }]);
  });

  it('Korrektur nach Erfüllung: Zustand folgt den Einträgen, die Erfüllung bleibt, keine neue Energie', async () => {
    const created = await world({ at: evening });
    created.goal('meals', mealsSnapshot);
    created.nutrition.addEntry(oatsEntry(today, 'fruehstueck', 60));
    const dinner = created.nutrition.addEntry(oatsEntry(today, 'abendessen', 100));
    const bookings = created.bookings();
    expect(bookings).toHaveLength(1);

    created.clock.set(Instant.parse('2026-10-14T17:30:00.000Z'));
    expect(created.nutrition.undo(dinner.undoToken)).toEqual({ type: 'undone' });

    expect(created.evaluate('meals')).toMatchObject({ currentState: 'teilweise', completion: { type: 'festgehalten', firstCompletedAt: evening } });
    expect(created.bookings()).toEqual(bookings);
    expect(created.completions()).toHaveLength(1);

    // Erneut erfüllt: dieselbe Erfüllung, wieder keine neue Energie.
    created.nutrition.addEntry(oatsEntry(today, 'snacks', 30));
    expect(created.evaluate('meals')).toMatchObject({ currentState: 'erfuellt', completion: { type: 'festgehalten', firstCompletedAt: evening } });
    expect(created.bookings()).toEqual(bookings);
  });

  it('„Im Kalorienbudget“ entscheidet sich erst mit dem Tagesabschluss', async () => {
    const created = await world({ at: evening });
    created.goal('budget', budgetSnapshot);
    // 575 g Hafer Flocken = 2001 kcal, innerhalb von 1882 bis 2417 kcal.
    created.nutrition.addEntry(oatsEntry(today, 'mittagessen', 575));

    expect(created.evaluate('budget')).toMatchObject({ currentState: 'tagesende', dayClosed: false, progress: { intakeKcal: 2_001 }, completion: { type: 'nie' } });
    expect(created.completions()).toEqual([]);

    created.clock.set(afterDayEnd);
    created.database.transaction((tx) => created.persistence.reevaluateDailyGoals(tx, philipp, [today], 'tagesabschluss'));

    expect(created.evaluate('budget')).toMatchObject({ currentState: 'erfuellt', dayClosed: true, completion: { type: 'festgehalten', firstCompletedAt: afterDayEnd } });
  });

  it('„Im Kalorienbudget“ ohne Einträge ist nach dem Tagesende offen', async () => {
    const created = await world({ at: afterDayEnd });
    created.goal('budget', budgetSnapshot);
    created.database.transaction((tx) => created.persistence.reevaluateDailyGoals(tx, philipp, [today], 'tagesabschluss'));

    expect(created.evaluate('budget')).toMatchObject({ currentState: 'offen', dayClosed: true, progress: { intakeKcal: 0 }, completion: { type: 'nie' } });
    expect(created.completions()).toEqual([]);
  });
});

describe('Tages-Check-in über die Registry', () => {
  const plan = validPlan(today, ['gewogen', 'wasserziel', 'sporteinheit']);

  it('liest die Mahlzeitenzahl aus den Einträgen, auch ohne Momo-Platz für die Ernährung', async () => {
    const { nutrition, registry, database } = await world();
    const checkInAt = (moment: 'mittag' | 'abend') =>
      database.read((tx) => registry.evaluateCheckIn(tx, { tracker: 'ernaehrung', personId: philipp, localDate: today, moment, plan }));

    expect(checkInAt('mittag')).toEqual({ type: 'evaluated', tracker: 'ernaehrung', moment: 'mittag', behind: true, reason: { type: 'ernaehrung', recordedMealCategories: 0 } });

    nutrition.addEntry(oatsEntry(today, 'fruehstueck', 60));
    expect(checkInAt('mittag')).toMatchObject({ behind: false, reason: { recordedMealCategories: 1 } });
    expect(checkInAt('abend')).toMatchObject({ behind: true, reason: { recordedMealCategories: 1 } });

    nutrition.addEntry(oatsEntry(today, 'abendessen', 100));
    expect(checkInAt('abend')).toMatchObject({ behind: false, reason: { recordedMealCategories: 2 } });
  });
});

describe('IntakeReader', () => {
  it('liefert jeden lokalen Tag des Bereichs, Tage ohne Einträge mit 0', async () => {
    const { nutrition, intakeReader } = await world();
    nutrition.addEntry(oatsEntry(LocalDate.parse('2026-10-11'), 'fruehstueck', 60));
    nutrition.addEntry(oatsEntry(LocalDate.parse('2026-10-11'), 'snacks', 100));
    const removed = nutrition.addEntry(oatsEntry(yesterday, 'abendessen', 100));
    nutrition.undo(removed.undoToken);
    nutrition.addEntry(oatsEntry(today, 'mittagessen', 100));

    const series = await intakeReader.dailyIntake(philipp, LocalDate.parse('2026-10-10'), today);

    expect(DailyIntakeSeries.parse(series)).toEqual([
      { localDate: '2026-10-10', intakeMilliKcal: 0, recordedMealCategories: 0 },
      { localDate: '2026-10-11', intakeMilliKcal: 556_800, recordedMealCategories: 2 },
      { localDate: '2026-10-12', intakeMilliKcal: 0, recordedMealCategories: 0 },
      { localDate: '2026-10-13', intakeMilliKcal: 0, recordedMealCategories: 0 },
      { localDate: '2026-10-14', intakeMilliKcal: 348_000, recordedMealCategories: 1 },
    ]);
    await expect(intakeReader.dailyIntake(anna, yesterday, today)).resolves.toEqual([
      { localDate: '2026-10-13', intakeMilliKcal: 0, recordedMealCategories: 0 },
      { localDate: '2026-10-14', intakeMilliKcal: 0, recordedMealCategories: 0 },
    ]);
  });

  it('liefert über einen Monatswechsel und die Zeitumstellung jeden Kalendertag genau einmal', async () => {
    const { intakeReader } = await world();
    const series = await intakeReader.dailyIntake(philipp, LocalDate.parse('2026-10-24'), LocalDate.parse('2026-11-02'));
    expect(series.map((day) => day.localDate)).toEqual([
      '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02',
    ]);
  });

  it('liefert für einen leeren Bereich (von nach bis) keine Tage', async () => {
    const { intakeReader } = await world();
    await expect(intakeReader.dailyIntake(philipp, today, yesterday)).resolves.toEqual([]);
  });

  it('liest nur: Ein Aufruf schreibt weder Einträge noch Operationen', async () => {
    const { nutrition, intakeReader, operations } = await world();
    nutrition.addEntry(oatsEntry(today, 'fruehstueck', 60));
    const before = operations();

    await intakeReader.dailyIntake(philipp, yesterday, today);

    expect(operations()).toEqual(before);
  });

  it('besteht die Prüfung des Composition Root', async () => {
    const { nutrition, database } = await world();
    nutrition.addEntry(oatsEntry(today, 'fruehstueck', 60));
    const ports = composeAreaPorts(database, {
      planReader: () => fakePlanReader(),
      weightTrendReader: () => fakeWeightTrendReader(),
      weightRecorder: () => fakeWeightRecorder(() => today),
      intakeReader: intakeReaderOf,
    });

    await expect(ports.intakeReader.dailyIntake(philipp, today, today)).resolves.toEqual([
      { localDate: '2026-10-14', intakeMilliKcal: 208_800, recordedMealCategories: 1 },
    ]);
  });
});
