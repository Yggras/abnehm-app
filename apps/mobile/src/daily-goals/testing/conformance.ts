import { Instant, LocalDate, TimeZone, type AreaKey, type BausteinKey } from '@abnehm/contracts/base';
import {
  DailyGoalSnapshot,
  type CheckInMoment,
  type CheckInReason,
  type DailyGoalProgress,
  type DailyGoalState,
} from '@abnehm/contracts/daily-goals';
import { EffectivePlan } from '@abnehm/contracts/ports';

import type {
  BausteinEvaluator,
  CheckInEvaluator,
  CheckInReasonOf,
  DailyGoalProgressOf,
  DailyGoalSnapshotOf,
  ValidPlan,
} from '../evaluators';
import { checkBausteinEvaluation, checkCheckInEvaluation } from '../rules';

// Konformitäts-Testkit, Teil 1: was jeder Bereichsevaluator erfüllen muss (Spezifikation 0,
// Abschnitt 3). Der Bereich liefert seine Wahrheitstabelle; das Kit prüft Ergebnisform, die festen
// Zustandsregeln, Schwellen, Tagesende, Determinismus und die Abdeckung der Tabelle und leitet daraus
// Tagesverlauf, Reise und Zeitumstellung selbst ab. Teil 2 (`completion-conformance.ts`) prüft die
// Erfüllung über den Orchestrator. Wie das Uhr-Testkit hängt es von keinem Testrunner ab: Jeder Fall
// wirft bei einer Abweichung, Jest registriert die Fälle mit `test(name, run)`.

export type ConformanceCase = { name: string; run(): void };

/** Eine Zeile der Wahrheitstabelle eines Bausteins. */
export type BausteinTruthRow<K extends BausteinKey, Facts> = {
  name: string;
  snapshot: DailyGoalSnapshotOf<K>;
  at: Instant;
  facts: Facts;
  expected: { currentState: DailyGoalState; progress: DailyGoalProgressOf<K> };
};

/** Eine Zeile der Wahrheitstabelle eines Tages-Check-ins. */
export type CheckInTruthRow<T extends AreaKey, Facts> = {
  name: string;
  moment: CheckInMoment;
  plan: ValidPlan;
  facts: Facts;
  expected: { behind: boolean; reason: CheckInReasonOf<T> };
};

const HOUR = 3_600_000;

