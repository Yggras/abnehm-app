import { useEffect, type ReactNode } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, color, IconButton, ProgressBar, space, Text } from '../design';
import { shellTexts } from '../shell/texts';
import { stepCount, stepNumber, type OnboardingFlowStep } from './steps';
import { onboardingTexts } from './texts';

type Action = Readonly<{ label: string; onPress: () => void; disabled?: boolean; loading?: boolean }>;

export type OnboardingFrameProps = {
  step: OnboardingFlowStep;
  /** Überschrift des Schritts. */
  title: string;
  /** Zurück zum vorigen Schritt; ohne, etwa in Schritt 1, gibt es kein Zurück. System-Zurück folgt ihm. */
  onBack?: () => void;
  /** Hauptaktion unten. */
  primary?: Action;
  /** Nebenaktion unter der Hauptaktion, etwa „Ich habe schon ein Konto“ oder „Überspringen“. */
  secondary?: Action;
  children: ReactNode;
};

/**
 * Rahmen aller elf Onboarding-Schritte (Spezifikation 1, Abschnitt 9): oben Zurück und Fortschritt
 * „Schritt x von 11“, darunter Überschrift und Inhalt, unten die Hauptaktion. Die Aktionen bleiben über
 * der Tastatur sichtbar; der Inhalt scrollt, auch bei Schriftfaktor 2,0.
 */
export function OnboardingFrame({ step, title, onBack, primary, secondary, children }: OnboardingFrameProps) {
  const number = stepNumber(step);
  useEffect(() => {
    if (onBack === undefined) return;
    // Android: System-Zurück führt zum vorigen Schritt statt aus der App.
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
        <View style={styles.bar}>
          {onBack === undefined ? null : <IconButton icon="back" accessibilityLabel={shellTexts.back} onPress={onBack} />}
          <View style={styles.progress}>
            <Text variant="label" tone="inkMuted" accessible={false} importantForAccessibility="no">
              {onboardingTexts.progress(number, stepCount)}
            </Text>
            <ProgressBar
              label={onboardingTexts.progressLabel}
              value={number}
              target={stepCount}
              valueText={onboardingTexts.progress(number, stepCount)}
              legend={false}
            />
          </View>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text variant="display" accessibilityRole="header">
            {title}
          </Text>
          {children}
        </ScrollView>
        {primary === undefined && secondary === undefined ? null : (
          <View style={styles.actions}>
            {primary === undefined ? null : <Button {...primary} block />}
            {secondary === undefined ? null : <Button {...secondary} variant="text" block />}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.surfaceBase },
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingTop: space[2] },
  progress: { flex: 1, gap: space[1] },
  content: { padding: space[4], gap: space[4] },
  actions: { paddingHorizontal: space[4], paddingTop: space[2], paddingBottom: space[4], gap: space[2] },
});
