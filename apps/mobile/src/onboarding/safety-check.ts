import type { LocalDate } from '@abnehm/contracts/base';
import type { SafetyTrigger } from '@abnehm/contracts/goal-calculator';

import { previewGoals } from '../plan';
import type { OnboardingDraft } from './draft';
import { goalDraftOf } from './goals';

// Vorschau von Onboarding-Schritt 4 „Sicherheits-Check“ (Spezifikation 1, Abschnitte 3 und 9) über den
// Zielrechner: BMI aus Größe und aktuellem Gewicht und die Anlässe des erzwungenen Haltemodus. Die
// übrigen Eingaben des Rechners (Aktivitätsstufe, Ziele) wirken auf beides nicht.

export type SafetyCheck = Readonly<{
  /** BMI aus aktuellem Gewicht und Größe, ungerundet. */
  bmi: number;
  /** Leer, solange nichts den Haltemodus erzwingt; eine offene Frage zählt noch nicht. */
  triggers: readonly SafetyTrigger[];
  /** Ob beide Fragen beantwortet sind; erst dann geht es weiter. */
  answered: boolean;
}>;

/** `null`, solange der Entwurf keine vollständigen, gültigen Körperdaten aus Schritt 3 hat (`checkBodyData`). */
export function safetyCheckOf(draft: OnboardingDraft, today: LocalDate): SafetyCheck | null {
  const goals = goalDraftOf(draft, today);
  if (goals === null) return null;
  // Nur Körperdaten und Sicherheitsangaben: Ziele, die später ungültig wurden, verdecken den BMI nicht.
  const result = previewGoals({ ...goals, goalWeightG: null, manualBudgetKcal: null, waterTargetMl: null, weeklySportTargetMinutes: null }, today);
  if (result.type !== 'berechnet') return null;
  return {
    bmi: result.bmi,
    triggers: result.maintenanceReason === 'sicherheits_check' ? result.safetyTriggers : [],
    answered: draft.pregnantOrBreastfeeding !== undefined && draft.knownEatingDisorder !== undefined,
  };
}