export function bausteinConformanceCases<K extends BausteinKey, Facts>(
  evaluator: BausteinEvaluator<K, Facts>,
  rows: readonly BausteinTruthRow<K, Facts>[],
): ConformanceCase[] {
  const evaluateChecked = (snapshot: DailyGoalSnapshotOf<K>, at: Instant, facts: Facts) => {
    const value = evaluator.evaluate(frozenCopy(snapshot), at, frozenCopy(facts));
    const checked = checkBausteinEvaluation(snapshot, at, value);
    if (!checked.ok) fail(`verletzt die Regel „${checked.issue}“ um ${at}: ${JSON.stringify(value)}`);
    return checked.evaluation;
  };

  /** Bei gleichen Fakten bleibt der Fortschritt gleich; nur das Kalorienbudget hängt am Tagesende. */
  const expectSameDay = (row: BausteinTruthRow<K, Facts>, snapshot: DailyGoalSnapshotOf<K>, at: Instant, label: string) => {
    const evaluation = evaluateChecked(snapshot, at, row.facts);
    if (!deepEqual(evaluation.progress, row.expected.progress)) {
      fail(`${label}: Fortschritt ${JSON.stringify(evaluation.progress)} statt ${JSON.stringify(row.expected.progress)}`);
    }
    if (evaluator.baustein !== 'im_kalorienbudget' && evaluation.currentState !== row.expected.currentState) {
      fail(`${label}: Zustand ${evaluation.currentState} statt ${row.expected.currentState}`);
    }
  };

  return [
    {
      name: `Wahrheitstabelle ${evaluator.baustein}: Schwellen und Zustände abgedeckt`,
      run: () => {
        if (rows.length === 0) fail('Die Wahrheitstabelle ist leer');
        for (const row of rows) {
          DailyGoalSnapshot.parse(row.snapshot);
          if (row.snapshot.type !== evaluator.baustein) fail(`${row.name}: Snapshot für ${row.snapshot.type}`);
        }
        const gaps = bausteinCoverageGaps(evaluator.baustein, rows);
        if (gaps.length > 0) fail(`Es fehlen Zeilen für: ${gaps.join('; ')}`);
      },
    },
    ...rows.flatMap((row) => [
      {
        name: `${row.name}`,
        run: () => {
          const evaluation = evaluateChecked(row.snapshot, row.at, row.facts);
          if (evaluation.currentState !== row.expected.currentState) {
            fail(`Zustand ${evaluation.currentState} statt ${row.expected.currentState}`);
          }
          if (!deepEqual(evaluation.progress, row.expected.progress)) {
            fail(`Fortschritt ${JSON.stringify(evaluation.progress)} statt ${JSON.stringify(row.expected.progress)}`);
          }
        },
      },
      {
        name: `${row.name} · deterministisch, ohne die Eingaben zu verändern`,
        run: () => {
          const first = evaluateChecked(row.snapshot, row.at, row.facts);
          const second = evaluateChecked(row.snapshot, row.at, row.facts);
          if (!deepEqual(first, second)) fail(`Zwei Auswertungen weichen ab: ${JSON.stringify([first, second])}`);
        },
      },
      {
        name: `${row.name} · Tagesverlauf und Reise: Tagesende nur aus dem Snapshot`,
        run: () => {
          const end = Date.parse(row.snapshot.dayEndsAt);
          const moments: [string, number][] = [
            ['mittags', end - 12 * HOUR],
            ['abends', end - 3 * HOUR],
            ['Reise nach Osten: dort ist schon der nächste Tag', end - 6 * HOUR],
            ['letzte Millisekunde', end - 1],
            ['Tagesende', end],
            ['Reise nach Westen: dort läuft der Tag noch', end + 2 * HOUR],
            ['Nachtrag drei Tage später', end + 72 * HOUR],
          ];
          for (const [label, ms] of moments) expectSameDay(row, row.snapshot, instantAt(ms), label);
        },
      },
      {
        name: `${row.name} · Zeitumstellung: 23- und 25-Stunden-Tag`,
        run: () => {
          for (const day of dstDays) {
            const snapshot = { ...row.snapshot, localDate: day.localDate, timeZone: day.timeZone, dayEndsAt: day.dayEndsAt };
            const end = Date.parse(day.dayEndsAt);
            for (const [label, ms] of [
              ['letzte Millisekunde', end - 1],
              ['24 Stunden nach Tagesbeginn', Date.parse(day.startsAt) + 24 * HOUR],
              ['Tagesende', end],
            ] as const) {
              expectSameDay(row, snapshot, instantAt(ms), `${day.localDate} ${label}`);
            }
          }
        },
      },
    ]),
  ];
}

