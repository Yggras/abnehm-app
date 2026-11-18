// Plan-Modul (Spezifikation 1, Abschnitt 1): die einzige Schnittstelle des Bereichs Ziele & Onboarding
// nach außen. Es besitzt Zielrechner-Vorschau, Ziel- und Wochenplanversion und den `PlanReader` für
// SQLite; die Spezifikationen 3, 4 und 5 lesen gültige Ziele und Wochenplantage nur über ihn. Die
// Rechenregeln stehen im geteilten Modul `@abnehm/contracts/goal-calculator`, Nutzlasten und IDs der
// Fassungen in `@abnehm/contracts/plan`.
export {
  createPlan,
  type GoalChangeResult,
  type PlanSettings,
  type WeeklyPlanChangeResult,
  type InitialPlanDraft,
  type InitialPlanResult,
  type Plan,
  type PlanDependencies,
} from './plan';
export { appGoalSettings, appPlan, useAppPlan, useGoalSettings } from './app-plan';
export { followDailyGoalTriggers } from './daily-goal-triggers';
export type { GoalDraft } from './goal-draft';
export type { GoalSettings, GoalSettingsState, GoalVersionField, GoalVersionView } from './goal-settings';
export { goalVersionEntity, planCommands, weeklyPlanVersionEntity } from './plan-entities';
export { planReaderOf } from './plan-reader';
export type { DailyGoalEvaluator, PlanToday } from './today-contributions';
export {
  preselectedWeekChoice,
  standardWeeklyPlan,
  type WeekChoice,
  type WeekChoiceError,
  type WeeklyPlanDayError,
  type WeeklyPlanInput,
} from './weekly-plan';
