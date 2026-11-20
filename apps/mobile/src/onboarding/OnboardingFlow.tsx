import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { OnboardingStepKey } from '@abnehm/contracts/onboarding';

import { Notice, Skeleton, space, Text } from '../design';
import { OnboardingStep } from '../shell/OnboardingStep';
import { ScreenFrame } from '../shell/ScreenFrame';
import { shellTexts, titleOf } from '../shell/texts';
import { ActivityLevelStep } from './ActivityLevelStep';
import { BodyDataStep } from './BodyDataStep';
import { GoalWeightStep } from './GoalWeightStep';
import type { OnboardingPosition } from './onboarding';
import { useOnboarding, useOnboardingProgress } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { ResultStep } from './ResultStep';
import { SafetyCheckStep } from './SafetyCheckStep';
import { stepTitles } from './steps';
import { onboardingTexts } from './texts';
import { UnderageStep } from './UnderageStep';
import { WeeklyPlanStep } from './WeeklyPlanStep';
import { WelcomeStep } from './WelcomeStep';

/**
 * Ablauf der Route `onboarding` (Zustand `onboarding` der Sitzungs-Weiche): Das Konto besteht, die Person
 * ist auf dem Gerät. Bis der erste vollständige Pull angekommen ist, zeigt er einen Ladezustand; erst dann
 * steht fest, wo er beginnt (Spezifikation 1, Abschnitt 9). Fehlt die Bestätigung des Hinweises, etwa nach
 * einer Anmeldung, beginnt er bei Schritt 1; Schritt 2 entfällt mit Konto. Sonst setzt er dort fort, wo das
 * Onboarding-Modul es bestimmt (`resume`), und führt über die Schritte 3–8 und die Steckplätze 9–11 zum
 * Abschluss. Danach öffnet die Weiche „Heute“.
 */
export function OnboardingFlow() {
  const onboarding = useOnboarding();
  const progress = useOnboardingProgress();
  const [confirmed, setConfirmed] = useState(false);

  if (progress.type === 'laedt') return <Loading />;
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

/** Ladezustand statt eines Onboardings, bis der erste vollständige Pull angekommen ist. */
function Loading() {
  return (
    <ScreenFrame title={titleOf({ type: 'onboarding' })} presentation="flow">
      <View style={styles.loading} accessible accessibilityLabel={onboardingTexts.loading}>
        <Text>{onboardingTexts.loading}</Text>
        <Skeleton height={20} />
        <Skeleton height={20} width="60%" />
      </View>
    </ScreenFrame>
  );
}

/**
 * Schritte 3–11 samt Sperrbildschirm. Wo sie beginnen, bestimmt das Onboarding-Modul einmal beim Öffnen;
 * jeden weiteren Schritt merkt es sich als Gerätezustand. Jeder Schritt liest beim Öffnen den Entwurf,
 * „Zurück“ behält also alle Eingaben.
 */
function PlanSteps() {
  const onboarding = useOnboarding();
  const [position, setPosition] = useState<OnboardingPosition>(() => onboarding.resume());

  function go(next: OnboardingPosition) {
    // Der Sperrbildschirm ergibt sich beim Fortsetzen aus dem Geburtsdatum im Entwurf.
    if (next !== 'minderjaehrig') onboarding.enterStep(next);
    setPosition(next);
  }

  switch (position) {
    case 'koerperdaten':
      return <BodyDataStep onNext={() => go('sicherheits_check')} onUnderage={() => go('minderjaehrig')} />;
    case 'minderjaehrig':
      return <UnderageStep onCorrectDate={() => go('koerperdaten')} />;
    case 'sicherheits_check':
      return <SafetyCheckStep onBack={() => go('koerperdaten')} onNext={() => go('aktivitaetsstufe')} />;
    case 'aktivitaetsstufe':
      return <ActivityLevelStep onBack={() => go('sicherheits_check')} onNext={() => go('zielgewicht')} />;
    case 'zielgewicht':
      return <GoalWeightStep onBack={() => go('aktivitaetsstufe')} onNext={() => go('ergebnis')} />;
    case 'ergebnis':
      return <ResultStep onBack={() => go('zielgewicht')} onNext={() => go('wochenplan')} />;
    case 'wochenplan':
      return <WeeklyPlanStep onBack={() => go('ergebnis')} onSaved={() => go('health')} />;
    case 'health':
      // Auf einem zweiten Gerät gibt es keinen Entwurf, in den „Zurück“ führen könnte.
      return <SlotStep step="health" onBack={onboarding.hasConfirmedDraft() ? () => go('wochenplan') : undefined} onDone={() => go('notifications')} />;
    case 'notifications':
      return <SlotStep step="notifications" onBack={() => go('health')} onDone={() => go('partner')} />;
    case 'partner':
      return <LastStep onBack={() => go('notifications')} />;
  }
}

type SlotStepProps = Readonly<{
  step: OnboardingStepKey;
  onBack: (() => void) | undefined;
  /** Erledigt oder übersprungen: Das Ergebnis dient nur zum Weitergehen und wird nicht gespeichert. */
  onDone: () => void;
  /** Hinweis über dem Beitrag, etwa nach einem gescheiterten Abschluss. */
  notice?: string;
}>;

/**
 * Steckplatz 9, 10 oder 11 im Rahmen mit „Überspringen“ (Spezifikation 0, Abschnitt 6): Der Beitrag aus
 * der Onboarding-Registry zeichnet Inhalt und Hauptaktion; fehlt er, steht dort ihr Platzhalter.
 */
function SlotStep({ step, onBack, onDone, notice }: SlotStepProps) {
  return (
    <OnboardingFrame step={step} title={stepTitles[step]} onBack={onBack} secondary={{ label: shellTexts.skip, onPress: onDone }}>
      {notice === undefined ? null : <Notice tone="hint" icon="info" text={notice} />}
      <OnboardingStep stepKey={step} onComplete={onDone} />
    </OnboardingFrame>
  );
}

/** Schritt 11; erledigt oder übersprungen schließt er das Onboarding ab. */
function LastStep({ onBack }: { onBack: () => void }) {
  const onboarding = useOnboarding();
  const [failed, setFailed] = useState(false);
  return (
    <SlotStep
      step="partner"
      onBack={onBack}
      onDone={() => setFailed(onboarding.complete().type === 'fehlgeschlagen')}
      notice={failed ? onboardingTexts.completionFailed : undefined}
    />
  );
}

const styles = StyleSheet.create({
  loading: { gap: space[3] },
});