export function checkInConformanceCases<T extends AreaKey, Facts>(
  evaluator: CheckInEvaluator<T, Facts>,
  rows: readonly CheckInTruthRow<T, Facts>[],
): ConformanceCase[] {
  const expectRow = (row: CheckInTruthRow<T, Facts>, plan: ValidPlan, label: string) => {
    const context = { moment: row.moment, plan };
    const value = evaluator.evaluate(frozenCopy(context), frozenCopy(row.facts));
    const checked = checkCheckInEvaluation(evaluator.tracker, context, value);
    if (!checked.ok) fail(`${label}: verletzt die Regel „${checked.issue}“: ${JSON.stringify(value)}`);
    const { behind, reason } = checked.evaluation;
    if (behind !== row.expected.behind || !deepEqual(reason, row.expected.reason)) {
      fail(`${label}: ${JSON.stringify({ behind, reason })} statt ${JSON.stringify(row.expected)}`);
    }
  };

  return [
    {
      name: `Wahrheitstabelle Check-in ${evaluator.tracker}: Regeln aus #37 abgedeckt`,
      run: () => {
        if (rows.length === 0) fail('Die Wahrheitstabelle ist leer');
        for (const row of rows) {
          const plan = EffectivePlan.parse(row.plan);
          if (plan.type !== 'gueltig') fail(`${row.name}: Check-ins brauchen einen gültigen Plan`);
          if (row.expected.reason.type !== evaluator.tracker) fail(`${row.name}: Grund für ${row.expected.reason.type}`);
        }
        const gaps = checkInCoverageGaps(evaluator.tracker, rows);
        if (gaps.length > 0) fail(`Es fehlen Zeilen für: ${gaps.join('; ')}`);
      },
    },
    ...rows.flatMap((row) => [
      { name: `${row.name}`, run: () => expectRow(row, row.plan, row.name) },
      {
        name: `${row.name} · deterministisch, ohne die Eingaben zu verändern`,
        run: () => {
          expectRow(row, row.plan, 'erste Auswertung');
          expectRow(row, row.plan, 'zweite Auswertung');
        },
      },
      {
        name: `${row.name} · unabhängig vom Kalorienbudget`,
        run: () => {
          for (const [budget, lowerBound] of [
            [1_000_000, 1_000_000],
            [4_000_000, 1_200_000],
          ] as const) {
            const plan = { ...row.plan, goal: { ...row.plan.goal, calorieBudgetMilliKcal: budget, lowerBoundMilliKcal: lowerBound } };
            expectRow(row, plan, `Budget ${budget / 1000} kcal`);
          }
        },
      },
      ...(evaluator.tracker === 'ernaehrung' || evaluator.tracker === 'wasser'
        ? [
            {
              name: `${row.name} · auch ohne Momo-Platz an diesem Tag`,
              run: () => {
                const bausteine = withoutTracker[evaluator.tracker as 'ernaehrung' | 'wasser'];
                const plan = { ...row.plan, weeklyPlanDay: { ...row.plan.weeklyPlanDay, bausteine } };
                expectRow(row, plan, 'Wochenplantag ohne den Tracker');
              },
            },
          ]
        : []),
    ]),
  ];
}

/** Wochenplantage ohne die Bausteine eines Trackers, für die Tracker, deren Check-in nicht am Wochenplan hängt. */
const withoutTracker: Record<'ernaehrung' | 'wasser', [BausteinKey, BausteinKey, BausteinKey]> = {
  ernaehrung: ['wasserziel', 'sporteinheit', 'gewogen'],
  wasser: ['ernaehrung_erfasst', 'im_kalorienbudget', 'sporteinheit'],
};

/** Tage der Sommerzeitumstellung in Europe/Berlin mit Beginn und festgeschriebenem Ende. */
const dstDays = [
  { localDate: '2026-03-29', startsAt: '2026-03-28T23:00:00.000Z', dayEndsAt: '2026-03-29T22:00:00.000Z' },
  { localDate: '2026-10-25', startsAt: '2026-10-24T22:00:00.000Z', dayEndsAt: '2026-10-25T23:00:00.000Z' },
].map((day) => ({
  localDate: LocalDate.parse(day.localDate),
  timeZone: TimeZone.parse('Europe/Berlin'),
  startsAt: Instant.parse(day.startsAt),
  dayEndsAt: Instant.parse(day.dayEndsAt),
}));

