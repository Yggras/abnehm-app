import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { GoalInputError } from '@abnehm/contracts/goal-calculator';
import { Pace } from '@abnehm/contracts/ports';

import { useClock } from '../clock/clock-context';
import { Card, Chip, Notice, space, Text, TextField } from '../design';
import { thousandthsWithOneDecimal as kg } from '../shell/texts';
import { gramsOfKgText } from '../trackers/kg-text';
import { goalWeightTexts as texts } from './goal-texts';
import { goalPreviewOf } from './goals';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { stepTitles } from './steps';
import { onboardingTexts } from './texts';

export type GoalWeightStepProps = {
  /** Zurück zu Schritt 5; alle Eingaben bleiben im Entwurf. */
  onBack: () => void;
  /** Weiter zu Schritt 7, Zielgewicht und Tempo liegen dann im Entwurf. */
  onNext: () => void;
};

/** Fehler des Zielrechners, die das Zielgewicht betreffen. */
const goalWeightErrors: ReadonlySet<GoalInputError> = new Set(['goal_weight_out_of_range', 'goal_weight_not_on_step', 'goal_weight_below_lower_limit']);

/**
 * Schritt 6 „Zielgewicht und Tempo“ (Spezifikation 1, Abschnitte 3 und 9). Das Zielgewicht ist mit 5 %
 * unter dem aktuellen Gewicht vorausgefüllt; Vorschlag 5–10 %, Untergrenze BMI 18,5 und Raster 0,1 kg
 * kommen aus der Vorschau des Zielrechners. Im Haltemodus entfällt das Tempo: Ein Zielgewicht nicht unter
 * dem aktuellen führt mit Hinweis in den gewählten, der Sicherheits-Check in den erzwungenen. Die Prognose
 * erscheint nur mit Defizit, als Schätzung. Jede lesbare Eingabe liegt sofort im lokalen Entwurf. Ohne Netz.
 */
export function GoalWeightStep({ onBack, onNext }: GoalWeightStepProps) {
  const onboarding = useOnboarding();
  const today = useClock().read().localDate;
  const [draft, setDraft] = useState(() => onboarding.readDraft());
  // Zielgewicht ohne Eingabe: Vorauswahl, Vorschlag und Untergrenze für Feld und Hinweis.
  const reference = goalPreviewOf({ ...draft, goalWeightG: undefined }, today);
  const goalWeight = reference?.type === 'berechnet' ? reference.goalWeight : null;
  const [text, setText] = useState(() => {
    const shownG = draft.goalWeightG ?? goalWeight?.preselectedG;
    return shownG === undefined ? '' : kg(shownG);
  });

  const enteredG = gramsOfKgText(text);
  const readable = enteredG !== null && enteredG > 0;
  const result = readable ? goalPreviewOf(draft, today) : null;
  const calculation = result?.type === 'berechnet' ? result : null;
  const errors = result?.type === 'ungueltig' ? result.errors : [];
  const problem = !readable
    ? texts.invalid
    : errors.includes('goal_weight_below_lower_limit') && goalWeight !== null
      ? texts.belowLimit(goalWeight.range.min)
      : errors.some((error) => goalWeightErrors.has(error))
        ? texts.invalid
        : undefined;
  const valid = readable && calculation !== null;

  function changeText(next: string) {
    setText(next);
    const grams = gramsOfKgText(next);
    setDraft(onboarding.updateDraft({ goalWeightG: grams !== null && grams > 0 ? grams : undefined }));
  }

  function next() {
    if (!valid || enteredG === null) return;
    // „Weiter“ übernimmt die gezeigte Wahl, auch die Vorauswahl des Tempos.
    onboarding.updateDraft({ goalWeightG: enteredG, ...(draft.pace === undefined && calculation.pace !== null ? { pace: calculation.pace } : {}) });
    onNext();
  }

  return (
    <OnboardingFrame
      step="zielgewicht"
      title={stepTitles.zielgewicht}
      onBack={onBack}
      primary={{ label: onboardingTexts.next, onPress: next, disabled: !valid }}
    >
      <Text>{texts.intro}</Text>

      <TextField
        label={texts.goalWeight}
        kind="number"
        unit="kg"
        value={text}
        onChangeText={changeText}
        hint={goalWeight === null ? undefined : texts.hint(goalWeight.suggestion, goalWeight.range.min)}
        problem={problem}
      />

      {calculation?.hints.includes('maintenance_forced') ? <Notice tone="hint" icon="info" text={texts.maintenanceForced(calculation.safetyTriggers)} /> : null}
      {calculation?.hints.includes('goal_weight_not_below_current') ? (
        <Notice tone="hint" icon="info" text={texts.notBelowCurrent(draft.weightG ?? 0)} />
      ) : null}

      {calculation === null || calculation.maintenanceReason !== null ? null : (
        <View style={styles.section}>
          <Text variant="label">{texts.pace}</Text>
          <View style={styles.chips}>
            {Pace.options.map((pace) => (
              <Chip
                key={pace}
                label={texts.paceChoice(pace)}
                selection="single"
                selected={calculation.pace === pace}
                onPress={() => setDraft(onboarding.updateDraft({ pace }))}
              />
            ))}
          </View>
        </View>
      )}

      {calculation === null || calculation.forecast === null ? null : (
        // Eigener Block statt Wertzeile: Daneben bräche der Hinweis auf dem iPhone SE in eine schmale Spalte (Impeccable-critique).
        <Card>
          <View style={styles.forecast} accessible accessibilityLabel={`${texts.forecastLabel}: ${texts.forecast(calculation.forecast.year, calculation.forecast.month)}. ${texts.forecastNote}`}>
            <Text variant="label" tone="inkMuted">
              {texts.forecastLabel}
            </Text>
            <Text variant="title">{texts.forecast(calculation.forecast.year, calculation.forecast.month)}</Text>
            <Text variant="label" tone="inkMuted">
              {texts.forecastNote}
            </Text>
          </View>
        </Card>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  section: { gap: space[1] },
  forecast: { gap: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingTop: space[1] },
});
