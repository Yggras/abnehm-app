import { useState } from 'react';

import { Notice, Skeleton, Text } from '../design';
import { ScreenFrame } from '../shell/ScreenFrame';
import { ownerName, shellTexts, titleOf } from '../shell/texts';
import { isTestArtifact } from '../test-artifact';
import { ActivityLevelStep } from './ActivityLevelStep';
import { BodyDataStep } from './BodyDataStep';
import { GoalWeightStep } from './GoalWeightStep';
import { useOnboarding, useOnboardingProgress } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { ResultStep } from './ResultStep';
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
type FlowPosition = 'koerperdaten' | 'minderjaehrig' | 'sicherheits_check' | 'aktivitaetsstufe' | 'zielgewicht' | 'ergebnis' | 'wochenplan';

/**
 * Ablauf der Route `onboarding` (Zustand `onboarding` der Sitzungs-Weiche): Das Konto besteht, die
 * Person ist auf dem Gerät. Fehlt ihre Bestätigung des Hinweises, etwa nach einer Anmeldung, beginnt
 * der Ablauf bei Schritt 1; Schritt 2 entfällt mit Konto. Danach folgen Schritt 3 „Körperdaten“ und
 * Schritt 4 „Sicherheits-Check“ (#141) sowie die Schritte 5 „Aktivitätsstufe“, 6 „Zielgewicht und
 * Tempo“ und 7 „Ergebnis“ (#143). Ergibt das Geburtsdatum im Entwurf unter 18 Jahre, steht dort der
 * Sperrbildschirm, auch nach einem Neustart. Fortsetzen an einem späteren Schritt liefert #146.
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
        onNext={() => onboarding.acceptDisclaimer()}
      />
    );
  }
  return <PlanSteps />;
}

/**
 * Schritte 3–7 samt Sperrbildschirm und dem Platzhalter für Schritt 8. Wo sie beginnen, bestimmt das
 * Onboarding-Modul einmal beim Öffnen aus dem Entwurf: Ergibt das Geburtsdatum unter 18 Jahre, steht dort
 * die Sperre. Jeder Schritt liest beim Öffnen den Entwurf, „Zurück“ behält also alle Eingaben.
 */
function PlanSteps() {
  const onboarding = useOnboarding();
  const [position, setPosition] = useState<FlowPosition>(() =>
    onboarding.bodyData().type === 'minderjaehrig' ? 'minderjaehrig' : 'koerperdaten',
  );
  switch (position) {
    case 'koerperdaten':
      return <BodyDataStep onNext={() => setPosition('sicherheits_check')} onUnderage={() => setPosition('minderjaehrig')} />;
    case 'minderjaehrig':
      return <UnderageStep onCorrectDate={() => setPosition('koerperdaten')} />;
    case 'sicherheits_check':
      return <SafetyCheckStep onBack={() => setPosition('koerperdaten')} onNext={() => setPosition('aktivitaetsstufe')} />;
    case 'aktivitaetsstufe':
      return <ActivityLevelStep onBack={() => setPosition('sicherheits_check')} onNext={() => setPosition('zielgewicht')} />;
    case 'zielgewicht':
      return <GoalWeightStep onBack={() => setPosition('aktivitaetsstufe')} onNext={() => setPosition('ergebnis')} />;
    case 'ergebnis':
      return <ResultStep onBack={() => setPosition('zielgewicht')} onNext={() => setPosition('wochenplan')} />;
    case 'wochenplan':
      return <PendingStep step="wochenplan" onBack={() => setPosition('ergebnis')} />;
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
