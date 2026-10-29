import type { OnboardingStepKey } from '@abnehm/contracts/onboarding';

import { onboardingStepTitles } from '../shell/texts';

// Die elf Schritte des Onboardings (Spezifikation 1, Abschnitt 9). Die Schritte 1–8 liefert dieser
// Bereich, 9–11 sind die Steckplätze der Onboarding-Registry (Spezifikation 0, Abschnitt 6) in
// derselben Reihenfolge wie dort.

export const onboardingFlowSteps = [
  'willkommen',
  'konto',
  'koerperdaten',
  'sicherheits_check',
  'aktivitaetsstufe',
  'zielgewicht',
  'ergebnis',
  'wochenplan',
  'health',
  'notifications',
  'partner',
] as const satisfies readonly (string | OnboardingStepKey)[];

export type OnboardingFlowStep = (typeof onboardingFlowSteps)[number];

const ownTitles: Record<Exclude<OnboardingFlowStep, OnboardingStepKey>, string> = {
  willkommen: 'Willkommen',
  konto: 'Konto',
  koerperdaten: 'Körperdaten',
  sicherheits_check: 'Sicherheits-Check',
  aktivitaetsstufe: 'Aktivitätsstufe',
  zielgewicht: 'Zielgewicht und Tempo',
  ergebnis: 'Ergebnis',
  wochenplan: 'Wochenplan',
};

/** Titel eines Schritts; die der Steckplätze kommen aus der Shell. */
export const stepTitles: Record<OnboardingFlowStep, string> = { ...ownTitles, ...onboardingStepTitles };

/** Nummer des Schritts, 1 bis 11. */
export function stepNumber(step: OnboardingFlowStep): number {
  return onboardingFlowSteps.indexOf(step) + 1;
}

export const stepCount = onboardingFlowSteps.length;
