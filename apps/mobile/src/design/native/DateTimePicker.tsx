import NativeDateTimePicker from '@expo/ui/community/datetime-picker';

import { Instant, type TimeZone } from '@abnehm/contracts/base';

import { color } from '../tokens';

export type DateTimePickerProps = {
  /** Gewählter Zeitpunkt. */
  value: Instant;
  onChange: (value: Instant) => void;
  /** `date` für Tage, `time` für Uhrzeiten, `datetime` für beides. */
  mode: 'date' | 'time' | 'datetime';
  /** Zone, in der die Person den Zeitpunkt sieht; in der Regel `reading.timeZone` der Uhr. */
  timeZone: TimeZone;
  minimum?: Instant;
  maximum?: Instant;
  disabled?: boolean;
};

const toDate = (instant: Instant) => new Date(instant);

/**
 * Nativer Datum-/Uhrzeit-Picker über `@expo/ui` (SwiftUI `DatePicker`, Compose `DateTimePicker`),
 * deutsch und im 24-Stunden-Format. Er arbeitet mit `Instant` statt `Date`, damit Zeitpunkte wie
 * überall aus dem Vertragsmodul kommen
 * (https://docs.expo.dev/versions/v58.0.0/sdk/ui/drop-in-replacements/datetimepicker/).
 * Die Zone wirkt nur auf iOS; Android zeigt die Gerätezone (`timeZoneName` ist dort nicht unterstützt).
 */
export function DateTimePicker({ value, onChange, mode, timeZone, minimum, maximum, disabled }: DateTimePickerProps) {
  return (
    <NativeDateTimePicker
      value={toDate(value)}
      onValueChange={(_event, date) => onChange(Instant.parse(date.toISOString()))}
      mode={mode}
      presentation="inline"
      locale="de_DE"
      is24Hour
      timeZoneName={timeZone}
      accentColor={color.primary}
      themeVariant="light"
      minimumDate={minimum ? toDate(minimum) : undefined}
      maximumDate={maximum ? toDate(maximum) : undefined}
      disabled={disabled}
    />
  );
}
