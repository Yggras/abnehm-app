import { LocalDate } from '@abnehm/contracts/base';
import { ageOn, type GoalCalculatorInput } from '@abnehm/contracts/goal-calculator';
import { ActivityLevel, CalculationSex } from '@abnehm/contracts/person';
import type { Pace } from '@abnehm/contracts/ports';

import type { GoalVersionValues } from './plan-repository';

/**
 * Eingaben des Zielrechners: im Onboarding aus den Schritten 3–7, in den Einstellungen die bisherigen
 * Werte samt Änderung. `null` übernimmt jeweils den Vorschlag des Zielrechners.
 */
export type GoalDraft = Readonly<{
  calculationSex: CalculationSex;
  birthDate: LocalDate;
  heightCm: number;
  /** Aktuelles Gewicht; im Onboarding aus Schritt 3 und zugleich das Startgewicht. */
  weightG: number;
  activityLevel: ActivityLevel;
  pregnantOrBreastfeeding: boolean;
  knownEatingDisorder: boolean;
  goalWeightG: number | null;
  /** `null` wählt den Haltemodus. */
  pace: Pace | null;
  manualBudgetKcal: number | null;
  waterTargetMl: number | null;
  weeklySportTargetMinutes: number | null;
}>;

/**
 * Eingabe des Zielrechners zu einem Entwurf am Berechnungstag. `weightTrendG` ist das Basisgewicht der
 * Prognose; die Zielversion speichert keine Prognose, beim Speichern ist es daher `null`.
 */
export function calculatorInput(draft: GoalDraft, calculationDate: LocalDate, weightTrendG: number | null = null): GoalCalculatorInput {
  return {
    calculationDate,
    calculationSex: draft.calculationSex,
    ageYears: ageOn(draft.birthDate, calculationDate),
    heightCm: draft.heightCm,
    weightG: draft.weightG,
    weightTrendG,
    activityLevel: draft.activityLevel,
    pregnantOrBreastfeeding: draft.pregnantOrBreastfeeding,
    knownEatingDisorder: draft.knownEatingDisorder,
    goalWeightG: draft.goalWeightG,
    pace: draft.pace,
    manualBudgetKcal: draft.manualBudgetKcal,
    waterTargetMl: draft.waterTargetMl,
    weeklySportTargetMinutes: draft.weeklySportTargetMinutes,
  };
}

/** Was „Ziele ändern“ von der eigenen Person braucht: Geburtsdatum und Sicherheitsangaben. */
export type PersonGoalFields = Readonly<{
  birthDate: string | null;
  pregnantOrBreastfeeding: boolean | null;
  knownEatingDisorder: boolean | null;
}>;

/**
 * Ausgangsentwurf für „Ziele ändern“ (Spezifikation 1, Abschnitt 10): die Werte einer Zielversion samt
 * Geburtsdatum und Sicherheitsangaben der Person. Körperdaten und Aktivitätsstufe sind die der Berechnung
 * dieser Fassung; sie ändert erst der Bereich „Körperdaten & Neuberechnung“ (#148). Ein Budget, das die
 * Person oder ein angenommener Budgetvorschlag gesetzt hat, bleibt als manuelles Budget erhalten. Ohne
 * Geburtsdatum gibt es keinen Entwurf.
 */
export function goalDraftOf(version: GoalVersionValues, person: PersonGoalFields): GoalDraft | null {
  if (person.birthDate === null) return null;
  return {
    calculationSex: version.calculationSex,
    birthDate: LocalDate.parse(person.birthDate),
    heightCm: version.heightCm,
    weightG: version.weightG,
    activityLevel: version.activityLevel,
    pregnantOrBreastfeeding: person.pregnantOrBreastfeeding ?? false,
    knownEatingDisorder: person.knownEatingDisorder ?? false,
    goalWeightG: version.goalWeightG,
    pace: version.pace,
    manualBudgetKcal: version.budgetSource === 'berechnet' ? null : version.calorieBudgetMilliKcal / 1_000,
    waterTargetMl: version.waterTargetMl,
    weeklySportTargetMinutes: version.weeklySportTargetMinutes,
  };
}
