import { useCallback } from 'react';
import { View } from 'react-native';

import { onboardingStepOutcomes, type OnboardingStepKey, type OnboardingStepOutcome } from '@abnehm/contracts/onboarding';

import { Notice, space, Text } from '../design';
import { isTestArtifact } from '../test-artifact';
import {
  appOnboardingRegistry,
  MissingOnboardingStepError,
  onboardingSteps,
  type OnboardingRegistry,
  type OnboardingStepOutcomeOf,
} from './onboarding-registry';
import { ownerName, shellTexts } from './texts';

export type OnboardingStepSlotProps<K extends OnboardingStepKey> = Readonly<{
  stepKey: K;
  /** Das geprüfte Ergebnis des Schritts; Spezifikation 1 geht damit weiter und speichert es nicht. */
  onComplete(outcome: OnboardingStepOutcomeOf<K>): void;
  registry?: OnboardingRegistry;
}>;

/**
 * Steckplatz eines Onboarding-Schritts im Rahmen von Spezifikation 1. Die Shell prüft das gemeldete
 * Ergebnis am Vertragsrand: Ein Beitrag darf nur die Ergebnisse seines Schritts melden.
 */
export function OnboardingStep<K extends OnboardingStepKey>({ stepKey, onComplete, registry = appOnboardingRegistry }: OnboardingStepSlotProps<K>) {
  const complete = useCallback(
    (outcome: OnboardingStepOutcome) => onComplete(onboardingStepOutcomes[stepKey].parse(outcome) as OnboardingStepOutcomeOf<K>),
    [onComplete, stepKey],
  );
  return registry.element(stepKey, { complete }) ?? <MissingStep stepKey={stepKey} />;
}

/**
 * Development- und E2E-Build: deutscher Platzhalter mit dem liefernden Bereich. Wie ein Beitrag zeichnet er
 * nur den Inhalt; Titel und „Überspringen“ zeichnet der Rahmen von Spezifikation 1, also bleibt der Schritt
 * überspringbar. Eine Hauptaktion hat er nicht. Im Release ist ein fehlender Beitrag ein Integrationsfehler
 * (Spezifikation 0, Abschnitt 6).
 */
function MissingStep({ stepKey }: { stepKey: OnboardingStepKey }) {
  if (!isTestArtifact()) throw new MissingOnboardingStepError(stepKey);
  const step = onboardingSteps.find((entry) => entry.key === stepKey)!;
  return (
    <View style={{ gap: space[4] }}>
      <Notice tone="neutral" icon="hammer" text={shellTexts.onboardingStepPlaceholder} />
      <Text variant="caption" tone="inkMuted">
        {shellTexts.placeholderOwner(ownerName(step.owner))}
      </Text>
    </View>
  );
}
