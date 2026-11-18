import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useClock } from '../clock/clock-context';
import { Chip, Notice, space, Text } from '../design';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { safetyCheckOf } from './safety-check';
import { stepTitles } from './steps';
import { bmiText, onboardingTexts, safetyCheckTexts as texts } from './texts';

export type SafetyCheckStepProps = {
  /** Zurück zu Schritt 3; alle Eingaben bleiben im Entwurf. */
  onBack: () => void;
  /** Beide Fragen beantwortet: weiter zu Schritt 5. */
  onNext: () => void;
};

type Question = 'pregnantOrBreastfeeding' | 'knownEatingDisorder';

const questions: readonly { key: Question; text: { question: string; name: string } }[] = [
  { key: 'pregnantOrBreastfeeding', text: texts.pregnant },
  { key: 'knownEatingDisorder', text: texts.eatingDisorder },
];

/**
 * Schritt 4 „Sicherheits-Check“ (Spezifikation 1, Abschnitte 3 und 9): zwei Fragen und der BMI aus
 * Schritt 3. Bei „ja“ oder BMI < 18,5 zeigt die Vorschau des Zielrechners den erzwungenen Haltemodus
 * mit Hinweis auf ärztliche Begleitung; chronische Erkrankungen erhalten nur einen Hinweis ohne Sperre.
 * Die Antworten liegen sofort im lokalen Entwurf. Ohne Netz.
 */
export function SafetyCheckStep({ onBack, onNext }: SafetyCheckStepProps) {
  const onboarding = useOnboarding();
  const clock = useClock();
  const [draft, setDraft] = useState(() => onboarding.readDraft());
  const check = safetyCheckOf(draft, clock.read().localDate);
  const answered = check?.answered === true;

  return (
    <OnboardingFrame
      step="sicherheits_check"
      title={stepTitles.sicherheits_check}
      onBack={onBack}
      primary={{ label: onboardingTexts.next, onPress: () => (answered ? onNext() : undefined), disabled: !answered }}
    >
      <Text>{texts.intro}</Text>

      {questions.map(({ key, text }) => (
        <View key={key} style={styles.group}>
          <Text variant="label">{text.question}</Text>
          <View style={styles.chips}>
            {[true, false].map((value) => {
              const label = value ? texts.yes : texts.no;
              return (
                <Chip
                  key={label}
                  label={label}
                  accessibilityLabel={`${text.name}: ${label}`}
                  selection="single"
                  selected={draft[key] === value}
                  onPress={() => setDraft(onboarding.updateDraft({ [key]: value }))}
                />
              );
            })}
          </View>
        </View>
      ))}

      {check === null ? null : (
        <View style={styles.group}>
          <Text variant="label">{texts.bmi}</Text>
          <Text variant="title">{bmiText(check.bmi)}</Text>
          <Text variant="caption" tone="inkMuted">
            {texts.bmiSource}
          </Text>
        </View>
      )}

      {check === null || check.triggers.length === 0 ? null : (
        <Notice tone="hint" icon="info" text={texts.maintenanceForced(check.triggers)} />
      )}

      <Notice tone="neutral" icon="info" text={texts.chronicIllness} />

      {answered ? null : (
        <Text variant="caption" tone="inkMuted">
          {texts.answerRequired}
        </Text>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingTop: space[1] },
});
