import { StyleSheet, View } from 'react-native';

import { Chip, Notice, space, Text } from '../design';
import { MomoFigure } from '../shell/MomoFigure';
import { OnboardingFrame } from './OnboardingFrame';
import { onboardingTexts } from './texts';

/** Größe von Momo im Willkommen; Designwert ohne Beleg. */
const momoSize = 160;

export type WelcomeStepProps = {
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  onNext: () => void;
};

/**
 * Schritt 1 „Willkommen“: Momo (ohne Kopplung als Laichkugel) und der Hinweis „keine medizinische
 * Beratung“, den die Person bestätigen muss. Ohne Bestätigung geht es nicht weiter; der Grund steht
 * neben der Bestätigung. Der Schritt braucht kein Netz.
 */
export function WelcomeStep({ confirmed, onConfirmedChange, onNext }: WelcomeStepProps) {
  return (
    <OnboardingFrame
      step="willkommen"
      title={onboardingTexts.welcomeHeadline}
      primary={{ label: onboardingTexts.next, onPress: onNext, disabled: !confirmed }}
    >
      <View style={styles.momo}>
        <MomoFigure mood="neugierig" size={momoSize} />
      </View>
      <Text>{onboardingTexts.welcomeIntro}</Text>
      <Notice tone="neutral" icon="info" text={onboardingTexts.disclaimer} />
      <View style={styles.confirm}>
        <Chip
          label={onboardingTexts.disclaimerConfirm}
          accessibilityLabel={`${onboardingTexts.disclaimerConfirm}: ${onboardingTexts.disclaimer}`}
          selection="multiple"
          selected={confirmed}
          onPress={() => onConfirmedChange(!confirmed)}
        />
        {confirmed ? null : (
          <Text variant="caption" tone="inkMuted">
            {onboardingTexts.disclaimerRequired}
          </Text>
        )}
      </View>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  momo: { alignItems: 'center', paddingVertical: space[2] },
  confirm: { gap: space[2], alignItems: 'flex-start' },
});
