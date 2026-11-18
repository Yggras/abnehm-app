import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Instant, type EntityId, type TimeZone } from '@abnehm/contracts/base';
import {
  activityTypes,
  isInFuture,
  isValidManualSportMilliKcal,
  isValidManualSportMinutes,
  manualSportMilliKcal,
  manualSportMinutes,
} from '@abnehm/contracts/tracker-rules';
import type { ActivityType } from '@abnehm/contracts/trackers';

import { useClock } from '../clock/clock-context';
import { Button, Chip, DateTimePicker, ListGroup, ListRow, ProblemMessage, space, Text, TextField } from '../design';
import { activityNames } from '../shell/texts';
import { useUndoableMessage, type UndoableOutcome } from '../shell/use-undoable-message';
import { activityIcons } from './activity-icons';
import type { Trackers } from './trackers';

// Formular „+ Einheit“ (Spezifikation 3, Abschnitte 3–5; #38). Eine typische Einheit ist mit wenigen
// Tipps eingetragen: Die zuletzt genutzte Art steht oben und ist gewählt, die letzte Dauer vorausgefüllt,
// die Schnellwahl bietet 15, 30, 45 und 60 Minuten, der Beginn ist „jetzt − Dauer“. Mit Vorbelegung zeigt
// die Liste nur die gewählte Art und „Andere Art“, damit „Speichern“ auch auf dem iPhone SE ohne Scrollen
// zu sehen ist (Impeccable-Kritik, #173). Tag und Uhrzeit des
// Beginns sind änderbar; danach folgt der Beginn der Dauer nicht mehr. Kalorien sind optional und werden
// nur angezeigt. Es gibt keine Intensität. Nach dem Speichern zeigt der Meldungs-Host
// „30 min Laufen eingetragen · Rückgängig“.
//
// Mit `entry` bearbeitet es eine manuelle Einheit (#174): Art, Dauer, Beginn und Kalorien sind
// vorausgefüllt, „Speichern“ ändert sie, „Löschen“ löscht sie ohne Bestätigungsdialog; die Meldung bietet
// „Rückgängig“. Die zuletzt genutzte Einheit bleibt dabei, wie sie ist.

/** Schnellwahl der Dauer in Minuten (#38). */
const quickMinutes = [15, 30, 45, 60] as const;

// Die Grenzen kommen aus den Tracker-Regeln, damit die Sätze bei einer Änderung stimmen.
const kcal = (milliKcal: number) => milliKcal / 1000;
const texts = {
  missingActivity: 'Bitte eine Art wählen.',
  invalidMinutes: `Bitte eine Dauer von ${manualSportMinutes.min} bis ${manualSportMinutes.max} Minuten eingeben.`,
  invalidKcal: `Bitte Kalorien von ${kcal(manualSportMilliKcal.min)} bis ${kcal(manualSportMilliKcal.max)} kcal eingeben oder das Feld leer lassen.`,
  futureStart: 'Der Beginn liegt in der Zukunft. Bitte einen Zeitpunkt bis jetzt wählen.',
};

type Problem = keyof typeof texts;

