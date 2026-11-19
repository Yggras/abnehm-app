// Tagesziel-Registry (Spezifikation 0, Abschnitt 3): Baustein-Auswertung und Tages-Check-in. Die
// Bereiche registrieren Evaluatoren samt Bereichsreader; das Fundament reicht weiter, prüft die
// Ergebnisse und ergänzt die persistierte Tageszielerfüllung. Der Persistenzdienst legt Erfüllungen,
// Gutschriften und Tagesbonus an und meldet betroffene Tage an `onDaysChanged`. Das
// Konformitäts-Testkit liegt unter `./testing/`.
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
export { bausteinEvaluation, gradedState, isDayClosed } from './rules';
/** Lesezugriff für Spezifikation 4, die Tageszielerfüllungen konsumiert (Spezifikation 0, Abschnitt 3). */
export { completionsOfDay, latestCompletionDate } from './completion';
export {
  createDaysChangedDispatcher,
  type DaysChanged,
  type DaysChangedDispatcher,
  type DaysChangedObserver,
} from './days-changed';
export {
  createDailyGoalPersistence,
  dailyGoalCommands,
  dailyGoalCompletionEntity,
  removeUnconfirmedDayCredits,
  type DailyGoalPersistence,
  type MissingDaysHook,
} from './persistence';
