import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { hitArea } from './testing/hit-area';
import { TextField, type TextFieldProps } from './TextField';
import { color, textScale } from './tokens';

// Eingabefeld des Design-Systems (research/design-system.md, Komponente „Eingabefeld“): Beschriftung,
// Hinweis und Fehler als Text, nie nur über Farbe; 52 dp hoch und bis Schriftfaktor 2,0 lesbar.

function Field(props: Omit<TextFieldProps, 'value' | 'onChangeText'> & { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? '');
  return <TextField {...props} value={value} onChangeText={setValue} />;
}

const border = (label: string) => (StyleSheet.flatten(screen.getByLabelText(label).props.style) ?? {}) as { borderColor?: string };

test('ist über seine Beschriftung erreichbar und nimmt Text an', async () => {
  await render(<Field label="Anzeigename" hint="Den Namen sieht auch dein Partner." />);

  await userEvent.type(screen.getByLabelText('Anzeigename'), 'Philipp');

  expect(screen.getByLabelText('Anzeigename')).toHaveDisplayValue('Philipp');
  expect(screen.getByText('Den Namen sieht auch dein Partner.')).toBeOnTheScreen();
});

test('zeigt einen Fehler mit Symbol und Satz statt des Hinweises und rahmt in `problem`', async () => {
  await render(<Field label="Anzeigename" hint="Den Namen sieht auch dein Partner." error="Dein Name braucht 1 bis 30 Zeichen." />);

  expect(screen.getByText('Dein Name braucht 1 bis 30 Zeichen.')).toBeOnTheScreen();
  expect(screen.getByTestId('icon-alert', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.queryByText('Den Namen sieht auch dein Partner.')).not.toBeOnTheScreen();
  expect(border('Anzeigename').borderColor).toBe(color.problem);
});

test('hebt das fokussierte Feld hervor', async () => {
  await render(<Field label="Neues Passwort" />);
  expect(border('Neues Passwort').borderColor).toBe(color.lineStrong);

  await act(() => fireEvent(screen.getByLabelText('Neues Passwort'), 'focus'));
  expect(border('Neues Passwort').borderColor).toBe(color.focus);

  await act(() => fireEvent(screen.getByLabelText('Neues Passwort'), 'blur'));
  expect(border('Neues Passwort').borderColor).toBe(color.lineStrong);
});

test('verbirgt Passwörter und ist deaktiviert nicht bearbeitbar', async () => {
  await render(
    <>
      <Field label="Aktuelles Passwort" secure />
      <Field label="E-Mail" initial="philipp@example.test" disabled />
    </>,
  );

  expect(screen.getByLabelText('Aktuelles Passwort').props.secureTextEntry).toBe(true);
  expect(screen.getByLabelText('E-Mail').props.editable).toBe(false);
  expect(screen.getByLabelText('E-Mail')).toBeDisabled();
});

test('zeigt ein Passwort auf Wunsch beim Tippen an (NIST SP 800-63B-4, 3.1.1.2)', async () => {
  await render(<Field label="Neues Passwort" secure />);

  const show = screen.getByRole('button', { name: 'Passwort anzeigen' });
  expect(hitArea(show)).toEqual({ width: 48, height: 48 });
  await userEvent.press(show);

  expect(screen.getByLabelText('Neues Passwort').props.secureTextEntry).toBe(false);
  await userEvent.press(screen.getByRole('button', { name: 'Passwort verbergen' }));
  expect(screen.getByLabelText('Neues Passwort').props.secureTextEntry).toBe(true);
});

test('hat 52 dp Höhe und skaliert bis Schriftfaktor 2,0', async () => {
  await render(<Field label="Anzeigename" hint="Hinweis" />);

  const input = screen.getByLabelText('Anzeigename');
  expect(hitArea(input).height).toBeGreaterThanOrEqual(52);
  expect(input.props.maxFontSizeMultiplier).toBe(textScale.max);
  expect(screen.getByText('Anzeigename').props.maxFontSizeMultiplier).toBe(textScale.max);
});
