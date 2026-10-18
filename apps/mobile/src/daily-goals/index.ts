// Tagesziel-Registry (Spezifikation 0, Abschnitt 3): Baustein-Auswertung und Tages-Check-in. Die
// Bereiche registrieren Evaluatoren samt Bereichsreader; das Fundament reicht weiter, prüft die
// Ergebnisse und ergänzt die persistierte Tageszielerfüllung. Das Konformitäts-Testkit liegt unter
// `./testing/`.
export type {
  AnyBausteinEvaluator,
  AnyCheckInEvaluator,
  BausteinEvaluator,
  CheckInContext,
  CheckInEvaluator,
  CheckInReasonOf,
  DailyGoalProgressOf,
  DailyGoalSnapshotOf,
  DayFactsReader,
  ValidPlan,
} from './evaluators';
export {
  createDailyGoalRegistry,
  type CheckInInput,
  type CheckInResult,
  type DailyGoalRegistrations,
  type DailyGoalRegistry,
} from './registry';
export { isDayClosed } from './rules';
