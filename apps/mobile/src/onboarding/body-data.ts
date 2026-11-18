import type { LocalDate } from '@abnehm/contracts/base';
import { ageOn, bodyDataErrors, bodyInputLimits, type BodyDataError } from '@abnehm/contracts/goal-calculator';
import type { CalculationSex } from '@abnehm/contracts/person';

import type { OnboardingDraft } from './draft';

// Prüfung von Onboarding-Schritt 3 „Körperdaten“ (Spezifikation 1, Abschnitte 3 und 9) über dem
// Entwurf: Pflichtangaben, die Eingabegrenzen des Zielrechners und das Alter am heutigen Tag.

/** Fehlende Angabe oder verletzte Grenze; das Alter unter 18 meldet `minderjaehrig` eigens. */
export type BodyDataProblem =
  | 'calculation_sex_missing'
  | 'birth_date_missing'
  | 'height_missing'
  | 'weight_missing'
  | Exclude<BodyDataError, 'underage'>;

/** Die Probleme, die ein Eingabefeld von Schritt 3 anzeigt. */
export const bodyFieldProblems = {
  height: ['height_missing', 'height_out_of_range', 'height_not_on_step'],
  weight: ['weight_missing', 'weight_out_of_range', 'weight_not_on_step'],
} as const satisfies Record<string, readonly BodyDataProblem[]>;

export type BodyData = Readonly<{ calculationSex: CalculationSex; birthDate: LocalDate; heightCm: number; weightG: number }>;

export type BodyDataCheck =
  | Readonly<{ type: 'vollstaendig'; body: BodyData }>
  /** Unter 18 Jahren am heutigen Tag; geht allen anderen Problemen vor. */
  | Readonly<{ type: 'minderjaehrig' }>
  | Readonly<{ type: 'ungueltig'; errors: BodyDataProblem[] }>;

/** Ob ein eingegebenes Geburtsdatum heute unter 18 Jahre ergibt; ein 18. Geburtstag heute ist volljährig. */
function isUnderage(birthDate: LocalDate, today: LocalDate): boolean {
  return ageOn(birthDate, today) < bodyInputLimits.minimumAgeYears;
}

/** Prüft die Körperdaten des Entwurfs am heutigen lokalen Tag. */
export function checkBodyData(draft: OnboardingDraft, today: LocalDate): BodyDataCheck {
  const { calculationSex, birthDate, heightCm, weightG } = draft;
  if (birthDate !== undefined && isUnderage(birthDate, today)) return { type: 'minderjaehrig' };
  const errors: BodyDataProblem[] = [
    ...(calculationSex === undefined ? ['calculation_sex_missing' as const] : []),
    ...(birthDate === undefined ? ['birth_date_missing' as const] : []),
    ...(heightCm === undefined ? ['height_missing' as const] : []),
    ...(weightG === undefined ? ['weight_missing' as const] : []),
  ];
  if (calculationSex === undefined || birthDate === undefined || heightCm === undefined || weightG === undefined) {
    return { type: 'ungueltig', errors };
  }
  const limitErrors = bodyDataErrors({ heightCm, weightG, ageYears: ageOn(birthDate, today) }).filter(
    (error): error is Exclude<BodyDataError, 'underage'> => error !== 'underage',
  );
  if (limitErrors.length > 0) return { type: 'ungueltig', errors: limitErrors };
  return { type: 'vollstaendig', body: { calculationSex, birthDate, heightCm, weightG } };
}
