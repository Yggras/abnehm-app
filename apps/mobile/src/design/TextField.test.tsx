import { render, screen, userEvent } from '@testing-library/react-native';
import { createRef } from 'react';

import { TextField, type TextFieldInput } from './TextField';

// Eingabefeld des Design-Systems (Komponente „Eingabefeld“: Zahl mit Einheit, Text, Suche).

test('Zahl mit Einheit: Dezimaltastatur, Beschriftung als zugänglicher Name und sichtbare Einheit', async () => {
  await render(<TextField label="Gewicht" kind="number" unit="kg" value="82,4" onChangeText={jest.fn()} />);

  const field = screen.getByLabelText('Gewicht');
  expect(field).toHaveDisplayValue('82,4');
  expect(field.props.keyboardType).toBe('decimal-pad');
  expect(screen.getByText('kg')).toBeOnTheScreen();
});

test('meldet jede Eingabe', async () => {
  const onChangeText = jest.fn();
  await render(<TextField label="Gewicht" kind="number" unit="kg" value="" onChangeText={onChangeText} />);

  await userEvent.type(screen.getByLabelText('Gewicht'), '8');

  expect(onChangeText).toHaveBeenLastCalledWith('8');
});

test('zeigt eine ungültige Eingabe als Satz mit Lösungsweg unter dem Feld', async () => {
  await render(<TextField label="Gewicht" kind="number" unit="kg" value="12" onChangeText={jest.fn()} problem="Bitte 20,0 bis 350,0 kg eingeben." />);

  expect(screen.getByText('Bitte 20,0 bis 350,0 kg eingeben.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Gewicht').props.accessibilityHint).toBe('Bitte 20,0 bis 350,0 kg eingeben.');
});

test('gibt über inputRef das Eingabeelement heraus, etwa zum Fokussieren nach einer Rückfrage (#175)', async () => {
  const inputRef = createRef<TextFieldInput>();
  await render(<TextField label="Gewicht" kind="number" value="" onChangeText={jest.fn()} inputRef={inputRef} />);

  expect(inputRef.current).not.toBeNull();
});
