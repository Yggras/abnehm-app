import type { LocalDate } from '@abnehm/contracts/base';
import type { GoalCalculatorResult } from '@abnehm/contracts/goal-calculator';
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

/** „entspannt“ ist das Standard-Defizit von 500 kcal/Tag ([#14](https://github.com/Yggras/abnehm-app/issues/14)). */
export const preselectedPace: Pace = 'entspannt';

/**
 * Entwurf des Zielrechners aus dem Onboarding-Entwurf am heutigen Tag; `null`, solange die Körperdaten aus
 * Schritt 3 fehlen oder ungültig sind. Offene Sicherheitsfragen zählen als „nein“, offene Ziele übernehmen
 * Vorauswahl bzw. Vorschlag des Zielrechners.
 */
export function goalDraftOf(draft: OnboardingDraft, today: LocalDate): GoalDraft | null {
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
  const goals = goalDraftOf(draft, today);
  return goals === null ? null : previewGoals(goals, today);
}

/**
 * Das berechnete Kalorienbudget ohne eigenes Budget, samt dessen erlaubtem Bereich; `null` ohne gültige
 * Berechnung. Schritt 7 kehrt damit zur Rechnung zurück.
 */
export function calculatedBudgetOf(draft: OnboardingDraft, today: LocalDate): Readonly<{ kcal: number; range: Readonly<{ min: number; max: number }> | null }> | null {
  const result = goalPreviewOf({ ...draft, manualBudgetKcal: undefined }, today);
  if (result === null || result.type !== 'berechnet') return null;
  const range = result.manualBudgetRange;
  return { kcal: result.calorieBudget.kcal, range: range === null ? null : { min: range.min, max: range.max } };
}

/**
 * Ob ein eigenes Budget aus Schritt 7 nach einer Änderung des Entwurfs noch gilt: nur, solange Rechnung
 * und erlaubter Bereich gleich bleiben. Ändert sich etwa die Aktivitätsstufe, gilt wieder das berechnete
 * Budget (Designwert), statt dass ein Wert außerhalb des neuen Bereichs die Berechnung sperrt.
 */
export function keepsManualBudget(before: OnboardingDraft, after: OnboardingDraft, today: LocalDate): boolean {
  const was = calculatedBudgetOf(before, today);
  const is = calculatedBudgetOf(after, today);
  if (was === null || is === null) return false;
  return was.kcal === is.kcal && was.range?.min === is.range?.min && was.range?.max === is.range?.max;
}
