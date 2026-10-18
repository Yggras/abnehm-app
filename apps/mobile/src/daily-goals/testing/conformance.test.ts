import { Instant, type AreaKey, type BausteinKey } from '@abnehm/contracts/base';
import { DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import { EffectivePlan } from '@abnehm/contracts/ports';

import type { BausteinEvaluator, CheckInEvaluator, DailyGoalSnapshotOf, ValidPlan } from '../evaluators';
import {
  bausteinConformanceCases,
  checkInConformanceCases,
  type BausteinTruthRow,
  type CheckInTruthRow,
  type ConformanceCase,
} from './conformance';
import { noTestFacts, testBausteinEvaluators, testCheckInEvaluators, type TestDayFacts } from './test-evaluators';

// Nachweis für #104: Das Konformitäts-Testkit, Teil 1. Die Test-Evaluatoren bestehen es mit
// vollständigen Wahrheitstabellen; fehlerhafte Evaluatoren und lückenhafte Tabellen fallen durch.

const PERSON = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01';
const noon = Instant.parse('2026-10-14T10:00:00.000Z');
const evening = Instant.parse('2026-10-14T19:00:00.000Z');
const dayEnd = Instant.parse('2026-10-14T22:00:00.000Z');

const snapshotOf = <K extends BausteinKey>(type: K, thresholds: object = {}) =>
  DailyGoalSnapshot.parse({
    type,
    personId: PERSON,
    localDate: '2026-10-14',
    slot: 1,
    timeZone: 'Europe/Berlin',
    dayEndsAt: dayEnd,
    ...thresholds,
  }) as DailyGoalSnapshotOf<K>;

const facts = (partial: Partial<TestDayFacts>): TestDayFacts => ({ ...noTestFacts, ...partial });
const unusedReader = () => noTestFacts;
const bausteinEvaluator = <K extends BausteinKey>(baustein: K) =>
  testBausteinEvaluators(unusedReader)[baustein];
const checkInEvaluator = <T extends AreaKey>(tracker: T) =>
  testCheckInEvaluators(unusedReader)[tracker];

function row<K extends BausteinKey>(
  snapshot: DailyGoalSnapshotOf<K>,
  name: string,
  at: Instant,
  dayFacts: Partial<TestDayFacts>,
  expected: BausteinTruthRow<K, TestDayFacts>['expected'],
): BausteinTruthRow<K, TestDayFacts> {
  return { name, snapshot, at, facts: facts(dayFacts), expected };
}

const meals = snapshotOf('ernaehrung_erfasst', { minimumMealCategories: 2 });
const mealProgress = (recordedMealCategories: number) => ({ type: 'ernaehrung_erfasst' as const, recordedMealCategories, minimumMealCategories: 2 });
const mealRows = [
  row(meals, 'Ernährung 0 Mahlzeiten', noon, {}, { currentState: 'offen', progress: mealProgress(0) }),
  row(meals, 'Ernährung 1 Mahlzeit', evening, { recordedMealCategories: 1 }, { currentState: 'teilweise', progress: mealProgress(1) }),
  row(meals, 'Ernährung 2 Mahlzeiten', evening, { recordedMealCategories: 2 }, { currentState: 'erfuellt', progress: mealProgress(2) }),
  row(meals, 'Ernährung 3 Mahlzeiten', dayEnd, { recordedMealCategories: 3 }, { currentState: 'erfuellt', progress: mealProgress(3) }),
];

const water = snapshotOf('wasserziel', { targetMl: 1500 });
const waterProgress = (countedMl: number) => ({ type: 'wasserziel' as const, countedMl, targetMl: 1500 });
const waterRows = [
  row(water, 'Wasser 0 ml', noon, {}, { currentState: 'offen', progress: waterProgress(0) }),
  row(water, 'Wasser 1499 ml', evening, { countedMl: 1499 }, { currentState: 'teilweise', progress: waterProgress(1499) }),
  row(water, 'Wasser 1500 ml', evening, { countedMl: 1500 }, { currentState: 'erfuellt', progress: waterProgress(1500) }),
  row(water, 'Wasser 1501 ml', noon, { countedMl: 1501 }, { currentState: 'erfuellt', progress: waterProgress(1501) }),
];

const sport = snapshotOf('sporteinheit', { minimumSingleSessionMinutes: 50 });
const sportProgress = (longestSessionMinutes: number) => ({
  type: 'sporteinheit' as const,
  longestSessionMinutes,
  minimumSingleSessionMinutes: 50,
});
const sportRows = [
  row(sport, 'Sport ohne Einheit', evening, {}, { currentState: 'offen', progress: sportProgress(0) }),
  row(sport, 'Sport 49 min', evening, { sessionMinutes: [49] }, { currentState: 'teilweise', progress: sportProgress(49) }),
  row(sport, 'Sport 20 + 50 min', evening, { sessionMinutes: [20, 50] }, { currentState: 'erfuellt', progress: sportProgress(50) }),
  row(sport, 'Sport 51 min', noon, { sessionMinutes: [51] }, { currentState: 'erfuellt', progress: sportProgress(51) }),
];

const weighed = snapshotOf('gewogen');
const weighedProgress = (weightEntryCount: number) => ({ type: 'gewogen' as const, weightEntryCount });
const weighedRows = [
  row(weighed, 'Gewogen ohne Eintrag', evening, {}, { currentState: 'offen', progress: weighedProgress(0) }),
  row(weighed, 'Gewogen 1 Eintrag', noon, { weightEntryCount: 1 }, { currentState: 'erfuellt', progress: weighedProgress(1) }),
  row(weighed, 'Gewogen 2 Einträge', evening, { weightEntryCount: 2 }, { currentState: 'erfuellt', progress: weighedProgress(2) }),
];

const budget = snapshotOf('im_kalorienbudget', { budgetKcal: 1620, lowerBoundKcal: 1514 });
const budgetProgress = (intakeKcal: number) => ({ type: 'im_kalorienbudget' as const, intakeKcal, budgetKcal: 1620, lowerBoundKcal: 1514 });
const budgetRows = [
  row(budget, 'Budget abends im Rahmen, Tag offen', evening, { intakeKcal: 1600 }, { currentState: 'tagesende', progress: budgetProgress(1600) }),
  row(budget, 'Budget 0 kcal nach Tagesende', dayEnd, {}, { currentState: 'offen', progress: budgetProgress(0) }),
  row(budget, 'Budget 1513 kcal', dayEnd, { intakeKcal: 1513 }, { currentState: 'offen', progress: budgetProgress(1513) }),
  row(budget, 'Budget 1514 kcal', dayEnd, { intakeKcal: 1514 }, { currentState: 'erfuellt', progress: budgetProgress(1514) }),
  row(budget, 'Budget 1620 kcal', dayEnd, { intakeKcal: 1620 }, { currentState: 'erfuellt', progress: budgetProgress(1620) }),
  row(budget, 'Budget 1621 kcal', dayEnd, { intakeKcal: 1621 }, { currentState: 'offen', progress: budgetProgress(1621) }),
];

const goal = {
  id: '2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c01',
  validFrom: '2026-09-01',
  calorieBudgetMilliKcal: 1_620_000,
  lowerBoundMilliKcal: 1_514_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 76_000,
  waterTargetMl: 1500,
  weeklySportTargetMinutes: 150,
};
const planWith = (bausteine: [BausteinKey, BausteinKey, BausteinKey]) =>
  EffectivePlan.parse({
    type: 'gueltig',
    localDate: '2026-10-14',
    goal,
    weeklyPlanDay: { weeklyPlanVersionId: '2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02', validFrom: '2026-09-01', bausteine },
  }) as ValidPlan;
const sportDay = planWith(['ernaehrung_erfasst', 'wasserziel', 'sporteinheit']);
const weighDay = planWith(['ernaehrung_erfasst', 'wasserziel', 'gewogen']);
const otherDay = planWith(['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget']);

function checkIn<T extends AreaKey>(
  name: string,
  moment: 'mittag' | 'abend',
  plan: ValidPlan,
  dayFacts: Partial<TestDayFacts>,
  expected: CheckInTruthRow<T, TestDayFacts>['expected'],
): CheckInTruthRow<T, TestDayFacts> {
  return { name, moment, plan, facts: facts(dayFacts), expected };
}

const mealCheckIns = [
  checkIn('Check-in Ernährung mittags 0', 'mittag', otherDay, {}, { behind: true, reason: { type: 'ernaehrung', recordedMealCategories: 0 } }),
  checkIn('Check-in Ernährung mittags 1', 'mittag', otherDay, { recordedMealCategories: 1 }, { behind: false, reason: { type: 'ernaehrung', recordedMealCategories: 1 } }),
  checkIn('Check-in Ernährung abends 1', 'abend', otherDay, { recordedMealCategories: 1 }, { behind: true, reason: { type: 'ernaehrung', recordedMealCategories: 1 } }),
  checkIn('Check-in Ernährung abends 2', 'abend', otherDay, { recordedMealCategories: 2 }, { behind: false, reason: { type: 'ernaehrung', recordedMealCategories: 2 } }),
];
const waterReason = (countedMl: number) => ({ type: 'wasser' as const, countedMl, targetMl: 1500 });
const waterCheckIns = [
  checkIn('Check-in Wasser mittags 499 ml', 'mittag', otherDay, { countedMl: 499 }, { behind: true, reason: waterReason(499) }),
  checkIn('Check-in Wasser mittags 500 ml', 'mittag', otherDay, { countedMl: 500 }, { behind: false, reason: waterReason(500) }),
  checkIn('Check-in Wasser abends 999 ml', 'abend', otherDay, { countedMl: 999 }, { behind: true, reason: waterReason(999) }),
  checkIn('Check-in Wasser abends 1000 ml', 'abend', otherDay, { countedMl: 1000 }, { behind: false, reason: waterReason(1000) }),
];
const sportReason = (isSportDay: boolean, hasCountingEntry: boolean) => ({
  type: 'sport' as const,
  sportDay: isSportDay,
  hasCountingEntry,
  messageKey: 'checkin.sport.schon_trainiert',
});
const sportCheckIns = [
  checkIn('Check-in Sport mittags am Sporttag', 'mittag', sportDay, {}, { behind: false, reason: sportReason(true, false) }),
  checkIn('Check-in Sport abends am Sporttag ohne Einheit', 'abend', sportDay, {}, { behind: true, reason: sportReason(true, false) }),
  checkIn('Check-in Sport abends am Sporttag mit Einheit', 'abend', sportDay, { sessionMinutes: [10] }, { behind: false, reason: sportReason(true, true) }),
  checkIn('Check-in Sport abends ohne Sporttag', 'abend', otherDay, {}, { behind: false, reason: sportReason(false, false) }),
];
const weightReason = (isWeighDay: boolean, hasCountingEntry: boolean) => ({ type: 'gewicht' as const, weighDay: isWeighDay, hasCountingEntry });
const weightCheckIns = [
  checkIn('Check-in Gewicht mittags am Wiegetag', 'mittag', weighDay, {}, { behind: true, reason: weightReason(true, false) }),
  checkIn('Check-in Gewicht abends am Wiegetag', 'abend', weighDay, {}, { behind: true, reason: weightReason(true, false) }),
  checkIn('Check-in Gewicht abends gewogen', 'abend', weighDay, { weightEntryCount: 1 }, { behind: false, reason: weightReason(true, true) }),
  checkIn('Check-in Gewicht abends ohne Wiegetag', 'abend', otherDay, {}, { behind: false, reason: weightReason(false, false) }),
];

describe.each([
  ['ernaehrung_erfasst', mealRows],
  ['wasserziel', waterRows],
  ['sporteinheit', sportRows],
  ['gewogen', weighedRows],
  ['im_kalorienbudget', budgetRows],
] as const)('Konformität des Test-Evaluators %s', (baustein, rows) => {
  for (const conformanceCase of bausteinConformanceCases(bausteinEvaluator(baustein) as never, rows as never)) {
    test(conformanceCase.name, conformanceCase.run);
  }
});

describe.each([
  ['ernaehrung', mealCheckIns],
  ['wasser', waterCheckIns],
  ['sport', sportCheckIns],
  ['gewicht', weightCheckIns],
] as const)('Konformität des Test-Check-ins %s', (tracker, rows) => {
  for (const conformanceCase of checkInConformanceCases(checkInEvaluator(tracker) as never, rows as never)) {
    test(conformanceCase.name, conformanceCase.run);
  }
});

/** Die Fälle, deren Name `fragment` enthält, müssen scheitern. */
function expectFailing(cases: ConformanceCase[], fragment: string, message?: RegExp) {
  const failing = cases.filter((c) => c.name.includes(fragment));
  expect(failing.length).toBeGreaterThan(0);
  for (const c of failing) expect(c.run).toThrow(message);
}

describe('das Kit erkennt fehlerhafte Bereichsevaluatoren', () => {
  const waterEvaluator = bausteinEvaluator('wasserziel');

  test('Tagesende aus UTC-Mitternacht statt aus `dayEndsAt`', () => {
    const utcMidnight: BausteinEvaluator<'wasserziel', TestDayFacts> = {
      ...waterEvaluator,
      evaluate: (snapshot, at, dayFacts) => ({
        ...waterEvaluator.evaluate(snapshot, at, dayFacts),
        dayClosed: Date.parse(at) >= Date.parse(`${snapshot.localDate}T00:00:00.000Z`) + 86_400_000,
      }),
    };
    expectFailing(bausteinConformanceCases(utcMidnight, waterRows), 'Reise', /day_closed/);
    expectFailing(bausteinConformanceCases(utcMidnight, waterRows), 'Zeitumstellung', /day_closed/);
  });

  test('Gewicht `teilweise`', () => {
    const weighedEvaluator = bausteinEvaluator('gewogen');
    const partial: BausteinEvaluator<'gewogen', TestDayFacts> = {
      ...weighedEvaluator,
      evaluate: (snapshot, at, dayFacts) => {
        const evaluation = weighedEvaluator.evaluate(snapshot, at, dayFacts);
        return dayFacts.weightEntryCount === 1 ? { ...evaluation, currentState: 'teilweise' } : evaluation;
      },
    };
    const cases = bausteinConformanceCases(partial, weighedRows);
    expect(cases.find((c) => c.name === 'Gewogen 1 Eintrag')?.run).toThrow(/result_shape/);
  });

  test('Kalorienbudget vor dem Tagesende entschieden', () => {
    const budgetEvaluator = bausteinEvaluator('im_kalorienbudget');
    const early: BausteinEvaluator<'im_kalorienbudget', TestDayFacts> = {
      ...budgetEvaluator,
      evaluate: (snapshot, at, dayFacts) => budgetEvaluator.evaluate(snapshot, snapshot.dayEndsAt, dayFacts),
    };
    expectFailing(bausteinConformanceCases(early, budgetRows), 'Tagesverlauf');
  });

  test('Schwelle nicht aus dem Snapshot', () => {
    const fixed: BausteinEvaluator<'wasserziel', TestDayFacts> = {
      ...waterEvaluator,
      evaluate: (snapshot, at, dayFacts) => waterEvaluator.evaluate({ ...snapshot, targetMl: 2000 }, at, dayFacts),
    };
    expect(bausteinConformanceCases(fixed, waterRows)[1]?.run).toThrow(/threshold/);
  });

  test('nicht deterministisch', () => {
    let calls = 0;
    const counting: BausteinEvaluator<'wasserziel', TestDayFacts> = {
      ...waterEvaluator,
      evaluate: (snapshot, at, dayFacts) => ({ ...waterEvaluator.evaluate(snapshot, at, dayFacts), values: { calls: ++calls } }),
    };
    expectFailing(bausteinConformanceCases(counting, waterRows), 'deterministisch', /weichen ab/);
  });

  test('verändert seine Eingaben', () => {
    const mutating: BausteinEvaluator<'wasserziel', TestDayFacts> = {
      ...waterEvaluator,
      evaluate: (snapshot, at, dayFacts) => {
        (dayFacts as { countedMl: number }).countedMl += 0;
        return waterEvaluator.evaluate(snapshot, at, dayFacts);
      },
    };
    expect(bausteinConformanceCases(mutating, waterRows)[1]?.run).toThrow(TypeError);
  });

  test('lückenhafte Wahrheitstabelle', () => {
    const [coverage] = bausteinConformanceCases(waterEvaluator, waterRows.slice(0, 2));
    expect(coverage?.run).toThrow(/1500 \(exakt auf der Schwelle 1500\)/);
    const [budgetCoverage] = bausteinConformanceCases(bausteinEvaluator('im_kalorienbudget'), budgetRows.slice(0, 4));
    expect(budgetCoverage?.run).toThrow(/1620 kcal nach Tagesende/);
  });

  test('Check-in nur, wenn der Tracker auf einem Momo-Platz liegt', () => {
    const mealEvaluator = checkInEvaluator('ernaehrung');
    const slotBound: CheckInEvaluator<'ernaehrung', TestDayFacts> = {
      ...mealEvaluator,
      evaluate: (context, dayFacts) => {
        const result = mealEvaluator.evaluate(context, dayFacts);
        return context.plan.weeklyPlanDay.bausteine.includes('ernaehrung_erfasst') ? result : { ...result, behind: false };
      },
    };
    const cases = checkInConformanceCases(slotBound, mealCheckIns);
    expect(cases.find((c) => c.name === 'Check-in Ernährung mittags 0 · auch ohne Momo-Platz an diesem Tag')?.run).toThrow(
      /Wochenplantag ohne den Tracker/,
    );
  });

  test('Check-in hängt am Kalorienbudget', () => {
    const waterCheckIn = checkInEvaluator('wasser');
    const budgetBound: CheckInEvaluator<'wasser', TestDayFacts> = {
      ...waterCheckIn,
      evaluate: (context, dayFacts) => {
        const result = waterCheckIn.evaluate(context, dayFacts);
        return { ...result, reason: { ...result.reason, targetMl: context.plan.goal.calorieBudgetMilliKcal / 1080 } };
      },
    };
    expectFailing(checkInConformanceCases(budgetBound, waterCheckIns), 'Kalorienbudget');
  });

  test('Sporttag nicht aus dem Wochenplan', () => {
    const sportCheckIn = checkInEvaluator('sport');
    const alwaysSportDay: CheckInEvaluator<'sport', TestDayFacts> = {
      ...sportCheckIn,
      evaluate: (context, dayFacts) => sportCheckIn.evaluate({ ...context, plan: sportDay }, dayFacts),
    };
    const cases = checkInConformanceCases(alwaysSportDay, sportCheckIns);
    expect(cases.find((c) => c.name === 'Check-in Sport abends ohne Sporttag')?.run).toThrow(/plan_day/);
  });

  test('lückenhafte Check-in-Tabelle', () => {
    const [coverage] = checkInConformanceCases(checkInEvaluator('wasser'), waterCheckIns.slice(1));
    expect(coverage?.run).toThrow(/mittag: knapp unter und exakt auf 1\/3/);
  });
});
