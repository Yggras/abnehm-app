import { render, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';

import { TextField, type TextFieldProps } from './TextField';
import { hitArea } from './testing/hit-area';
import { textScale } from './tokens';

function Controlled(props: Omit<TextFieldProps, 'value' | 'onChangeText'>) {
  const [value, setValue] = useState('');
  return <TextField {...props} value={value} onChangeText={setValue} />;
}

test('ist über seine sichtbare Beschriftung erreichbar und nimmt Text an', async () => {
  await render(<Controlled label="E-Mail-Adresse" />);

  await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), 'philipp@example.test');

  expect(screen.getByText('E-Mail-Adresse')).toBeOnTheScreen();
  expect(screen.getByLabelText('E-Mail-Adresse')).toHaveDisplayValue('philipp@example.test');
});

test('zeigt den Hinweis und ersetzt ihn bei einem Fehler durch den Fehlertext samt Symbol', async () => {
  const { rerender } = await render(<TextField label="Passwort" value="" onChangeText={jest.fn()} hint="Mindestens 10 Zeichen" />);
  // Sichtbar unter dem Feld; Screenreader hören den Satz als Hinweis des Felds, nicht doppelt.
  expect(screen.getByText('Mindestens 10 Zeichen', { includeHiddenElements: true })).toBeOnTheScreen();

  await rerender(<TextField label="Passwort" value="" onChangeText={jest.fn()} hint="Mindestens 10 Zeichen" problem="Dein Passwort braucht mindestens 10 Zeichen." />);

  expect(screen.queryByText('Mindestens 10 Zeichen', { includeHiddenElements: true })).toBeNull();
  expect(screen.getByText('Dein Passwort braucht mindestens 10 Zeichen.', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByLabelText('Passwort')).toHaveProp('accessibilityHint', 'Fehler: Dein Passwort braucht mindestens 10 Zeichen.');
});

test('verdeckte Eingabe für Passwörter', async () => {
  await render(<TextField label="Passwort" value="geheim" onChangeText={jest.fn()} secure />);

  expect(screen.getByLabelText('Passwort')).toHaveProp('secureTextEntry', true);
});

test('deaktiviert: nimmt keine Eingabe an', async () => {
  await render(<TextField label="Anzeigename" value="" onChangeText={jest.fn()} disabled />);

  expect(screen.getByLabelText('Anzeigename')).toHaveProp('editable', false);
});

test('Trefferfläche mindestens 48 dp hoch, Text skaliert bis Faktor 2,0', async () => {
  await render(<TextField label="Anzeigename" value="" onChangeText={jest.fn()} hint="1–30 Zeichen" />);

  const input = screen.getByLabelText('Anzeigename');
  expect(hitArea(input).height).toBeGreaterThanOrEqual(48);
  expect(input).toHaveProp('maxFontSizeMultiplier', textScale.max);
  expect(screen.getByText('Anzeigename')).toHaveProp('maxFontSizeMultiplier', textScale.max);
});
