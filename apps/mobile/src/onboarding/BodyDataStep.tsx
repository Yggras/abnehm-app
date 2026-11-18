import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { readingOf, startOfLocalDate } from '@abnehm/clock';
import { LocalDate } from '@abnehm/contracts/base';
import { CalculationSex } from '@abnehm/contracts/person';

import { useClock } from '../clock/clock-context';
import { Chip, DateTimePicker, ProblemMessage, space, Text, TextField, type TextFieldHandle } from '../design';
import { thousandthsWithOneDecimal as kg } from '../shell/texts';
import { gramsOfKgText } from '../trackers/kg-text';
import type { BodyDataProblem } from './body-data';
import { useOnboarding } from './OnboardingContext';
import { OnboardingFrame } from './OnboardingFrame';
import { stepTitles } from './steps';
import { bodyDataTexts as texts, onboardingTexts } from './texts';

/** Ganze Zentimeter ohne Vorzeichen; den Bereich prüft der Zielrechner. */
const heightInput = /^\d{1,3}$/;

function heightOfText(text: string): number | null {
  const trimmed = text.trim();
  return heightInput.test(trimmed) ? Number(trimmed) : null;
}

/** Ein Wert für den Entwurf: nur positive Zahlen, sonst wird das Feld dort gelöscht. */
const positiveOrUndefined = (value: number | null) => (value !== null && value > 0 ? value : undefined);

/**
 * Vorauswahl des Pickers, solange kein Geburtsdatum gewählt ist: der 1. Januar vor 30 Jahren
 * (Designwert ohne Beleg). Sie zählt nicht als Eingabe; erst eine Wahl legt das Datum im Entwurf ab.
 */
function pickerStart(today: LocalDate): LocalDate {
  return LocalDate.parse(`${String(Number(today.slice(0, 4)) - 30).padStart(4, '0')}-01-01`);
}

/** Frühestes wählbares Geburtsdatum (Designwert ohne Beleg). */
const earliestBirthDate = LocalDate.parse('1900-01-01');

export type BodyDataStepProps = {
  /** Gültig und volljährig: weiter zu Schritt 4. */
  onNext: () => void;
  /** Das Geburtsdatum ergibt unter 18 Jahre: Sperrbildschirm. */
  onUnderage: () => void;
};

/**
 * Schritt 3 „Körperdaten“ (Spezifikation 1, Abschnitte 3 und 9): Berechnungsgeschlecht mit Erklärung,
 * Geburtsdatum über den nativen Picker, Größe und aktuelles Gewicht. Jede Eingabe liegt sofort im
 * lokalen Entwurf; „Weiter“ prüft sie über das Onboarding-Modul mit den Grenzen des Zielrechners.
 * Ohne Netz.
 */