/** Ganze Zahl ohne Vorzeichen und Nachkommastellen, etwa „45“; sonst `null`. Den Bereich prüfen die Tracker-Regeln. */
function wholeNumber(text: string): number | null {
  return /^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** Kalorien als `milli_kcal`; ein leeres Feld heißt „keine Angabe“, sonst ganze kcal. Ungültig ist `undefined`. */
function milliKcalOf(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const value = wholeNumber(text);
  return value === null ? undefined : value * 1000;
}

/** Der Zeitpunkt `minutes` Minuten vor `instant`. */
function minutesBefore(instant: Instant, minutes: number): Instant {
  return Instant.parse(new Date(Date.parse(instant) - minutes * 60_000).toISOString());
}

/** Eine manuelle Einheit, die das Formular bearbeitet; Uhrzeiten zeigt es in der Zone ihrer Anlage. */
export type EditedSport = Readonly<{
  id: EntityId;
  activityType: ActivityType;
  durationMinutes: number;
  startedAt: Instant;
  activeMilliKcal: number | null;
  timeZone: TimeZone;
}>;

/** Was das Formular vom Tracker-Modul braucht. */
export type SportFormTrackers = Pick<Trackers, 'recordSport' | 'updateSport' | 'deleteSport' | 'lastSport' | 'undo' | 'expire'>;

export type SportEntryFormProps = {
  trackers: SportFormTrackers;
  /** Bearbeitet diese manuelle Einheit, statt eine neue einzutragen. */
  entry?: EditedSport;
  /** Gespeichert oder gelöscht; der Aufrufer schließt das Formular. */
  onSaved: () => void;
};

export function SportEntryForm({ trackers, entry, onSaved }: SportEntryFormProps) {
  const clock = useClock();
  const message = useUndoableMessage();
  // Vorbelegung und Reihenfolge bleiben, solange das Formular offen ist, damit die Liste beim Wählen nicht springt.
  // Beim Bearbeiten belegt die Einheit selbst vor, sonst die zuletzt genutzte.
  const [last] = useState(() => entry ?? trackers.lastSport());
  const [order] = useState<readonly ActivityType[]>(() => (last === null ? activityTypes : [last.activityType, ...activityTypes.filter((type) => type !== last.activityType)]));
  const [activity, setActivity] = useState<ActivityType | null>(last?.activityType ?? null);
  /** Alle Arten sichtbar; mit Vorbelegung zunächst nur die gewählte. */
  const [allKinds, setAllKinds] = useState(last === null);
  const [minutesText, setMinutesText] = useState(last === null ? '' : String(last.durationMinutes));
  /** Selbst gewählter Beginn; `null`, solange er „jetzt − Dauer“ folgt. Beim Bearbeiten der gespeicherte. */
  const [chosenStart, setChosenStart] = useState<Instant | null>(entry?.startedAt ?? null);
  const [kcalText, setKcalText] = useState(entry?.activeMilliKcal == null ? '' : String(kcal(entry.activeMilliKcal)));
  const [problems, setProblems] = useState<ReadonlySet<Problem>>(new Set());
  const now = clock.read();
  const minutes = wholeNumber(minutesText);

  /** Beginn zu einem Zeitpunkt „jetzt“: der selbst gewählte oder „jetzt − Dauer“, ohne gültige Dauer „jetzt“. */
  const startAt = (instant: Instant) => chosenStart ?? (minutes !== null && isValidManualSportMinutes(minutes) ? minutesBefore(instant, minutes) : instant);

  const solve = (...solved: Problem[]) => setProblems((current) => new Set([...current].filter((problem) => !solved.includes(problem))));
  const changeMinutes = (text: string) => {
    setMinutesText(text);
    solve('invalidMinutes', 'futureStart');
  };

  const save = () => {
    const instant = clock.read().instant;
    const activeMilliKcal = milliKcalOf(kcalText);
    const startedAt = startAt(instant);
    const found = new Set<Problem>();
    if (activity === null) found.add('missingActivity');
    if (minutes === null || !isValidManualSportMinutes(minutes)) found.add('invalidMinutes');
    if (activeMilliKcal === undefined || !isValidManualSportMilliKcal(activeMilliKcal)) found.add('invalidKcal');
    if (isInFuture(startedAt, instant)) found.add('futureStart');
    setProblems(found);
    if (found.size > 0 || activity === null || minutes === null || activeMilliKcal === undefined) return;
    const input = { activityType: activity, durationMinutes: minutes, startedAt, activeMilliKcal };
    run(() => (entry === undefined ? trackers.recordSport(input) : trackers.updateSport(entry.id, input)));
  };

  /** Führt den Befehl aus, schließt und zeigt die Meldung mit „Rückgängig“. */
  const run = (command: () => UndoableOutcome & Readonly<{ undoToken: string }>) => {
    let outcome;
    try {
      outcome = command();
    } catch (error) {
      // Die Eingaben sind vorher geprüft; scheitert der Befehl trotzdem, etwa weil die Einheit inzwischen
      // gelöscht ist, sieht die Person „Das hat nicht geklappt …“.
      return message.failed(error);
    }
    const { undoToken } = outcome;
    onSaved();
    message.show(outcome, { run: () => trackers.undo(undoToken), expire: () => trackers.expire(undoToken) });
  };

  return (
    <View style={styles.form}>
      <View style={styles.group}>
        <Text variant="label" accessibilityRole="header">Art</Text>
        <ListGroup>
          {order.filter((type) => allKinds || type === activity).map((type) => (
            <ListRow
              key={type}
              icon={activityIcons[type]}
              title={activityNames[type]}
              accessibilityLabel={activityNames[type]}
              selected={activity === type}
              onPress={() => {
                setActivity(type);
                solve('missingActivity');
              }}
            />
          ))}
          {allKinds ? null : <ListRow icon="more" title="Andere Art" onPress={() => setAllKinds(true)} />}
        </ListGroup>
        {problems.has('missingActivity') ? <ProblemMessage text={texts.missingActivity} /> : null}
      </View>
      <View style={styles.group}>
        {/* Sichtbar über Schnellwahl und Feld; das Feld trägt denselben Namen für Screenreader. */}
        <Text variant="label" importantForAccessibility="no">Dauer</Text>
        <View style={styles.chips}>
          {quickMinutes.map((quick) => (
            <Chip key={quick} label={`${quick} min`} selection="single" selected={minutes === quick} onPress={() => changeMinutes(String(quick))} />
          ))}
        </View>
        <TextField
          label="Dauer"
          hideLabel
          kind="number"
          unit="min"
          value={minutesText}
          onChangeText={changeMinutes}
          problem={problems.has('invalidMinutes') ? texts.invalidMinutes : undefined}
        />
      </View>
      <View style={styles.group}>
        {/* Sichtbar beschriftet: Der native Picker auf iOS zeigt nur Datum und Uhrzeit. */}
        <Text variant="label" importantForAccessibility="no">Beginn</Text>
        <DateTimePicker
          label="Beginn"
          mode="datetime"
          value={startAt(now.instant)}
          onChange={(next) => {
            setChosenStart(next);
            solve('futureStart');
          }}
          timeZone={entry?.timeZone ?? now.timeZone}
          maximum={now.instant}
        />
        {problems.has('futureStart') ? <ProblemMessage text={texts.futureStart} /> : null}
      </View>
      <TextField
        label="Kalorien (optional)"
        kind="number"
        unit="kcal"
        value={kcalText}
        onChangeText={(text) => {
          setKcalText(text);
          solve('invalidKcal');
        }}
        hint="wird nur angezeigt"
        problem={problems.has('invalidKcal') ? texts.invalidKcal : undefined}
      />
      <Button label="Speichern" block onPress={save} />
      {entry !== undefined ? <Button variant="text" label="Löschen" block onPress={() => run(() => trackers.deleteSport(entry.id))} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space[4] },
  group: { gap: space[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
