// Plan-Modul (Spezifikation 1, Abschnitt 1): die einzige Schnittstelle des Bereichs Ziele & Onboarding
// nach außen. Es besitzt Zielrechner-Vorschau, Ziel- und Wochenplanversion und den `PlanReader` für
// SQLite; die Spezifikationen 3, 4 und 5 lesen gültige Ziele und Wochenplantage nur über ihn. Die
// Rechenregeln stehen im geteilten Modul `@abnehm/contracts/goal-calculator`, Nutzlasten und IDs der
// Fassungen in `@abnehm/contracts/plan`.
export {
  createPlan,
  type GoalDraft,
  type InitialPlanDraft,
  type InitialPlanResult,
  type Plan,
  type PlanDependencies,
} from './plan';
export { followDailyGoalTriggers } from './daily-goal-triggers';
export { goalVersionEntity, planCommands, weeklyPlanVersionEntity } from './plan-entities';
export { planReaderOf } from './plan-reader';
export { preselectedWeekChoice, standardWeeklyPlan, type WeekChoice, type WeekChoiceError } from './weekly-plan';