/** Zeilen, die eine Wahrheitstabelle mindestens enthalten muss: knapp unter, auf und über jeder Schwelle. */
function bausteinCoverageGaps<K extends BausteinKey, Facts>(baustein: K, rows: readonly BausteinTruthRow<K, Facts>[]): string[] {
  const gaps: string[] = [];
  const states = new Set(rows.map((row) => row.expected.currentState));
  const requireStates = (...required: DailyGoalState[]) => {
    for (const state of required) if (!states.has(state)) gaps.push(`Zustand ${state}`);
  };
  const progress: DailyGoalProgress[] = rows.map((row) => row.expected.progress);

  if (baustein === 'im_kalorienbudget') {
    requireStates('tagesende', 'offen', 'erfuellt');
    const closed: DailyGoalProgress[] = rows
      .filter((row) => row.expected.currentState !== 'tagesende')
      .map((row) => row.expected.progress);
    for (const bounds of distinct(closed.map(budgetBounds))) {
      const intakes = new Set(closed.filter((p) => sameJson(budgetBounds(p), bounds)).map(intakeOf));
      for (const [value, label] of [
        [bounds.lowerBoundKcal - 1, 'knapp unter der Untergrenze'],
        [bounds.lowerBoundKcal, 'exakt auf der Untergrenze'],
        [bounds.budgetKcal, 'exakt auf dem Budget'],
        [bounds.budgetKcal + 1, 'knapp über dem Budget'],
      ] as const) {
        if (!intakes.has(value)) gaps.push(`${value} kcal nach Tagesende (${label})`);
      }
    }
    return gaps;
  }

  if (baustein === 'gewogen') {
    requireStates('offen', 'erfuellt');
    const counts = new Set(progress.map(measureOf));
    for (const count of [0, 1, 2]) if (!counts.has(count)) gaps.push(`${count} Gewichtseinträge`);
    return gaps;
  }

  const thresholds = new Set(progress.map(thresholdOf));
  requireStates('offen', 'erfuellt', ...([...thresholds].some((t) => t > 1) ? (['teilweise'] as const) : []));
  const measured = new Set(progress.map(measureOf));
  if (!measured.has(0)) gaps.push('0 (offen)');
  for (const threshold of thresholds) {
    const sameThreshold = new Set(progress.filter((p) => thresholdOf(p) === threshold).map(measureOf));
    const upper = baustein === 'ernaehrung_erfasst' ? 4 : Number.POSITIVE_INFINITY;
    for (const [value, label] of [
      [threshold - 1, 'knapp unter'],
      [threshold, 'exakt auf'],
      [threshold + 1, 'über'],
    ] as const) {
      if (value > 0 && value <= upper && !sameThreshold.has(value)) gaps.push(`${value} (${label} der Schwelle ${threshold})`);
    }
  }
  return gaps;
}

function checkInCoverageGaps<T extends AreaKey, Facts>(tracker: T, truthRows: readonly CheckInTruthRow<T, Facts>[]): string[] {
  const rows: readonly { moment: CheckInMoment; expected: { reason: CheckInReason } }[] = truthRows;
  const has =(moment: CheckInMoment, matches: (reason: CheckInReason) => boolean) =>
    rows.some((row) => row.moment === moment && matches(row.expected.reason));
  const gaps: string[] = [];
  const require = (label: string, moment: CheckInMoment, matches: (reason: CheckInReason) => boolean) => {
    if (!has(moment, matches)) gaps.push(`${moment}: ${label}`);
  };
  switch (tracker) {
    case 'ernaehrung':
      for (const [moment, threshold] of [
        ['mittag', 1],
        ['abend', 2],
      ] as const) {
        for (const count of [threshold - 1, threshold]) {
          require(`${count} Mahlzeiten`, moment, (r) => r.type === 'ernaehrung' && r.recordedMealCategories === count);
        }
      }
      break;
    case 'wasser': {
      const targets = new Set(rows.flatMap((r) => (r.expected.reason.type === 'wasser' ? [r.expected.reason.targetMl] : [])));
      for (const [moment, thirds] of [
        ['mittag', 1],
        ['abend', 2],
      ] as const) {
        const covered = [...targets].some((target) => {
          const boundary = Math.ceil((target * thirds) / 3);
          return [boundary - 1, boundary].every((ml) =>
            has(moment, (r) => r.type === 'wasser' && r.targetMl === target && r.countedMl === ml),
          );
        });
        if (!covered) gaps.push(`${moment}: knapp unter und exakt auf ${thirds}/3 des Wasserziels`);
      }
      break;
    }
    case 'sport':
      require('Sporttag ohne Eintrag', 'mittag', (r) => r.type === 'sport' && r.sportDay && !r.hasCountingEntry);
      require('Sporttag ohne Eintrag', 'abend', (r) => r.type === 'sport' && r.sportDay && !r.hasCountingEntry);
      require('Sporttag mit Eintrag', 'abend', (r) => r.type === 'sport' && r.sportDay && r.hasCountingEntry);
      require('kein Sporttag ohne Eintrag', 'abend', (r) => r.type === 'sport' && !r.sportDay && !r.hasCountingEntry);
      break;
    case 'gewicht':
      for (const moment of ['mittag', 'abend'] as const) {
        require('Wiegetag ohne Eintrag', moment, (r) => r.type === 'gewicht' && r.weighDay && !r.hasCountingEntry);
      }
      require('Wiegetag mit Eintrag', 'abend', (r) => r.type === 'gewicht' && r.weighDay && r.hasCountingEntry);
      require('kein Wiegetag ohne Eintrag', 'abend', (r) => r.type === 'gewicht' && !r.weighDay && !r.hasCountingEntry);
      break;
  }
  return gaps;
}

