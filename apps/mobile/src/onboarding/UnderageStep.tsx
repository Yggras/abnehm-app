import { StyleSheet, View } from 'react-native';

import { space, Text } from '../design';
import { LogoutArea } from '../settings';
import { MomoFigure } from '../momo';
import { OnboardingFrame } from './OnboardingFrame';
import { underageTexts as texts } from './texts';

/** Größe von Momo auf dem Sperrbildschirm; Designwert ohne Beleg, kleiner als im Willkommen (160). */
const momoSize = 120;

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
      {/* Momo macht die Sperre freundlich statt abweisend (Impeccable-critique). */}
      <View style={styles.momo}>
        <MomoFigure mood="zufrieden" size={momoSize} />
      </View>
      <Text>{texts.text}</Text>
      <Text>{texts.typo}</Text>
      <LogoutArea />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  momo: { alignItems: 'center', paddingVertical: space[2] },
});
