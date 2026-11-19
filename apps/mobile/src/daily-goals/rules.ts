import type { AreaKey, Instant } from '@abnehm/contracts/base';
import {
  BausteinEvaluation,
  CheckInEvaluation,
  type CheckInMoment,
  type DailyGoalProgress,
  type DailyGoalSnapshot,
  type DailyGoalState,
} from '@abnehm/contracts/daily-goals';

import type { ValidPlan } from './evaluators';

// Feste Regeln für Evaluator-Ergebnisse (Spezifikation 0, Abschnitt 3). Der Orchestrator prüft
// damit jedes Ergebnis zur Laufzeit, das Konformitäts-Testkit dieselben Regeln in den Tests der
// Bereiche. Die Zustandsregeln selbst (etwa Gewicht nie `teilweise`) stehen im Vertragsschema.

/**
 * Ob der Tag des Snapshots zum Zeitpunkt `at` abgeschlossen ist. Maßgeblich ist allein das beim
 * Erzeugen festgeschriebene `dayEndsAt`; Reisen und Zeitumstellungen verschieben es nicht.
 */
export function isDayClosed(snapshot: Pick<DailyGoalSnapshot, 'dayEndsAt'>, at: Instant): boolean {
  return Date.parse(at) >= Date.parse(snapshot.dayEndsAt);
}

/**
 * Ergebnis eines Bausteinevaluators mit der Anzeigeaussage aller Bausteine: `messageKey`
 * `tagesziel.<baustein>.<zustand>`, die Werte sind die Fortschrittsfelder ohne `type`
 * (`src/shell/daily-goal-texts.ts`).
 */
export function bausteinEvaluation(state: DailyGoalState, dayClosed: boolean, progress: DailyGoalProgress): BausteinEvaluation {
  const { type, ...values } = progress;
  return { currentState: state, dayClosed, progress, messageKey: `tagesziel.${type}.${state}`, values };
}

/** Welche Regel ein Ergebnis verletzt; ein Token für den Kontext eines `ContractError`. */
export type EvaluationIssue = 'result_shape' | 'progress_type' | 'threshold' | 'day_closed';

export type CheckedBausteinEvaluation =
  | { ok: true; evaluation: BausteinEvaluation }
  | { ok: false; issue: EvaluationIssue };

/** Prüft das Ergebnis eines Bausteinevaluators gegen Vertrag, Snapshot und Auswertungszeitpunkt. */
export function checkBausteinEvaluation(snapshot: DailyGoalSnapshot, at: Instant, value: unknown): CheckedBausteinEvaluation {
  const parsed = BausteinEvaluation.safeParse(value);
  if (!parsed.success) return { ok: false, issue: 'result_shape' };
  const evaluation = parsed.data;
  if (evaluation.progress.type !== snapshot.type) return { ok: false, issue: 'progress_type' };
  if (!thresholdsMatch(snapshot, evaluation.progress)) return { ok: false, issue: 'threshold' };
  if (evaluation.dayClosed !== isDayClosed(snapshot, at)) return { ok: false, issue: 'day_closed' };
  return { ok: true, evaluation };
}

/** Der Fortschritt nennt genau die Schwelle, die im Snapshot festgeschrieben ist. */
function thresholdsMatch(snapshot: DailyGoalSnapshot, progress: DailyGoalProgress): boolean {
  switch (snapshot.type) {
    case 'ernaehrung_erfasst':
      return progress.type === snapshot.type && progress.minimumMealCategories === snapshot.minimumMealCategories;
    case 'im_kalorienbudget':
      return (
        progress.type === snapshot.type &&
        progress.budgetKcal === snapshot.budgetKcal &&
        progress.lowerBoundKcal === snapshot.lowerBoundKcal
      );
    case 'wasserziel':
      return progress.type === snapshot.type && progress.targetMl === snapshot.targetMl;
    case 'sporteinheit':
      return progress.type === snapshot.type && progress.minimumSingleSessionMinutes === snapshot.minimumSingleSessionMinutes;
    case 'gewogen':
      return progress.type === snapshot.type;
  }
}

export type CheckedCheckInEvaluation =
  | { ok: true; evaluation: CheckInEvaluation }
  | { ok: false; issue: 'result_shape' | 'threshold' | 'plan_day' };

/**
 * Prüft das Ergebnis eines Check-in-Evaluators. Das Vertragsschema prüft, dass der Grund zum Tracker
 * gehört und `behind` den Regeln aus #37 folgt. Hier kommt der Bezug zum Plan dazu: Das Wasserziel
 * stammt aus der Zielversion, Sporttag ist ein Tag mit Sporteinheit, Wiegetag einer mit Gewogen
 * (Spezifikation 1, Abschnitt 4).
 */
export function checkCheckInEvaluation(
  tracker: AreaKey,
  context: { moment: CheckInMoment; plan: ValidPlan },
  value: unknown,
): CheckedCheckInEvaluation {
  const result = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const parsed = CheckInEvaluation.safeParse({ tracker, moment: context.moment, behind: result.behind, reason: result.reason });
  if (!parsed.success || Object.keys(result).some((key) => key !== 'behind' && key !== 'reason')) {
    return { ok: false, issue: 'result_shape' };
  }
  const { reason } = parsed.data;
  const bausteine: readonly string[] = context.plan.weeklyPlanDay.bausteine;
  switch (reason.type) {
    case 'wasser':
      if (reason.targetMl !== context.plan.goal.waterTargetMl) return { ok: false, issue: 'threshold' };
      break;
    case 'sport':
      if (reason.sportDay !== bausteine.includes('sporteinheit')) return { ok: false, issue: 'plan_day' };
      break;
    case 'gewicht':
      if (reason.weighDay !== bausteine.includes('gewogen')) return { ok: false, issue: 'plan_day' };
      break;
    case 'ernaehrung':
      break;
  }
  return { ok: true, evaluation: parsed.data };
}
