/**
 * @jest-environment node
 */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone, type BausteinKey } from '@abnehm/contracts/base';
import { DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import { EffectivePlan } from '@abnehm/contracts/ports';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases, type LocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import {
  createDailyGoalRegistry,
  type BausteinEvaluator,
  type CheckInEvaluator,
  type DailyGoalRegistry,
  type DailyGoalSnapshotOf,
  type ValidPlan,
} from '.';
import { completionConformanceCases } from './testing/completion-conformance';
import { insertCompletionForTest, insertDailyGoalForTest, insertPersonForTest } from './testing/persisted';
import { createTestFactsStore, noTestFacts, testBausteinEvaluators, testCheckInEvaluators, type TestDayFacts } from './testing/test-evaluators';

// Nachweis für #104: `evaluateDailyGoal` und `evaluateCheckIn` reichen an die registrierten
// Evaluatoren weiter, prüfen deren Ergebnisse und ergänzen die persistierte Tageszielerfüllung.

const PERSON = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const GOAL = '0d0b1000-0000-4000-8000-000000000001';
const COMPLETION = '0d0b2000-0000-4000-8000-000000000001';
const today = LocalDate.parse('2026-10-14');
const berlin = TimeZone.parse('Europe/Berlin');
const dayEnd = Instant.parse('2026-10-14T22:00:00.000Z');
const evening = Instant.parse('2026-10-14T19:00:00.000Z');

function snapshotOf<K extends BausteinKey>(type: K, thresholds: object = {}, day: object = {}): DailyGoalSnapshotOf<K> {
  return DailyGoalSnapshot.parse({
    type,
    personId: PERSON,
    localDate: today,
    slot: 1,
    timeZone: berlin,
    dayEndsAt: dayEnd,
    ...thresholds,
    ...day,
  }) as DailyGoalSnapshotOf<K>;
}

const water = snapshotOf('wasserziel', { targetMl: 1500 });
const budget = snapshotOf('im_kalorienbudget', { budgetKcal: 1620, lowerBoundKcal: 1514 }, { slot: 3 });

const testFacts = (partial: Partial<TestDayFacts>): TestDayFacts => ({ ...noTestFacts, ...partial });
const evaluatorFor = <K extends BausteinKey>(baustein: K) =>
  testBausteinEvaluators(() => noTestFacts)[baustein];

describe('Konformitäts-Testkit, Teil 2: Erfüllung über den Orchestrator', () => {
  const scenarios = [
    {
      evaluator: evaluatorFor('ernaehrung_erfasst'),
      snapshot: snapshotOf('ernaehrung_erfasst', { minimumMealCategories: 2 }),
      fulfilled: { at: evening, facts: testFacts({ recordedMealCategories: 2 }) },
      corrected: { at: evening, facts: testFacts({ recordedMealCategories: 1 }) },
    },
    {
      evaluator: evaluatorFor('wasserziel'),
      snapshot: water,
      fulfilled: { at: evening, facts: testFacts({ countedMl: 1500 }) },
      corrected: { at: evening, facts: testFacts({ countedMl: 1250 }) },
    },
    {
      evaluator: evaluatorFor('sporteinheit'),
      snapshot: snapshotOf('sporteinheit', { minimumSingleSessionMinutes: 50 }),
      fulfilled: { at: evening, facts: testFacts({ sessionMinutes: [50] }) },
      corrected: { at: evening, facts: testFacts({}) },
    },
    {
      evaluator: evaluatorFor('gewogen'),
      snapshot: snapshotOf('gewogen'),
      fulfilled: { at: evening, facts: testFacts({ weightEntryCount: 1 }) },
      corrected: { at: evening, facts: testFacts({}) },
    },
    {
      evaluator: evaluatorFor('im_kalorienbudget'),
      snapshot: budget,
      fulfilled: { at: dayEnd, facts: testFacts({ intakeKcal: 1600 }) },
      corrected: { at: Instant.parse('2026-10-15T08:00:00.000Z'), facts: testFacts({ intakeKcal: 1800 }) },
    },
  ];

  for (const scenario of scenarios) {
    for (const conformanceCase of completionConformanceCases(scenario as never)) {
      test(conformanceCase.name, conformanceCase.run);
    }
  }
});

let files: ReturnType<typeof createBetterSqliteFiles>;
let databases: LocalDatabases;
let db: LocalDatabase;
let store: ReturnType<typeof createTestFactsStore>;
let registry: DailyGoalRegistry;

beforeEach(async () => {
  files = createBetterSqliteFiles();
  databases = createLocalDatabases({
    openSqlite: files.openSqlite,
    onError: (error) => {
      throw error;
    },
  });
  db = await databases.open('konto_a');
  store = createTestFactsStore();
  registry = createDailyGoalRegistry({
    bausteine: Object.values(testBausteinEvaluators(store.read)),
    checkIns: Object.values(testCheckInEvaluators(store.read)),
  });
  db.transaction((tx) => insertPersonForTest(tx, PERSON));
});

afterEach(() => {
  databases.lock();
  files.remove();
});

const evaluate = (snapshot: DailyGoalSnapshot, at: Instant, target = registry) =>
  db.read((tx) => target.evaluateDailyGoal(tx, snapshot, at));

function recordCompletion(snapshot: DailyGoalSnapshot, firstCompletedAt: Instant) {
  db.transaction((tx) => {
    insertDailyGoalForTest(tx, GOAL, snapshot);
    insertCompletionForTest(tx, COMPLETION, GOAL, snapshot, firstCompletedAt);
  });
}

describe('evaluateDailyGoal', () => {
  it('gibt an den Evaluator des Bausteins weiter; der Reader liest Person und Tag des Snapshots in der übergebenen Transaktion', () => {
    const reads: unknown[] = [];
    const spy: BausteinEvaluator<'wasserziel', TestDayFacts> = {
      ...evaluatorFor('wasserziel'),
      readFacts: (tx, personId, localDate) => {
        reads.push({ personId, localDate, inTransaction: tx !== undefined });
        return testFacts({ countedMl: 750 });
      },
    };
    const target = createDailyGoalRegistry({ bausteine: [spy], checkIns: [] });

    expect(evaluate(water, evening, target)).toEqual({
      type: 'evaluated',
      currentState: 'teilweise',
      dayClosed: false,
      progress: { type: 'wasserziel', countedMl: 750, targetMl: 1500 },
      messageKey: 'tagesziel.wasserziel.teilweise',
      values: { countedMl: 750, targetMl: 1500 },
      completion: { type: 'nie' },
    });
    expect(reads).toEqual([{ personId: PERSON, localDate: today, inTransaction: true }]);
  });

  it('läuft auch in der Schreibtransaktion des Auslösers', () => {
    store.set(PERSON, today, { countedMl: 1500 });

    const result = db.transaction((tx) => registry.evaluateDailyGoal(tx, water, evening));

    expect(result).toMatchObject({ type: 'evaluated', currentState: 'erfuellt', completion: { type: 'nie' } });
  });

  it('liefert für einen Baustein ohne Evaluator einen Vertragsfehler statt einer Ausnahme', () => {
    const withoutWater = createDailyGoalRegistry({ bausteine: [evaluatorFor('gewogen')], checkIns: [] });

    expect(evaluate(water, evening, withoutWater)).toEqual({
      type: 'contract_error',
      error: { code: 'unknown_catalog_key', context: { baustein: 'wasserziel' }, retryable: false },
    });
  });

  it('weist einen ungültigen Snapshot ab', () => {
    const invalid = { ...budget, budgetKcal: 1400 } as DailyGoalSnapshot;

    expect(evaluate(invalid, evening)).toEqual({
      type: 'contract_error',
      error: { code: 'invalid_snapshot', retryable: false },
    });
  });

  it.each([
    ['Zustand passt nicht zum Fortschritt', { currentState: 'erfuellt' }, 'result_shape'],
    ['Fortschritt eines anderen Bausteins', { progress: { type: 'gewogen', weightEntryCount: 0 }, currentState: 'offen' }, 'progress_type'],
    ['andere Schwelle als im Snapshot', { progress: { type: 'wasserziel', countedMl: 0, targetMl: 2000 } }, 'threshold'],
    ['Tagesende widerspricht `dayEndsAt`', { dayClosed: true }, 'day_closed'],
  ])('weist ein Ergebnis ab: %s', (_, override, issue) => {
    const broken: BausteinEvaluator<'wasserziel', TestDayFacts> = {
      ...evaluatorFor('wasserziel'),
      readFacts: () => noTestFacts,
      evaluate: (snapshot, at, facts) => ({ ...evaluatorFor('wasserziel').evaluate(snapshot, at, facts), ...override }) as never,
    };
    const target = createDailyGoalRegistry({ bausteine: [broken], checkIns: [] });

    expect(evaluate(water, evening, target)).toEqual({
      type: 'contract_error',
      error: { code: 'invalid_payload', context: { baustein: 'wasserziel', issue }, retryable: false },
    });
  });

  it('ergänzt die persistierte Erfüllung auch dann, wenn die Einträge sie nicht mehr tragen', () => {
    recordCompletion(water, evening);
    store.set(PERSON, today, { countedMl: 250 });

    expect(evaluate(water, Instant.parse('2026-10-14T21:00:00.000Z'))).toMatchObject({
      currentState: 'teilweise',
      completion: { type: 'festgehalten', firstCompletedAt: evening },
    });
  });

  describe('Tag und Tagesende kommen aus dem Snapshot (Testuhr)', () => {
    const clock = createTestClock({ instant: Instant.parse('2026-10-14T17:00:00.000Z'), timeZone: berlin });

    beforeEach(() => {
      clock.set(Instant.parse('2026-10-14T17:00:00.000Z'));
      clock.setTimeZone(berlin);
      store.set(PERSON, today, { intakeKcal: 1600 });
    });

    it('Reise nach Westen: In New York ist noch der 14., der Tag des Snapshots ist trotzdem zu Ende', () => {
      clock.setTimeZone(TimeZone.parse('America/New_York'));
      clock.set(Instant.parse('2026-10-14T23:30:00.000Z'));
      expect(clock.read().localDate).toBe('2026-10-14');

      expect(evaluate(budget, clock.read().instant)).toMatchObject({ dayClosed: true, currentState: 'erfuellt' });
    });

    it('Reise nach Osten: In Tokio ist schon der 15., Tag und Erfüllung bleiben beim Snapshot', () => {
      recordCompletion(water, evening);
      store.set(PERSON, today, { intakeKcal: 1600, countedMl: 1500 });
      clock.setTimeZone(TimeZone.parse('Asia/Tokyo'));
      clock.set(Instant.parse('2026-10-14T16:00:00.000Z'));
      expect(clock.read().localDate).toBe('2026-10-15');

      expect(evaluate(budget, clock.read().instant)).toMatchObject({ dayClosed: false, currentState: 'tagesende' });
      expect(evaluate(water, clock.read().instant)).toMatchObject({
        dayClosed: false,
        currentState: 'erfuellt',
        completion: { type: 'festgehalten', firstCompletedAt: evening },
      });
    });

    it('späterer Zonenwechsel der Person verschiebt das Tagesende nicht', () => {
      clock.set(Instant.parse('2026-10-14T21:59:59.999Z'));
      clock.setTimeZone(TimeZone.parse('Pacific/Honolulu'));

      expect(evaluate(budget, clock.read().instant)).toMatchObject({ dayClosed: false, currentState: 'tagesende' });
      clock.advanceBy(1);
      expect(evaluate(budget, clock.read().instant)).toMatchObject({ dayClosed: true, currentState: 'erfuellt' });
    });

    it('Zeitumstellung: Der 25.10. dauert 25 Stunden, 24 Stunden nach Mitternacht ist er noch offen', () => {
      const longDay = snapshotOf('im_kalorienbudget', { budgetKcal: 1620, lowerBoundKcal: 1514 }, {
        localDate: '2026-10-25',
        dayEndsAt: '2026-10-25T23:00:00.000Z',
      });
      store.set(PERSON, LocalDate.parse('2026-10-25'), { intakeKcal: 1600 });
      clock.set(Instant.parse('2026-10-25T22:00:00.000Z'));
      expect(clock.read().localDate).toBe('2026-10-25');

      expect(evaluate(longDay, clock.read().instant)).toMatchObject({ dayClosed: false, currentState: 'tagesende' });
      clock.advanceBy(3_600_000);
      expect(evaluate(longDay, clock.read().instant)).toMatchObject({ dayClosed: true, currentState: 'erfuellt' });
    });
  });
});

const goal = {
  id: '2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c01',
  validFrom: '2026-09-01',
  calorieBudgetMilliKcal: 1_620_000,
  lowerBoundMilliKcal: 1_514_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 76_000,
  waterTargetMl: 2000,
  weeklySportTargetMinutes: 150,
};
const planOf = (bausteine: [BausteinKey, BausteinKey, BausteinKey], localDate = today) =>
  EffectivePlan.parse({
    type: 'gueltig',
    localDate,
    goal,
    weeklyPlanDay: { weeklyPlanVersionId: '2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02', validFrom: '2026-09-01', bausteine },
  }) as ValidPlan;
const withoutWaterSlot = planOf(['ernaehrung_erfasst', 'im_kalorienbudget', 'sporteinheit']);

const checkIn = (input: Partial<Parameters<DailyGoalRegistry['evaluateCheckIn']>[1]>, target = registry) =>
  db.read((tx) =>
    target.evaluateCheckIn(tx, { tracker: 'wasser', personId: PERSON, localDate: today, moment: 'mittag', plan: withoutWaterSlot, ...input }),
  );

describe('evaluateCheckIn', () => {
  it('wertet den Tracker auch ohne Momo-Platz an diesem Tag aus', () => {
    store.set(PERSON, today, { countedMl: 600 });

    expect(checkIn({ moment: 'mittag' })).toEqual({
      type: 'evaluated',
      tracker: 'wasser',
      moment: 'mittag',
      behind: true,
      reason: { type: 'wasser', countedMl: 600, targetMl: 2000 },
    });
    expect(checkIn({ moment: 'abend', tracker: 'ernaehrung' })).toMatchObject({ type: 'evaluated', behind: true });
  });

  it('liest die Fakten zu Person und Tag des Plans', () => {
    const reads: unknown[] = [];
    const wasser = testCheckInEvaluators(store.read).wasser;
    const spy: CheckInEvaluator<'wasser', TestDayFacts> = {
      ...wasser,
      readFacts: (_tx, personId, localDate) => {
        reads.push({ personId, localDate });
        return noTestFacts;
      },
    };

    checkIn({}, createDailyGoalRegistry({ bausteine: [], checkIns: [spy] }));

    expect(reads).toEqual([{ personId: PERSON, localDate: today }]);
  });

  it('liefert für einen Tracker ohne Evaluator einen Vertragsfehler statt einer Ausnahme', () => {
    expect(checkIn({ tracker: 'gewicht' }, createDailyGoalRegistry({ bausteine: [], checkIns: [] }))).toEqual({
      type: 'contract_error',
      error: { code: 'unknown_catalog_key', context: { tracker: 'gewicht' }, retryable: false },
    });
  });

  it.each([
    ['einen leeren Plan', { plan: EffectivePlan.parse({ type: 'leer', localDate: today }) as never }],
    ['einen Plan für einen anderen Tag', { plan: planOf(['ernaehrung_erfasst', 'wasserziel', 'gewogen'], LocalDate.parse('2026-10-15')) }],
    ['das Kalorienbudget als Tracker', { tracker: 'im_kalorienbudget' as never }],
    ['einen unbekannten Zeitpunkt', { moment: 'morgens' as never }],
  ])('weist %s ab', (_, input) => {
    expect(checkIn(input)).toEqual({ type: 'contract_error', error: { code: 'invalid_payload', retryable: false } });
  });

  it.each([
    ['`behind` widerspricht den Regeln', { behind: false, reason: { type: 'wasser', countedMl: 0, targetMl: 2000 } }, 'result_shape'],
    ['Wasserziel nicht aus der Zielversion', { behind: true, reason: { type: 'wasser', countedMl: 0, targetMl: 1500 } }, 'threshold'],
  ])('weist ein Ergebnis ab: %s', (_, result, issue) => {
    const broken: CheckInEvaluator<'wasser', TestDayFacts> = {
      tracker: 'wasser',
      readFacts: () => noTestFacts,
      evaluate: () => result as never,
    };

    expect(checkIn({}, createDailyGoalRegistry({ bausteine: [], checkIns: [broken] }))).toEqual({
      type: 'contract_error',
      error: { code: 'invalid_payload', context: { tracker: 'wasser', issue }, retryable: false },
    });
  });
});

describe('createDailyGoalRegistry', () => {
  it('lehnt doppelt registrierte Bausteine und Tracker ab', () => {
    const first = testBausteinEvaluators(store.read).wasserziel;
    const firstCheckIn = testCheckInEvaluators(store.read).wasser;

    expect(() => createDailyGoalRegistry({ bausteine: [first, first], checkIns: [] })).toThrow('Baustein doppelt registriert');
    expect(() => createDailyGoalRegistry({ bausteine: [], checkIns: [firstCheckIn, firstCheckIn] })).toThrow('Tracker doppelt registriert');
  });

  it('kennt das Kalorienbudget nicht als Check-in-Tracker', () => {
    const budgetCheckIn = { tracker: 'im_kalorienbudget', readFacts: () => noTestFacts, evaluate: () => ({}) } as never;

    expect(() => createDailyGoalRegistry({ bausteine: [], checkIns: [budgetCheckIn] })).toThrow('Kein Check-in-Tracker');
  });
});
