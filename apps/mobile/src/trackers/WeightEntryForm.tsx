import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { EntityId, Instant } from '@abnehm/contracts/base';
import { asksForTypo, isInFuture, isValidManualWeight, manualWeightG } from '@abnehm/contracts/tracker-rules';

import { useClock } from '../clock/clock-context';
import { Button, DateTimePicker, Notice, space, Text, TextField, type TextFieldHandle } from '../design';
import { useUndoableMessage, type UndoableOutcome } from '../shell/use-undoable-message';
import { thousandthsWithOneDecimal as kg } from '../shell/texts';
import { gramsOfKgText } from './kg-text';
import type { Trackers } from './trackers';
import { weightTexts } from './weight-texts';

// Formular „Gewicht eintragen“ (Spezifikation 3, Abschnitte 3–5; #38): kg mit einer Nachkommastelle,
// das letzte Gewicht vorausgefüllt, damit die Person nur die Änderung tippt, und der Messzeitpunkt
// „jetzt“, änderbar für nachgetragene Messungen. Weicht die Eingabe um mehr als 2 kg vom letzten
// Tagesgewicht ab, fragt es vor dem Speichern inline „Tippfehler?“ – kein Systemdialog. Nach dem
// Speichern zeigt der Meldungs-Host „… kg eingetragen · Rückgängig“.
//
// Mit `entry` bearbeitet es eine manuelle Messung (#176): Wert und Messzeitpunkt sind vorausgefüllt,
// „Speichern“ ändert sie, „Löschen“ löscht sie ohne Bestätigungsdialog; die Meldung bietet „Rückgängig“.
// „Tippfehler?“ gilt auch hier; verglichen wird mit dem letzten Tagesgewicht der übrigen Messungen, denn
// das letzte Tagesgewicht wäre oft die bearbeitete Messung selbst.

// Die Grenzen kommen aus den Tracker-Regeln, damit der Satz bei einer Änderung stimmt.
const invalidWeight = `Bitte ein Gewicht von ${kg(manualWeightG.min)} bis ${kg(manualWeightG.max)} kg mit höchstens einer Nachkommastelle eingeben.`;
const futureMeasurement = 'Der Messzeitpunkt liegt in der Zukunft. Bitte einen Zeitpunkt bis jetzt wählen.';

/** Eine manuelle Messung, die das Formular bearbeitet. */
export type EditedWeight = Readonly<{ id: EntityId; weightG: number; measuredAt: Instant }>;

/** Was das Formular vom Tracker-Modul braucht. */
export type WeightFormTrackers = Pick<Trackers, 'recordWeight' | 'updateWeight' | 'deleteWeight' | 'lastWeights' | 'undo' | 'expire'>;

export type WeightEntryFormProps = {
  trackers: WeightFormTrackers;
  /** Bearbeitet diese manuelle Messung, statt eine neue einzutragen. */
  entry?: EditedWeight;
  /** Gespeichert oder gelöscht; der Aufrufer schließt das Formular. */
  onSaved: () => void;
};

export function WeightEntryForm({ trackers, entry, onSaved }: WeightEntryFormProps) {
  const clock = useClock();
  const message = useUndoableMessage();
  const field = useRef<TextFieldHandle>(null);
  // Vorbelegung (letztes Gewicht) und Vergleichswert (letztes Tagesgewicht) bleiben, solange das Formular offen ist.
  const [last] = useState(() => trackers.lastWeights(entry?.id));
  const [text, setText] = useState(() => (entry !== undefined ? kg(entry.weightG) : last === null ? '' : kg(last.weightG)));
  const [measuredAt, setMeasuredAt] = useState(() => entry?.measuredAt ?? clock.read().instant);
  const [invalid, setInvalid] = useState(false);
  /** Der Messzeitpunkt liegt nach „jetzt“, etwa weil die Uhr zurückgesprungen ist; der Picker endet bei jetzt. */
  const [future, setFuture] = useState(false);
  /** Das Gewicht, zu dem gerade „Tippfehler?“ gefragt wird. */
  const [asked, setAsked] = useState<number | null>(null);
  const now = clock.read();

  const changeText = (next: string) => {
    setText(next);
    setInvalid(false);
    setAsked(null);
  };

  /** Führt den Befehl aus, schließt und zeigt die Meldung mit „Rückgängig“. */
  const run = (command: () => UndoableOutcome & Readonly<{ undoToken: string }>) => {
    let outcome;
    try {
      outcome = command();
    } catch (error) {
      // Die Eingaben sind vorher geprüft; scheitert der Befehl trotzdem, etwa weil die Messung inzwischen
      // gelöscht ist, sieht die Person „Das hat nicht geklappt …“.
      return message.failed(error);
    }
    const { undoToken } = outcome;
    onSaved();
    message.show(outcome, { run: () => trackers.undo(undoToken), expire: () => trackers.expire(undoToken) });
  };
  const record = (weightG: number) =>
    run(() => (entry === undefined ? trackers.recordWeight({ weightG, measuredAt }) : trackers.updateWeight(entry.id, { weightG, measuredAt })));

  const save = () => {
    const weightG = gramsOfKgText(text);
    if (weightG === null || !isValidManualWeight(weightG)) return setInvalid(true);
    if (isInFuture(measuredAt, clock.read().instant)) return setFuture(true);
    if (asksForTypo(weightG, last?.dayWeight.weightG ?? null)) return setAsked(weightG);
    record(weightG);
  };

  return (
    <View style={styles.form}>
      <TextField
        label="Gewicht"
        kind="number"
        unit="kg"
        value={text}
        onChangeText={changeText}
        problem={invalid ? invalidWeight : undefined}
        ref={field}
      />
      <View style={styles.group}>
        {/* Sichtbar beschriftet: Der native Picker auf iOS zeigt nur Datum und Uhrzeit. */}
        <Text variant="label" importantForAccessibility="no">Gemessen am</Text>
        <DateTimePicker
          label="Gemessen am"
          mode="datetime"
          value={measuredAt}
          onChange={(next) => {
            setMeasuredAt(next);
            setFuture(false);
            setAsked(null);
          }}
          timeZone={now.timeZone}
          maximum={now.instant}
        />
        {future ? <Text variant="label" tone="problem">{futureMeasurement}</Text> : null}
      </View>
      {asked !== null && last !== null ? (
        <>
          <Notice tone="hint" text={typoQuestion(asked, last.dayWeight.weightG)} />
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
      {entry !== undefined ? <Button variant="secondary" label={weightTexts.delete} block onPress={() => run(() => trackers.deleteWeight(entry.id))} /> : null}
    </View>
  );
}

/** Neutral, ohne Wertung: wie weit die Eingabe vom letzten Tagesgewicht abweicht. */
function typoQuestion(weightG: number, dayWeightG: number): string {
  const direction = weightG > dayWeightG ? 'mehr' : 'weniger';
  return `Tippfehler? Das sind ${kg(Math.abs(weightG - dayWeightG))} kg ${direction} als dein letztes Tagesgewicht (${kg(dayWeightG)} kg).`;
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
  group: { gap: space[1] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], justifyContent: 'flex-end' },
});
