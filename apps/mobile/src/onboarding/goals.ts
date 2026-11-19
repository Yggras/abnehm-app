import type { LocalDate } from '@abnehm/contracts/base';
import type { GoalCalculatorResult, GoalInputError } from '@abnehm/contracts/goal-calculator';
import type { ActivityLevel } from '@abnehm/contracts/person';
import type { Pace } from '@abnehm/contracts/ports';

import { previewGoals, type GoalDraft } from '../plan';
import { checkBodyData } from './body-data';
import type { OnboardingDraft } from './draft';

// Ziele im Onboarding (Spezifikation 1, Abschnitte 3 und 9): Aus dem lokalen Entwurf der Schritte 3–7
// entsteht der Entwurf des Zielrechners; alle Werte der Schritte 5–7 kommen aus dessen Vorschau
// (`previewGoals` des Plan-Moduls). Was die Person noch nicht gewählt hat, ersetzt die Vorauswahl.

/** Die niedrigste Stufe, weil die DGE bei Übergewicht und geringer Aktivität individuelle Anpassung verlangt (Abschnitt 3). */
export const preselectedActivityLevel: ActivityLevel = 'wenig_aktiv';

/**
 * „entspannt“ ist das Standard-Defizit von 500 kcal/Tag ([#14](https://github.com/Yggras/abnehm-app/issues/14));
 * dass das Onboarding es vorauswählt, legt Spezifikation 1 nicht fest (Designwert).
 */
export const preselectedPace: Pace = 'entspannt';

/**
 * Entwurf des Zielrechners aus dem Onboarding-Entwurf am heutigen Tag; `null`, solange die Körperdaten aus
 * Schritt 3 fehlen oder ungültig sind. Offene Sicherheitsfragen zählen als „nein“, offene Ziele übernehmen
 * Vorauswahl bzw. Vorschlag des Zielrechners.
 */
export function onboardingGoalDraft(draft: OnboardingDraft, today: LocalDate): GoalDraft | null {
  const body = checkBodyData(draft, today);
  if (body.type !== 'vollstaendig') return null;
  return {
    ...body.body,
    activityLevel: draft.activityLevel ?? preselectedActivityLevel,
    pregnantOrBreastfeeding: draft.pregnantOrBreastfeeding === true,
    knownEatingDisorder: draft.knownEatingDisorder === true,
    goalWeightG: draft.goalWeightG ?? null,
    pace: draft.pace ?? preselectedPace,
    manualBudgetKcal: draft.manualBudgetKcal ?? null,
    waterTargetMl: draft.waterTargetMl ?? null,
    weeklySportTargetMinutes: draft.weeklySportTargetMinutes ?? null,
  };
}

/** Vorschau des Zielrechners zum Entwurf am heutigen Tag; `null` ohne gültige Körperdaten. */
export function goalPreviewOf(draft: OnboardingDraft, today: LocalDate): GoalCalculatorResult | null {
  const goals = onboardingGoalDraft(draft, today);
  return goals === null ? null : previewGoals(goals, today);
}

/**
 * Wählbares Kalorienbudget in Schritt 7: das berechnete ohne eigenes Budget und der Bereich des Steppers;
 * `null` ohne gültige Berechnung. Der Bereich ist das erlaubte manuelle Budget des Zielrechners. Liegt das
 * berechnete Budget darüber, weil der Rechner den Gesamtumsatz im Haltemodus auf 10 kcal aufrundet (etwa
 * 2.725,2 → 2.730 kcal bei höchstens 2.720 kcal manuell), reicht der Bereich bis zu ihm: Zurück auf genau
 * diesen Wert heißt wieder „berechnet“ (Review #143).
 */
export function budgetChoiceOf(
  draft: OnboardingDraft,
  today: LocalDate,
): Readonly<{ calculatedKcal: number; range: Readonly<{ min: number; max: number; step: number }> | null }> | null {
  const result = goalPreviewOf({ ...draft, manualBudgetKcal: undefined }, today);
  if (result === null || result.type !== 'berechnet') return null;
  const range = result.manualBudgetRange;
  const calculatedKcal = result.calorieBudget.kcal;
  return { calculatedKcal, range: range === null ? null : { ...range, max: Math.max(range.max, calculatedKcal) } };
}

/**
 * Ob ein eigenes Budget aus Schritt 7 im Entwurf noch gilt: solange der Zielrechner es annimmt, also im
 * erlaubten Bereich und ohne erzwungenen Haltemodus. Sonst gilt wieder das berechnete Budget (Designwert),
 * statt dass ein Wert außerhalb des neuen Bereichs die Berechnung sperrt.
 */
export function keepsManualBudget(draft: OnboardingDraft, today: LocalDate): boolean {
  if (draft.manualBudgetKcal === undefined) return true;
  const result = goalPreviewOf(draft, today);
  return result !== null && (result.type === 'berechnet' || !result.errors.some((error) => manualBudgetErrors.has(error)));
}

const manualBudgetErrors: ReadonlySet<GoalInputError> = new Set(['manual_budget_out_of_range', 'manual_budget_not_on_step', 'manual_budget_in_forced_maintenance']);
