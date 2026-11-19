import type { AreaKey, BausteinKey, EntityId, LocalDate } from '@abnehm/contracts/base';
import type { DailyGoalState } from '@abnehm/contracts/daily-goals';

import type { BausteinEvaluator, CheckInEvaluator, DayFactsReader } from '../evaluators';
import { bausteinEvaluation, isDayClosed } from '../rules';

// Test-Evaluatoren für Registry, Orchestrator und Konformitäts-Testkit. Sie folgen den Regeln aus
// Spezifikation 0, Abschnitt 3, lesen ihre Fakten aber aus einem Speicher im Test statt aus den
// Tabellen der Bereiche. Die echten Evaluatoren registrieren die Spezifikationen 2 und 3.

/** Tagesfakten aller Bereiche für die Test-Evaluatoren. */
export type TestDayFacts = {
  recordedMealCategories: number;
  intakeKcal: number;
  countedMl: number;
  /** Dauer jeder zählenden Sporteinheit des Tags in Minuten. */
  sessionMinutes: readonly number[];
  weightEntryCount: number;
};

export const noTestFacts: TestDayFacts = {
  recordedMealCategories: 0,
  intakeKcal: 0,
  countedMl: 0,
  sessionMinutes: [],
  weightEntryCount: 0,
};

/** Fakten je Person und Tag; ungesetzte Tage haben keine Einträge. */
export function createTestFactsStore(): { set(personId: EntityId, localDate: LocalDate, facts: Partial<TestDayFacts>): void; read: DayFactsReader<TestDayFacts> } {
  const days = new Map<string, TestDayFacts>();
  const key = (personId: string, localDate: string) => `${personId}:${localDate}`;
  return {
    set: (personId, localDate, facts) => days.set(key(personId, localDate), { ...noTestFacts, ...facts }),
    read: (_tx, personId, localDate) => days.get(key(personId, localDate)) ?? noTestFacts,
  };
}

const longest = (facts: TestDayFacts) => Math.max(0, ...facts.sessionMinutes);

function graded(value: number, threshold: number): DailyGoalState {
  return value === 0 ? 'offen' : value < threshold ? 'teilweise' : 'erfuellt';
}

/** Je Baustein ein Test-Evaluator; `Object.values` ergibt die Liste für die Registry. */
export function testBausteinEvaluators(readFacts: DayFactsReader<TestDayFacts>): { [K in BausteinKey]: BausteinEvaluator<K, TestDayFacts> } {
  const ernaehrung: BausteinEvaluator<'ernaehrung_erfasst', TestDayFacts> = {
    baustein: 'ernaehrung_erfasst',
    readFacts,
    evaluate: (snapshot, at, facts) =>
      bausteinEvaluation(graded(facts.recordedMealCategories, snapshot.minimumMealCategories), isDayClosed(snapshot, at), {
        type: snapshot.type,
        recordedMealCategories: facts.recordedMealCategories,
        minimumMealCategories: snapshot.minimumMealCategories,
      }),
  };
  const budget: BausteinEvaluator<'im_kalorienbudget', TestDayFacts> = {
    baustein: 'im_kalorienbudget',
    readFacts,
    evaluate: (snapshot, at, facts) => {
      const dayClosed = isDayClosed(snapshot, at);
      const within = facts.intakeKcal >= snapshot.lowerBoundKcal && facts.intakeKcal <= snapshot.budgetKcal;
      return bausteinEvaluation(!dayClosed ? 'tagesende' : within ? 'erfuellt' : 'offen', dayClosed, {
        type: snapshot.type,
        intakeKcal: facts.intakeKcal,
        budgetKcal: snapshot.budgetKcal,
        lowerBoundKcal: snapshot.lowerBoundKcal,
      });
    },
  };
  const wasser: BausteinEvaluator<'wasserziel', TestDayFacts> = {
    baustein: 'wasserziel',
    readFacts,
    evaluate: (snapshot, at, facts) =>
      bausteinEvaluation(graded(facts.countedMl, snapshot.targetMl), isDayClosed(snapshot, at), {
        type: snapshot.type,
        countedMl: facts.countedMl,
        targetMl: snapshot.targetMl,
      }),
  };
  const sport: BausteinEvaluator<'sporteinheit', TestDayFacts> = {
    baustein: 'sporteinheit',
    readFacts,
    evaluate: (snapshot, at, facts) =>
      bausteinEvaluation(graded(longest(facts), snapshot.minimumSingleSessionMinutes), isDayClosed(snapshot, at), {
        type: snapshot.type,
        longestSessionMinutes: longest(facts),
        minimumSingleSessionMinutes: snapshot.minimumSingleSessionMinutes,
      }),
  };
  const gewogen: BausteinEvaluator<'gewogen', TestDayFacts> = {
    baustein: 'gewogen',
    readFacts,
    evaluate: (snapshot, at, facts) =>
      bausteinEvaluation(facts.weightEntryCount === 0 ? 'offen' : 'erfuellt', isDayClosed(snapshot, at), {
        type: snapshot.type,
        weightEntryCount: facts.weightEntryCount,
      }),
  };
  return { ernaehrung_erfasst: ernaehrung, im_kalorienbudget: budget, wasserziel: wasser, sporteinheit: sport, gewogen };
}

/** Je Tracker ein Test-Check-in; `Object.values` ergibt die Liste für die Registry. */
export function testCheckInEvaluators(readFacts: DayFactsReader<TestDayFacts>): { [T in AreaKey]: CheckInEvaluator<T, TestDayFacts> } {
  const ernaehrung: CheckInEvaluator<'ernaehrung', TestDayFacts> = {
    tracker: 'ernaehrung',
    readFacts,
    evaluate: ({ moment }, facts) => ({
      behind: facts.recordedMealCategories < (moment === 'mittag' ? 1 : 2),
      reason: { type: 'ernaehrung', recordedMealCategories: facts.recordedMealCategories },
    }),
  };
  const wasser: CheckInEvaluator<'wasser', TestDayFacts> = {
    tracker: 'wasser',
    readFacts,
    evaluate: ({ moment, plan }, facts) => ({
      behind: facts.countedMl * 3 < plan.goal.waterTargetMl * (moment === 'mittag' ? 1 : 2),
      reason: { type: 'wasser', countedMl: facts.countedMl, targetMl: plan.goal.waterTargetMl },
    }),
  };
  const sport: CheckInEvaluator<'sport', TestDayFacts> = {
    tracker: 'sport',
    readFacts,
    evaluate: ({ moment, plan }, facts) => {
      const sportDay = plan.weeklyPlanDay.bausteine.includes('sporteinheit');
      const hasCountingEntry = facts.sessionMinutes.length > 0;
      return {
        behind: moment === 'abend' && sportDay && !hasCountingEntry,
        reason: { type: 'sport', sportDay, hasCountingEntry, messageKey: 'checkin.sport.schon_trainiert' },
      };
    },
  };
  const gewicht: CheckInEvaluator<'gewicht', TestDayFacts> = {
    tracker: 'gewicht',
    readFacts,
    evaluate: ({ plan }, facts) => {
      const weighDay = plan.weeklyPlanDay.bausteine.includes('gewogen');
      const hasCountingEntry = facts.weightEntryCount > 0;
      return { behind: weighDay && !hasCountingEntry, reason: { type: 'gewicht', weighDay, hasCountingEntry } };
    },
  };
  return { ernaehrung, wasser, sport, gewicht };
}
