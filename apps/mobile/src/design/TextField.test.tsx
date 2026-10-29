import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { TextField, type TextFieldProps } from './TextField';
import { hitArea } from './testing/hit-area';
import { color, textScale } from './tokens';

function Controlled(props: Omit<TextFieldProps, 'value' | 'onChangeText'>) {
  const [value, setValue] = useState('');
  return <TextField {...props} value={value} onChangeText={setValue} />;
}

test('ist über seine sichtbare Beschriftung erreichbar und nimmt Text an', async () => {
  await render(<Controlled label="E-Mail-Adresse" />);

  await userEvent.type(screen.getByLabelText('E-Mail-Adresse'), 'philipp@example.test');

  // Sichtbar über dem Feld; VoiceOver liest die Beschriftung nur als Namen des Felds, nicht zusätzlich als Text.
  expect(screen.getByText('E-Mail-Adresse')).toHaveProp('accessible', false);
  expect(screen.getByLabelText('E-Mail-Adresse')).toHaveDisplayValue('philipp@example.test');
});

test('verbirgt den Satz unter dem Feld auf iOS und Android vor Screenreadern', async () => {
  await render(<TextField label="Passwort" value="" onChangeText={jest.fn()} hint="Mindestens 10 Zeichen" />);

  expect(screen.queryByText('Mindestens 10 Zeichen')).toBeNull();
  // Nächster Vorfahre, der Screenreadern etwas verbirgt; Android liest `importantForAccessibility`, iOS `accessibilityElementsHidden`.
  let note = screen.getByText('Mindestens 10 Zeichen', { includeHiddenElements: true }).parent;
  while (note && note.props.importantForAccessibility === undefined) note = note.parent;
  expect(note).toHaveProp('accessibilityElementsHidden', true);
  expect(note).toHaveProp('importantForAccessibility', 'no-hide-descendants');
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

// Rahmen des Felds: der nächste Vorfahre der Eingabe mit Rahmenfarbe.
function frame(label: string): string | undefined {
  let node = screen.getByLabelText(label).parent;
  while (node && (StyleSheet.flatten(node.props.style) as { borderColor?: string } | undefined)?.borderColor === undefined) node = node.parent;
  return node ? (StyleSheet.flatten(node.props.style) as { borderColor?: string }).borderColor : undefined;
}

test('rahmt eine ungültige Eingabe in `problem` und zeigt das Symbol', async () => {
  await render(<Controlled label="Anzeigename" hint="Den Namen sieht auch dein Partner." problem="Dein Name braucht 1 bis 30 Zeichen." />);

  expect(screen.getByTestId('icon-alert', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(frame('Anzeigename')).toBe(color.problem);
});

test('hebt das fokussierte Feld hervor', async () => {
  await render(<Controlled label="Neues Passwort" />);
  expect(frame('Neues Passwort')).toBe(color.lineStrong);

  await act(() => fireEvent(screen.getByLabelText('Neues Passwort'), 'focus'));
  expect(frame('Neues Passwort')).toBe(color.primary);

  await act(() => fireEvent(screen.getByLabelText('Neues Passwort'), 'blur'));
  expect(frame('Neues Passwort')).toBe(color.lineStrong);
});

test('Passwortfelder ohne Autokorrektur und Großschreibung', async () => {
  await render(<Controlled label="Aktuelles Passwort" secure />);

  expect(screen.getByLabelText('Aktuelles Passwort')).toHaveProp('autoCorrect', false);
  expect(screen.getByLabelText('Aktuelles Passwort')).toHaveProp('autoCapitalize', 'none');
});

test('zeigt ein Passwort auf Wunsch beim Tippen an (NIST SP 800-63B-4, 3.1.1.2)', async () => {
  await render(<Controlled label="Neues Passwort" secure />);

  const show = screen.getByRole('button', { name: 'Passwort anzeigen' });
  expect(hitArea(show)).toEqual({ width: 48, height: 48 });
  await userEvent.press(show);

  expect(screen.getByLabelText('Neues Passwort')).toHaveProp('secureTextEntry', false);
  await userEvent.press(screen.getByRole('button', { name: 'Passwort verbergen' }));
  expect(screen.getByLabelText('Neues Passwort')).toHaveProp('secureTextEntry', true);
});

test('deaktivierte Passwortfelder bieten keinen Schalter und verdecken ein aufgedecktes Passwort', async () => {
  const { rerender } = await render(<TextField label="Passwort" value="geheim" onChangeText={jest.fn()} secure />);
  await userEvent.press(screen.getByRole('button', { name: 'Passwort anzeigen' }));
  expect(screen.getByLabelText('Passwort')).toHaveProp('secureTextEntry', false);

  await rerender(<TextField label="Passwort" value="geheim" onChangeText={jest.fn()} secure disabled />);

  expect(screen.queryByRole('button', { name: 'Passwort verbergen' })).toBeNull();
  expect(screen.getByLabelText('Passwort')).toHaveProp('secureTextEntry', true);
});
