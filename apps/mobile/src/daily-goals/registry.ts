import { AreaKey, BausteinKey, EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import {
  CheckInMoment,
  DailyGoalEvaluated,
  DailyGoalSnapshot,
  type CheckInEvaluation,
  type DailyGoalEvaluation,
} from '@abnehm/contracts/daily-goals';
import type { ContractError } from '@abnehm/contracts/errors';
import { EffectivePlan } from '@abnehm/contracts/ports';

import type { ReadContext } from '../local-db';
import { readCompletion } from './completion';
import type { AnyBausteinEvaluator, AnyCheckInEvaluator, CheckInContext, DayFactsReader, ValidPlan } from './evaluators';
import { checkBausteinEvaluation, checkCheckInEvaluation } from './rules';

/** Eingabe von `evaluateCheckIn`; Zielversion und Wochenplantag kommen vom Aufrufer (`PlanReader`). */
export type CheckInInput = {
  tracker: AreaKey;
  personId: EntityId;
  localDate: LocalDate;
  moment: CheckInMoment;
  plan: ValidPlan;
};

/** Ergebnis von `evaluateCheckIn`: Vertragsfehler oder `behind` mit genau einem Grund. */
export type CheckInResult = ({ type: 'evaluated' } & CheckInEvaluation) | { type: 'contract_error'; error: ContractError };

/** Baustein-Auswertung und Tages-Check-in (Spezifikation 0, Abschnitt 3). */
export type DailyGoalRegistry = {
  /**
   * Wertet ein Tagesziel aus. `tx` ist der Reader-Port: die laufende Lese- oder Schreibtransaktion,
   * in der der Bereichsreader seine Fakten liest. Zum Ergebnis des Bereichs ergänzt das Fundament
   * die persistierte Tageszielerfüllung als `completion`. Fehlt der Evaluator oder verletzt ein
   * Ergebnis den Vertrag, ist das Ergebnis ein `contract_error`, keine Ausnahme.
   */
  evaluateDailyGoal(tx: ReadContext, snapshot: DailyGoalSnapshot, at: Instant): DailyGoalEvaluation;
  /** Wertet einen Tages-Check-in aus, unabhängig davon, ob der Tracker auf einem Momo-Platz liegt. */
  evaluateCheckIn(tx: ReadContext, input: CheckInInput): CheckInResult;
};

export type DailyGoalRegistrations = {
  bausteine: readonly AnyBausteinEvaluator[];
  checkIns: readonly AnyCheckInEvaluator[];
};

// Nach dem Nachschlagen per Schlüssel passt der Snapshot bzw. Tracker zum Evaluator; die Registry
// hält ihn deshalb ohne Schlüsseltyp. Seine Fakten reicht sie unverändert von `readFacts` weiter.
type RegisteredBaustein = {
  readFacts: DayFactsReader<unknown>;
  evaluate(snapshot: DailyGoalSnapshot, at: Instant, facts: unknown): unknown;
};
type RegisteredCheckIn = { readFacts: DayFactsReader<unknown>; evaluate(context: CheckInContext, facts: unknown): unknown };

/**
 * Baut die Registry aus den Evaluatoren der Bereiche. Doppelte oder unbekannte Schlüssel sind ein
 * Fehler der Zusammensetzung und werfen sofort; fehlende Evaluatoren zeigen sich erst bei der
 * Auswertung als `contract_error`, damit Bereiche parallel entstehen können.
 */
export function createDailyGoalRegistry({ bausteine, checkIns }: DailyGoalRegistrations): DailyGoalRegistry {
  const bausteinEvaluators = indexBy(bausteine, (evaluator) => BausteinKey.parse(evaluator.baustein), 'Baustein') as unknown as ReadonlyMap<
    BausteinKey,
    RegisteredBaustein
  >;
  const checkInEvaluators = indexBy(checkIns, (evaluator) => checkInTracker(evaluator.tracker), 'Tracker') as unknown as ReadonlyMap<
    AreaKey,
    RegisteredCheckIn
  >;

  return {
    evaluateDailyGoal(tx, snapshotInput, at) {
      const snapshot = DailyGoalSnapshot.safeParse(snapshotInput);
      if (!snapshot.success) return contractError('invalid_snapshot', {});
      const baustein = snapshot.data.type;
      const evaluator = bausteinEvaluators.get(baustein);
      if (evaluator === undefined) return contractError('unknown_catalog_key', { baustein });

      const facts = evaluator.readFacts(tx, snapshot.data.personId, snapshot.data.localDate);
      const checked = checkBausteinEvaluation(snapshot.data, at, evaluator.evaluate(snapshot.data, at, facts));
      if (!checked.ok) return contractError('invalid_payload', { baustein, issue: checked.issue });

      const evaluated = DailyGoalEvaluated.safeParse({
        type: 'evaluated',
        ...checked.evaluation,
        completion: readCompletion(tx, snapshot.data),
      });
      if (!evaluated.success) return contractError('invalid_payload', { baustein, issue: 'completion' });
      return evaluated.data;
    },

    evaluateCheckIn(tx, input) {
      const tracker = AreaKey.safeParse(input.tracker);
      const plan = EffectivePlan.safeParse(input.plan);
      if (
        !tracker.success ||
        !CheckInMoment.safeParse(input.moment).success ||
        !EntityId.safeParse(input.personId).success ||
        !plan.success ||
        plan.data.type !== 'gueltig' ||
        plan.data.localDate !== input.localDate
      ) {
        return contractError('invalid_payload', {});
      }
      const evaluator = checkInEvaluators.get(tracker.data);
      if (evaluator === undefined) return contractError('unknown_catalog_key', { tracker: tracker.data });

      const context = { moment: input.moment, plan: plan.data };
      const facts = evaluator.readFacts(tx, input.personId, plan.data.localDate);
      const checked = checkCheckInEvaluation(tracker.data, context, evaluator.evaluate(context, facts));
      if (!checked.ok) return contractError('invalid_payload', { tracker: tracker.data, issue: checked.issue });
      return { type: 'evaluated', ...checked.evaluation };
    },
  };
}

/** Das Kalorienbudget ist ein Baustein, aber kein Check-in-Tracker. */
function checkInTracker(tracker: unknown): AreaKey {
  const parsed = AreaKey.safeParse(tracker);
  if (!parsed.success) throw new TypeError(`Kein Check-in-Tracker: ${String(tracker)}`);
  return parsed.data;
}

function indexBy<T, K>(entries: readonly T[], keyOf: (entry: T) => K, label: string): ReadonlyMap<K, T> {
  const index = new Map<K, T>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (index.has(key)) throw new Error(`${label} doppelt registriert: ${String(key)}`);
    index.set(key, entry);
  }
  return index;
}

function contractError(code: ContractError['code'], context: Record<string, string>): { type: 'contract_error'; error: ContractError } {
  return {
    type: 'contract_error',
    error: Object.keys(context).length === 0 ? { code, retryable: false } : { code, context, retryable: false },
  };
}
