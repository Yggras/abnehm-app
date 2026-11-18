import { Text } from '../design';
import { LogoutArea } from '../settings';
import { OnboardingFrame } from './OnboardingFrame';
import { underageTexts as texts } from './texts';

export type UnderageStepProps = {
  /** Zurück zu Schritt 3, um das Geburtsdatum zu korrigieren. */
  onCorrectDate: () => void;
};

/**
 * Sperrbildschirm unter 18 Jahren in Schritt 3 (Spezifikation 1, Abschnitt 9): freundlich und ohne
 * Wertung, mit den Wegen „Datum korrigieren“ und „Abmelden“. Abmelden läuft über das Abmeldemodul
 * (#111) wie unter „Konto“; danach führt die Sitzungs-Weiche zum Willkommen.
 */
export function UnderageStep({ onCorrectDate }: UnderageStepProps) {
  return (
    <OnboardingFrame
      step="koerperdaten"
      title={texts.headline}
      onBack={onCorrectDate}
      primary={{ label: texts.correctDate, onPress: onCorrectDate }}
    >
      <Text>{texts.text}</Text>
      <Text>{texts.typo}</Text>
      <LogoutArea />
    </OnboardingFrame>
  );
}
