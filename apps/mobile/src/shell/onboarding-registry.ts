import { createElement, type ComponentType, type ReactElement } from 'react';
import type { z } from 'zod';

import type { onboardingStepOutcomes, OnboardingStepKey } from '@abnehm/contracts/onboarding';

import type { Owner } from '../navigation';

// Onboarding-Registry der Shell (Spezifikation 0, Abschnitt 6): Die Schritte 9–11 des Onboardings
// gehören anderen Bereichen und sind Steckplätze nach dem Muster von „Heute“. Spezifikation 1 besitzt
// den Ablauf und zeichnet Rahmen, Fortschritt und „Überspringen“; ein Beitrag zeichnet Inhalt und
// Hauptaktion und meldet nur `complete(outcome)`.

/** Die Reihenfolge gehört der Shell, nicht der Reihenfolge der Registrierung. */
export const onboardingSteps = [
  { key: 'health', step: 9, owner: 'tracker' },
  { key: 'notifications', step: 10, owner: 'partner' },
  { key: 'partner', step: 11, owner: 'partner' },
] as const satisfies readonly { key: OnboardingStepKey; step: number; owner: Owner }[];

/** Die Ergebnisse, die der Schritt `K` melden darf; `skipped` gilt für alle. */
export type OnboardingStepOutcomeOf<K extends OnboardingStepKey> = z.infer<(typeof onboardingStepOutcomes)[K]>;

/** Ein Schritt-Beitrag erhält ausschließlich `complete`. */
export type OnboardingStepProps<K extends OnboardingStepKey> = Readonly<{ complete(outcome: OnboardingStepOutcomeOf<K>): void }>;

export type OnboardingStepContribution<K extends OnboardingStepKey> = ComponentType<OnboardingStepProps<K>>;

type OwnerOf<K extends OnboardingStepKey> = Extract<(typeof onboardingSteps)[number], { key: K }>['owner'];

export class MissingOnboardingStepError extends Error {
  constructor(key: OnboardingStepKey) {
    super(`Integrationsfehler: Der Beitrag zum Onboarding-Schritt „${key}“ fehlt.`);
    this.name = 'MissingOnboardingStepError';
  }
}

/** Pro Schritt genau ein Beitrag seines Bereichs. */
export function createOnboardingRegistry() {
  const contributions = new Map<OnboardingStepKey, OnboardingStepContribution<never>>();
  return {
    register<K extends OnboardingStepKey>(owner: OwnerOf<K>, key: K, contribution: OnboardingStepContribution<K>) {
      const step = onboardingSteps.find((entry) => entry.key === key);
      if (step?.owner !== owner) throw new Error(`Onboarding-Schritt „${key}“ gehört nicht „${owner}“.`);
      if (contributions.has(key)) throw new Error(`Onboarding-Schritt „${key}“ ist bereits registriert.`);
      const stored = contribution as unknown as OnboardingStepContribution<never>;
      contributions.set(key, stored);
      return () => {
        if (contributions.get(key) === stored) contributions.delete(key);
      };
    },
    /** Der Beitrag zum Schritt oder `undefined`, solange sein Bereich fehlt. */
    contribution<K extends OnboardingStepKey>(key: K): OnboardingStepContribution<K> | undefined {
      return contributions.get(key) as OnboardingStepContribution<K> | undefined;
    },
    /** Der gerenderte Beitrag mit genau diesen Props oder `null`, solange sein Bereich fehlt. */
    element<K extends OnboardingStepKey>(key: K, props: OnboardingStepProps<K>): ReactElement | null {
      const contribution = contributions.get(key) as OnboardingStepContribution<K> | undefined;
      return contribution === undefined ? null : createElement(contribution, props);
    },
  };
}

export type OnboardingRegistry = ReturnType<typeof createOnboardingRegistry>;

/** Composition Root der Onboarding-Beiträge; Bereiche registrieren ihren Schritt beim Start der App. */
export const appOnboardingRegistry = createOnboardingRegistry();
