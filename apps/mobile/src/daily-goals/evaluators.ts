import type { AreaKey, BausteinKey, EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import type {
  BausteinEvaluation,
  CheckInMoment,
  CheckInReason,
  DailyGoalProgress,
  DailyGoalSnapshot,
} from '@abnehm/contracts/daily-goals';
import type { EffectivePlan } from '@abnehm/contracts/ports';

import type { ReadContext } from '../local-db';

// Was die Bereiche registrieren (Spezifikation 0, Abschnitt 3): je Baustein bzw. Tracker einen
// Evaluator samt Bereichsreader. Die Regeln liefern die Spezifikationen 2 und 3, die Registry und
// die Prüfung der Ergebnisse das Fundament.

export type DailyGoalSnapshotOf<K extends BausteinKey> = Extract<DailyGoalSnapshot, { type: K }>;
export type DailyGoalProgressOf<K extends BausteinKey> = Extract<DailyGoalProgress, { type: K }>;
export type CheckInReasonOf<T extends AreaKey> = Extract<CheckInReason, { type: T }>;

/** Gültige Zielversion und Wochenplantag eines Tags, wie sie der `PlanReader` liefert. */
export type ValidPlan = Extract<EffectivePlan, { type: 'gueltig' }>;

/**
 * Bereichsreader: liest die Tagesfakten eines Bereichs in der laufenden Lese- oder
 * Schreibtransaktion, ausschließlich aus den Tabellen dieses Bereichs. Tageszielerfüllungen und
 * andere Tabellen des Fundaments liest er nie.
 */
export type DayFactsReader<Facts> = (tx: ReadContext, personId: EntityId, localDate: LocalDate) => Facts;

/** Auswertung eines Bausteins. Den Tag und sein Ende nimmt er nur aus dem Snapshot. */
export type BausteinEvaluator<K extends BausteinKey, Facts> = {
  readonly baustein: K;
  readonly readFacts: DayFactsReader<Facts>;
  /**
   * Aktueller Zustand, Fortschritt, Tagesende und Anzeigeaussage. Rein: Dieselben Eingaben ergeben
   * dasselbe Ergebnis; Uhr, Gerätezone und Datenbank liest der Evaluator nicht.
   */
  evaluate(snapshot: DailyGoalSnapshotOf<K>, at: Instant, facts: Facts): BausteinEvaluation;
};

/** Was ein Tages-Check-in außer den Tagesfakten bekommt. */
export type CheckInContext = { moment: CheckInMoment; plan: ValidPlan };

/**
 * Tages-Check-in eines Trackers. Er wertet auch Tage aus, an denen der Tracker auf keinem
 * Momo-Platz liegt; das Kalorienbudget ist kein Tracker.
 */
export type CheckInEvaluator<T extends AreaKey, Facts> = {
  readonly tracker: T;
  readonly readFacts: DayFactsReader<Facts>;
  /** Rein wie `BausteinEvaluator.evaluate`. */
  evaluate(context: CheckInContext, facts: Facts): { behind: boolean; reason: CheckInReasonOf<T> };
};

// Die Registry hält Evaluatoren mit verschiedenen Faktentypen. Ein Bausteinschlüssel macht den
// Typparameter invariant, deshalb ist die Liste die Vereinigung über alle Schlüssel; die Fakten
// bleiben dem jeweiligen Evaluator überlassen, der sie selbst liest.
export type AnyBausteinEvaluator = { [K in BausteinKey]: BausteinEvaluator<K, any> }[BausteinKey];
export type AnyCheckInEvaluator = { [T in AreaKey]: CheckInEvaluator<T, any> }[AreaKey];