export function BodyDataStep({ onNext, onUnderage }: BodyDataStepProps) {
  const onboarding = useOnboarding();
  const clock = useClock();
  const now = clock.read();
  const [draft, setDraft] = useState(() => onboarding.readDraft());
  const [heightText, setHeightText] = useState(() => (draft.heightCm === undefined ? '' : String(draft.heightCm)));
  const [weightText, setWeightText] = useState(() => (draft.weightG === undefined ? '' : kg(draft.weightG)));
  /** Probleme seit dem letzten „Weiter“; eine Änderung am Feld nimmt seines zurück. */
  const [problems, setProblems] = useState<readonly BodyDataProblem[]>([]);
  const weightField = useRef<TextFieldHandle>(null);

  const change = (next: Parameters<typeof onboarding.updateDraft>[0], resolved: readonly BodyDataProblem[]) => {
    setDraft(onboarding.updateDraft(next));
    setProblems((current) => current.filter((problem) => !resolved.includes(problem)));
  };

  const problemOf = (...keys: BodyDataProblem[]) => {
    const problem = problems.find((candidate) => keys.includes(candidate));
    return problem === undefined ? undefined : texts.problems[problem];
  };

  /** Ein Text, der keine Zahl im erlaubten Format ist, fehlt im Entwurf; dann nennt das Feld das Format statt „fehlt“. */
  const fieldProblem = (text: string, parsed: number | null, invalid: string, keys: BodyDataProblem[]) => {
    const problem = problemOf(...keys);
    return problem !== undefined && text.trim() !== '' && parsed === null ? invalid : problem;
  };
  const heightProblem = fieldProblem(heightText, heightOfText(heightText), texts.heightInvalid, ['height_missing', 'height_out_of_range', 'height_not_on_step']);
  const weightProblem = fieldProblem(weightText, gramsOfKgText(weightText), texts.weightInvalid, ['weight_missing', 'weight_out_of_range', 'weight_not_on_step']);
  const sexProblem = problemOf('calculation_sex_missing');
  const birthDateProblem = problemOf('birth_date_missing');

  const next = () => {
    const result = onboarding.confirmBodyData();
    if (result.type === 'bestaetigt') onNext();
    else if (result.type === 'minderjaehrig') onUnderage();
    else setProblems(result.errors);
  };

  const birthDate = draft.birthDate ?? pickerStart(now.localDate);

  return (
    <OnboardingFrame step="koerperdaten" title={stepTitles.koerperdaten} primary={{ label: onboardingTexts.next, onPress: next }}>
      <Text>{texts.intro}</Text>

      <View style={styles.group}>
        <Text variant="label">{texts.sex}</Text>
        <Text variant="caption" tone="inkMuted">
          {texts.sexExplanation}
        </Text>
        <View style={styles.chips}>
          {CalculationSex.options.map((sex) => (
            <Chip
              key={sex}
              label={texts.sexValues[sex]}
              selection="single"
              selected={draft.calculationSex === sex}
              onPress={() => change({ calculationSex: sex }, ['calculation_sex_missing'])}
            />
          ))}
        </View>
        {sexProblem === undefined ? null : <ProblemMessage text={sexProblem} />}
      </View>

      <View style={styles.group}>
        {/* Sichtbar beschriftet: Der native Picker auf iOS zeigt nur das Datum. */}
        <Text variant="label" importantForAccessibility="no">
          {texts.birthDate}
        </Text>
        {/* Linksbündig gehalten: Ohne Hülle rückte die iOS-Pille nach „Zurück“ ein (Impeccable-critique). */}
        <View style={styles.picker}>
          <DateTimePicker
            label={texts.birthDate}
            mode="date"
            value={startOfLocalDate(birthDate, now.timeZone)}
            onChange={(instant) => change({ birthDate: readingOf(instant, now.timeZone).localDate }, ['birth_date_missing'])}
            timeZone={now.timeZone}
            minimum={startOfLocalDate(earliestBirthDate, now.timeZone)}
            maximum={now.instant}
          />
        </View>
        {birthDateProblem !== undefined ? (
          <ProblemMessage text={birthDateProblem} />
        ) : draft.birthDate === undefined ? (
          <Text variant="caption" tone="inkMuted">
            {texts.birthDateUnset}
          </Text>
        ) : null}
      </View>

      <TextField
        label={texts.height}
        kind="number"
        unit="cm"
        keyboardType="number-pad"
        value={heightText}
        onChangeText={(text) => {
          setHeightText(text);
          change({ heightCm: positiveOrUndefined(heightOfText(text)) }, ['height_missing', 'height_out_of_range', 'height_not_on_step']);
        }}
        hint={texts.heightHint}
        problem={heightProblem}
        returnKeyType="next"
        onSubmitEditing={() => weightField.current?.focus()}
      />
      <TextField
        label={texts.weight}
        kind="number"
        unit="kg"
        value={weightText}
        onChangeText={(text) => {
          setWeightText(text);
          change({ weightG: positiveOrUndefined(gramsOfKgText(text)) }, ['weight_missing', 'weight_out_of_range', 'weight_not_on_step']);
        }}
        hint={texts.weightHint}
        problem={weightProblem}
        ref={weightField}
      />
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  group: { gap: space[1] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], paddingTop: space[1] },
  picker: { flexDirection: 'row', justifyContent: 'flex-start' },
});
