import { TextInput } from 'react-native';

import { Instant } from '@abnehm/contracts/base';

import type { DateTimePickerProps } from '../native/DateTimePicker';

/**
 * Test-Adapter für `DateTimePicker`: ein Textfeld mit dem gewählten Zeitpunkt statt des nativen
 * Pickers aus `@expo/ui`, den Jest nicht zeichnen kann. Ein Test setzt den Zeitpunkt mit
 * `fireEvent.changeText(feld, '2026-10-13T05:30:00.000Z')`. Einbinden mit
 * `jest.mock('…/design/native/DateTimePicker', () => jest.requireActual('…/design/testing/text-date-time-picker'))`.
 */
export function DateTimePicker({ label, value, onChange, disabled }: DateTimePickerProps) {
  return <TextInput accessibilityLabel={label} value={value} editable={!disabled} onChangeText={(text) => onChange(Instant.parse(text))} />;
}
