import { useState } from 'react';

import { Notice, Skeleton, Text } from '../design';
import { ScreenFrame } from '../shell/ScreenFrame';
import { ownerName, shellTexts, titleOf } from '../shell/texts';
import { isTestArtifact } from '../test-artifact';
import { useOnboarding, useOnboardingProgress } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { stepNumber, stepTitles, type OnboardingFlowStep } from './steps';
import { WelcomeStep } from './WelcomeStep';

export class MissingOnboardingFlowStepError extends Error {
  constructor(step: OnboardingFlowStep) {
    super(`Integrationsfehler: Onboarding-Schritt ${stepNumber(step)} „${stepTitles[step]}“ fehlt.`);
    this.name = 'MissingOnboardingFlowStepError';
  }
}

/**
 * Ablauf der Route `onboarding` (Zustand `onboarding` der Sitzungs-Weiche): Das Konto besteht, die
 * Person ist auf dem Gerät. Fehlt ihre Bestätigung des Hinweises, etwa nach einer Anmeldung, beginnt
 * der Ablauf bei Schritt 1; Schritt 2 entfällt mit Konto. Danach steht die Person bei Schritt 3.
 */
export function OnboardingFlow() {
  const onboarding = useOnboarding();
  const progress = useOnboardingProgress();
  const [confirmed, setConfirmed] = useState(false);

  // Nur für den Moment, bis das Onboarding die gerade angekommene Person gesehen hat.
  if (progress.type === 'laedt') {
    return (
      <ScreenFrame title={titleOf({ type: 'onboarding' })} presentation="flow">
        <Skeleton height={20} />
        <Skeleton height={20} width="60%" />
      </ScreenFrame>
    );
  }
  if (!progress.disclaimerAccepted) {
    return (
      <WelcomeStep
        confirmed={confirmed}
        onConfirmedChange={setConfirmed}
        onNext={() => {
          if (confirmed) onboarding.acceptDisclaimer();
        }}
      />
    );
  }
  return <PendingStep step="koerperdaten" />;
}

/** Ein Schritt, den ein späteres Ticket liefert: im Test-Artefakt ein Platzhalter, im Release ein Integrationsfehler. */
function PendingStep({ step }: { step: OnboardingFlowStep }) {
  if (!isTestArtifact()) throw new MissingOnboardingFlowStepError(step);
  return (
    <OnboardingFrame step={step} title={stepTitles[step]}>
      <Notice tone="neutral" icon="hammer" text={shellTexts.onboardingStepPlaceholder} />
      <Text variant="caption" tone="inkMuted">
        {shellTexts.placeholderOwner(ownerName('ziele'))}
      </Text>
    </OnboardingFrame>
  );
}