function measureOf(progress: DailyGoalProgress): number {
  switch (progress.type) {
    case 'ernaehrung_erfasst':
      return progress.recordedMealCategories;
    case 'im_kalorienbudget':
      return progress.intakeKcal;
    case 'wasserziel':
      return progress.countedMl;
    case 'sporteinheit':
      return progress.longestSessionMinutes;
    case 'gewogen':
      return progress.weightEntryCount;
  }
}

function thresholdOf(progress: DailyGoalProgress): number {
  switch (progress.type) {
    case 'ernaehrung_erfasst':
      return progress.minimumMealCategories;
    case 'wasserziel':
      return progress.targetMl;
    case 'sporteinheit':
      return progress.minimumSingleSessionMinutes;
    case 'im_kalorienbudget':
    case 'gewogen':
      return 1;
  }
}

const intakeOf = (progress: DailyGoalProgress) => measureOf(progress);

function budgetBounds(progress: DailyGoalProgress): { budgetKcal: number; lowerBoundKcal: number } {
  if (progress.type !== 'im_kalorienbudget') fail(`Fortschritt ${progress.type} in der Tabelle des Kalorienbudgets`);
  return { budgetKcal: progress.budgetKcal, lowerBoundKcal: progress.lowerBoundKcal };
}

function distinct<T>(values: readonly T[]): T[] {
  return values.filter((value, index) => values.findIndex((other) => sameJson(other, value)) === index);
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function instantAt(epochMilliseconds: number): Instant {
  return Instant.parse(new Date(epochMilliseconds).toISOString());
}

/** Strukturgleichheit unabhängig von der Reihenfolge der Schlüssel. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return (
    keysA.length === keysB.length &&
    keysA.every((key) => Object.hasOwn(b, key) && deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
  );
}

/** Tiefe, eingefrorene Kopie: Ein Evaluator, der seine Eingaben verändert, wirft dann im Strict Mode. */
function frozenCopy<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  const copy: Record<string, unknown> | unknown[] = Array.isArray(value) ? [] : {};
  for (const [key, entry] of Object.entries(value)) (copy as Record<string, unknown>)[key] = frozenCopy(entry);
  // Eingefrorene Objekte ignorieren Schreibversuche außerhalb des Strict Mode still; der Proxy wirft immer.
  const refuse = (): never => {
    throw new TypeError('Ein Evaluator verändert seine Eingaben');
  };
  return new Proxy(Object.freeze(copy), { set: refuse, defineProperty: refuse, deleteProperty: refuse }) as T;
}

function fail(message: string): never {
  throw new Error(message);
}
