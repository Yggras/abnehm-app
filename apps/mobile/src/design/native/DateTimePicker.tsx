import NativeDateTimePicker from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Instant, type TimeZone } from '@abnehm/contracts/base';

import { Button } from '../Button';
import { color, space } from '../tokens';

type Part = 'date' | 'time';

export type DateTimePickerProps = {
  /** Was gewählt wird, etwa „Datum“ oder „Uhrzeit“; Name für Screenreader. */
  label: string;
  /** Gewählter Zeitpunkt. */
  value: Instant;
  onChange: (value: Instant) => void;
  /** `date` für Tage, `time` für Uhrzeiten, `datetime` für beides. */
  mode: Part | 'datetime';
  /** Zone, in der die Person den Zeitpunkt sieht; in der Regel `reading.timeZone` der Uhr. */
  timeZone: TimeZone;
  minimum?: Instant;
  maximum?: Instant;
  disabled?: boolean;
};

const toDate = (instant: Instant) => new Date(instant);
const toInstant = (date: Date) => Instant.parse(date.toISOString());

const formats: Record<Part, Intl.DateTimeFormatOptions> = {
  date: { day: '2-digit', month: '2-digit', year: 'numeric' },
  time: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
};

/**
 * Nativer Datum-/Uhrzeit-Picker über `@expo/ui`
 * (https://docs.expo.dev/versions/v58.0.0/sdk/ui/drop-in-replacements/datetimepicker/). Er arbeitet
 * mit `Instant` statt `Date`, damit Zeitpunkte wie überall aus dem Vertragsmodul kommen.
 *
 * - iOS: der kompakte SwiftUI-`DatePicker`, deutsch, in der Zone der Person.
 * - Android: ein gebrandetes Feld mit dem Wert öffnet den Material-Dialog. Eingebettet stünde ein
 *   ganzer Kalender im Inhalt. Der Dialog folgt der Gerätesprache und -zone, weil `locale` und
 *   `timeZoneName` dort nicht unterstützt sind; `datetime` öffnet Datum und Uhrzeit getrennt.
 */
export function DateTimePicker(props: DateTimePickerProps) {
  if (Platform.OS === 'android') return <AndroidPicker {...props} />;
  const { value, onChange, mode, timeZone, minimum, maximum, disabled } = props;
  return (
    <NativeDateTimePicker
      value={toDate(value)}
      onValueChange={(_event, date) => onChange(toInstant(date))}
      mode={mode}
      display="compact"
      locale="de_DE"
      timeZoneName={timeZone}
      accentColor={color.primary}
      themeVariant="light"
      minimumDate={minimum ? toDate(minimum) : undefined}
      maximumDate={maximum ? toDate(maximum) : undefined}
      disabled={disabled}
    />
  );
}

function AndroidPicker({ label, value, onChange, mode, timeZone, minimum, maximum, disabled }: DateTimePickerProps) {
  const [open, setOpen] = useState<Part | null>(null);
  const parts: Part[] = mode === 'datetime' ? ['date', 'time'] : [mode];
  return (
    <View style={styles.row}>
      {parts.map((part) => {
        const shown = new Intl.DateTimeFormat('de-DE', { ...formats[part], timeZone }).format(toDate(value));
        return (
          <Button
            key={part}
            variant="secondary"
            compact
            label={shown}
            accessibilityLabel={`${label}${parts.length > 1 ? (part === 'date' ? ', Datum' : ', Uhrzeit') : ''}: ${shown}`}
            disabled={disabled}
            onPress={() => setOpen(part)}
          />
        );
      })}
      {open ? (
        <NativeDateTimePicker
          value={toDate(value)}
          mode={open}
          presentation="dialog"
          is24Hour
          accentColor={color.primary}
          minimumDate={minimum ? toDate(minimum) : undefined}
          maximumDate={maximum ? toDate(maximum) : undefined}
          onValueChange={(_event, date) => {
            setOpen(null);
            onChange(toInstant(date));
          }}
          onDismiss={() => setOpen(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
});
