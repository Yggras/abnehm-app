import type { LocalDate } from '@abnehm/contracts/base';
import { ageOn, calculateGoals, type SafetyTrigger } from '@abnehm/contracts/goal-calculator';

import type { OnboardingDraft } from './draft';

// Vorschau von Onboarding-Schritt 4 „Sicherheits-Check“ (Spezifikation 1, Abschnitte 3 und 9) über den
// Zielrechner: BMI aus Größe und aktuellem Gewicht und die Anlässe des erzwungenen Haltemodus. Die
// übrigen Eingaben des Rechners (Aktivitätsstufe, Ziele) wirken auf beides nicht; bis Schritt 5–7 sie
// liefern, rechnet die Vorschau mit deren Vorauswahl.

export type SafetyCheck = Readonly<{
  /** BMI aus aktuellem Gewicht und Größe, ungerundet. */
  bmi: number;
  /** Leer, solange nichts den Haltemodus erzwingt; eine offene Frage zählt noch nicht. */
  triggers: readonly SafetyTrigger[];
  /** Ob beide Fragen beantwortet sind; erst dann geht es weiter. */
  answered: boolean;
}>;

/** `null`, solange der Entwurf keine gültigen Körperdaten aus Schritt 3 hat. */
export function safetyCheckOf(draft: OnboardingDraft, today: LocalDate): SafetyCheck | null {
  const { calculationSex, birthDate, heightCm, weightG, pregnantOrBreastfeeding, knownEatingDisorder } = draft;
  if (calculationSex === undefined || birthDate === undefined || heightCm === undefined || weightG === undefined) return null;
  const result = calculateGoals({
    calculationDate: today,
    calculationSex,
    ageYears: ageOn(birthDate, today),
    heightCm,
    weightG,
    weightTrendG: null,
    activityLevel: 'wenig_aktiv',
    pregnantOrBreastfeeding: pregnantOrBreastfeeding === true,
    knownEatingDisorder: knownEatingDisorder === true,
    goalWeightG: null,
    pace: null,
    manualBudgetKcal: null,
    waterTargetMl: null,
    weeklySportTargetMinutes: null,
  });
  if (result.type !== 'berechnet') return null;
  return {
    bmi: result.bmi,
    triggers: result.maintenanceReason === 'sicherheits_check' ? result.safetyTriggers : [],
    answered: pregnantOrBreastfeeding !== undefined && knownEatingDisorder !== undefined,
  };
}
