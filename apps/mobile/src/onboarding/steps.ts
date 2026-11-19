import type { OnboardingStepKey } from '@abnehm/contracts/onboarding';

import { onboardingSteps } from '../shell/onboarding-registry';
import { onboardingStepTitles } from '../shell/texts';

// Die elf Schritte des Onboardings (Spezifikation 1, Abschnitt 9). Die Schritte 1–8 liefert dieser
// Bereich, 9–11 sind die Steckplätze der Onboarding-Registry (Spezifikation 0, Abschnitt 6) in
// derselben Reihenfolge wie dort.

/** Die Schritte 1–8 dieses Bereichs. */
const ownSteps = ['willkommen', 'konto', 'koerperdaten', 'sicherheits_check', 'aktivitaetsstufe', 'zielgewicht', 'ergebnis', 'wochenplan'] as const;

export type OnboardingFlowStep = (typeof ownSteps)[number] | OnboardingStepKey;

/** Alle elf Schritte; die Reihenfolge der Steckplätze kommt aus der Registry. */
export const onboardingFlowSteps: readonly OnboardingFlowStep[] = [...ownSteps, ...onboardingSteps.map(({ key }) => key)];

/** Die Schritte, an denen das Onboarding mit Konto fortsetzen kann: ab 3, denn Schritt 1 folgt aus der Person, Schritt 2 entfällt. */
export type ResumableStep = Exclude<OnboardingFlowStep, 'willkommen' | 'konto'>;

export const resumableSteps = [...ownSteps.slice(2), ...onboardingSteps.map(({ key }) => key)] as [ResumableStep, ...ResumableStep[]];

const ownTitles: Record<(typeof ownSteps)[number], string> = {
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

/** Ob der Schritt einer der Steckplätze 9–11 ist. */
export function isSlotStep(step: OnboardingFlowStep): step is OnboardingStepKey {
  return onboardingSteps.some(({ key }) => key === step);
}

/** Nummer des Schritts, 1 bis 11. */
export function stepNumber(step: OnboardingFlowStep): number {
  return onboardingFlowSteps.indexOf(step) + 1;
}

export const stepCount = onboardingFlowSteps.length;
