import { useState } from 'react';

import { useClock } from '../clock/clock-context';

import { Notice, Skeleton, Text } from '../design';
import { ScreenFrame } from '../shell/ScreenFrame';
import { ownerName, shellTexts, titleOf } from '../shell/texts';
import { isTestArtifact } from '../test-artifact';
import { checkBodyData } from './body-data';
import { BodyDataStep } from './BodyDataStep';
import { useOnboarding, useOnboardingProgress } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { SafetyCheckStep } from './SafetyCheckStep';
import { stepNumber, stepTitles, type OnboardingFlowStep } from './steps';
import { UnderageStep } from './UnderageStep';
import { WelcomeStep } from './WelcomeStep';

export class MissingOnboardingFlowStepError extends Error {
  constructor(step: OnboardingFlowStep) {
    super(`Integrationsfehler: Onboarding-Schritt ${stepNumber(step)} „${stepTitles[step]}“ fehlt.`);
    this.name = 'MissingOnboardingFlowStepError';
  }
}

/** Wo der Ablauf nach Schritt 1 steht; `minderjaehrig` ist der Sperrbildschirm in Schritt 3. */
type FlowPosition = 'koerperdaten' | 'minderjaehrig' | 'sicherheits_check' | 'aktivitaetsstufe';

/**
 * Ablauf der Route `onboarding` (Zustand `onboarding` der Sitzungs-Weiche): Das Konto besteht, die
 * Person ist auf dem Gerät. Fehlt ihre Bestätigung des Hinweises, etwa nach einer Anmeldung, beginnt
 * der Ablauf bei Schritt 1; Schritt 2 entfällt mit Konto. Danach folgen Schritt 3 „Körperdaten“ und
 * Schritt 4 „Sicherheits-Check“ (#141). Ergibt das Geburtsdatum im Entwurf unter 18 Jahre, steht dort
 * der Sperrbildschirm, auch nach einem Neustart. Fortsetzen an einem späteren Schritt liefert #146.
 */
export function OnboardingFlow() {
  const onboarding = useOnboarding();
  const progress = useOnboardingProgress();
  const clock = useClock();
  const [confirmed, setConfirmed] = useState(false);
  const [position, setPosition] = useState<FlowPosition | null>(null);

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
        onNext={() => onboarding.acceptDisclaimer()}
      />
    );
  }
  const shown =
    position ?? (checkBodyData(onboarding.readDraft(), clock.read().localDate).type === 'minderjaehrig' ? 'minderjaehrig' : 'koerperdaten');
  switch (shown) {
    case 'koerperdaten':
      return <BodyDataStep onNext={() => setPosition('sicherheits_check')} onUnderage={() => setPosition('minderjaehrig')} />;
    case 'minderjaehrig':
      return <UnderageStep onCorrectDate={() => setPosition('koerperdaten')} />;
    case 'sicherheits_check':
      return <SafetyCheckStep onBack={() => setPosition('koerperdaten')} onNext={() => setPosition('aktivitaetsstufe')} />;
    case 'aktivitaetsstufe':
      return <PendingStep step="aktivitaetsstufe" onBack={() => setPosition('sicherheits_check')} />;
  }
}

/** Ein Schritt, den ein späteres Ticket liefert: im Test-Artefakt ein Platzhalter, im Release ein Integrationsfehler. */
function PendingStep({ step, onBack }: { step: OnboardingFlowStep; onBack: () => void }) {
  if (!isTestArtifact()) throw new MissingOnboardingFlowStepError(step);
  return (
    <OnboardingFrame step={step} title={stepTitles[step]} onBack={onBack}>
      <Notice tone="neutral" icon="hammer" text={shellTexts.onboardingStepPlaceholder} />
      <Text variant="caption" tone="inkMuted">
        {shellTexts.placeholderOwner(ownerName('ziele'))}
      </Text>
    </OnboardingFrame>
  );
}
