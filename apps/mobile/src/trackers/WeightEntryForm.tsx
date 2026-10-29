import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Instant, TimeZone } from '@abnehm/contracts/base';
import { asksForTypo, isValidManualWeight } from '@abnehm/contracts/tracker-rules';

import { useClock } from '../clock/clock-context';
import { Button, DateTimePicker, Notice, space, TextField, type TextFieldInput } from '../design';
import { useMessageHost } from '../shell/MessageHost';
import { thousandthsWithOneDecimal as kg } from '../shell/texts';
import { InvalidTrackerInputError } from './invalid-input';
import { gramsOfKgText } from './kg-text';
import type { Trackers } from './trackers';

// Formular „Gewicht eintragen“ (Spezifikation 3, Abschnitte 3–5; #38): kg mit einer Nachkommastelle,
// das letzte Tagesgewicht vorausgefüllt, damit die Person nur die Änderung tippt, und der Messzeitpunkt
// „jetzt“, änderbar für nachgetragene Messungen. Weicht die Eingabe um mehr als 2 kg vom letzten
// Tagesgewicht ab, fragt es vor dem Speichern inline „Tippfehler?“ – kein Systemdialog. Nach dem
// Speichern zeigt der Meldungs-Host „… kg eingetragen · Rückgängig“.

const invalidInput = 'Bitte ein Gewicht von 20,0 bis 350,0 kg mit höchstens einer Nachkommastelle eingeben.';

export type WeightEntryFormProps = {
  trackers: Pick<Trackers, 'recordWeight' | 'lastDayWeight' | 'undo' | 'expire'>;
  /** Gespeichert; der Aufrufer schließt das Formular. */
  onSaved: () => void;
};

export function WeightEntryForm({ trackers, onSaved }: WeightEntryFormProps) {
  const clock = useClock();
  const { showMessage } = useMessageHost();
  const field = useRef<TextFieldInput>(null);
  // Vergleichswert und Vorbelegung bleiben, solange das Formular offen ist.
  const [last] = useState(() => trackers.lastDayWeight());
  const [text, setText] = useState(() => (last === null ? '' : kg(last.weightG)));
  const [measuredAt, setMeasuredAt] = useState(() => clock.read().instant);
  const [invalid, setInvalid] = useState(false);
  /** Das Gewicht, zu dem gerade „Tippfehler?“ gefragt wird. */
  const [asked, setAsked] = useState<number | null>(null);
  const now = clock.read();

  const changeText = (next: string) => {
    setText(next);
    setInvalid(false);
    setAsked(null);
  };

  const record = (weightG: number) => {
    let outcome;
    try {
      outcome = trackers.recordWeight({ weightG, measuredAt });
    } catch (error) {
      if (error instanceof InvalidTrackerInputError) return setInvalid(true);
      console.error(error);
      return showMessage({ messageKey: 'shell.nicht_geklappt', values: {} });
    }
    const { messageKey, values, undoToken } = outcome;
    onSaved();
    showMessage({ messageKey, values, undo: { run: () => trackers.undo(undoToken), expire: () => trackers.expire(undoToken) } });
  };

  const save = () => {
    const weightG = gramsOfKgText(text);
    if (weightG === null || !isValidManualWeight(weightG)) return setInvalid(true);
    if (asksForTypo(weightG, last?.weightG ?? null)) return setAsked(weightG);
    record(weightG);
  };

  return (
    <View style={styles.form}>
      <TextField
        label="Gewicht"
        unit="kg"
        keyboardType="decimal-pad"
        value={text}
        onChangeText={changeText}
        error={invalid ? invalidInput : undefined}
        selectTextOnFocus
        inputRef={field}
      />
      <DateTimePicker
        label="Gemessen am"
        mode="datetime"
        value={measuredAt}
        onChange={(next) => {
          setMeasuredAt(next);
          setAsked(null);
        }}
        timeZone={TimeZone.parse(now.timeZone)}
        maximum={Instant.parse(now.instant)}
      />
      {asked !== null && last !== null ? (
        <>
          <Notice tone="hint" text={typoQuestion(asked, last.weightG)} />
          <View style={styles.actions}>
            <Button
              variant="secondary"
              label="Korrigieren"
              onPress={() => {
                setAsked(null);
                field.current?.focus();
              }}
            />
            <Button label="Stimmt so" onPress={() => record(asked)} />
          </View>
        </>
      ) : (
        <Button label="Speichern" block onPress={save} />
      )}
    </View>
  );
}

/** Neutral, ohne Wertung: wie weit die Eingabe vom letzten Tagesgewicht abweicht. */
function typoQuestion(weightG: number, lastWeightG: number): string {
  const direction = weightG > lastWeightG ? 'mehr' : 'weniger';
  return `Tippfehler? Das sind ${kg(Math.abs(weightG - lastWeightG))} kg ${direction} als dein letztes Tagesgewicht (${kg(lastWeightG)} kg).`;
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'flex-end' },
});
