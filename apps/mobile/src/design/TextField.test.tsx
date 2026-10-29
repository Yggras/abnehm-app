import { render, screen, userEvent } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';

import { TextField } from './TextField';
import { size } from './tokens';

// Eingabefeld des Design-Systems (Komponente „Eingabefeld“: Zahl mit Einheit, Text; #175).

test('Zahl mit Einheit: Beschriftung und Einheit sind Teil des zugänglichen Namens', async () => {
  await render(<TextField label="Gewicht" unit="kg" value="82,4" onChangeText={jest.fn()} keyboardType="decimal-pad" />);

  const field = screen.getByLabelText('Gewicht in kg');
  expect(field).toHaveDisplayValue('82,4');
  expect(field.props.keyboardType).toBe('decimal-pad');
  expect(screen.getByText('Gewicht')).toBeOnTheScreen();
  expect(screen.getByText('kg')).toBeOnTheScreen();
});

test('meldet jede Eingabe', async () => {
  const onChangeText = jest.fn();
  await render(<TextField label="Gewicht" unit="kg" value="" onChangeText={onChangeText} />);

  await userEvent.type(screen.getByLabelText('Gewicht in kg'), '8');

  expect(onChangeText).toHaveBeenLastCalledWith('8');
});

test('zeigt eine ungültige Eingabe als Satz mit Lösungsweg unter dem Feld', async () => {
  await render(<TextField label="Gewicht" unit="kg" value="12" onChangeText={jest.fn()} error="Bitte 20,0 bis 350,0 kg eingeben." />);

  expect(screen.getByText('Bitte 20,0 bis 350,0 kg eingeben.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Gewicht in kg').props.accessibilityHint).toBe('Bitte 20,0 bis 350,0 kg eingeben.');
});

test('hat die Feldhöhe des Design-Systems', async () => {
  await render(<TextField label="Name" value="" onChangeText={jest.fn()} />);

  const style = StyleSheet.flatten(screen.getByTestId('text-field-frame').props.style) as TextStyle;
  expect(style.minHeight).toBe(size.fieldHeight);
});
