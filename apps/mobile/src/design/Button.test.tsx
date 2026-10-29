import { render, screen, userEvent } from '@testing-library/react-native';

import { Button, IconButton } from './Button';
import { hitArea } from './testing/hit-area';

test('löst seine Aktion aus und ist als Button mit Beschriftung erreichbar', async () => {
  const onPress = jest.fn();
  await render(<Button label="Speichern" onPress={onPress} />);

  await userEvent.press(screen.getByRole('button', { name: 'Speichern' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('dicht: Die Beschriftung bleibt einzeilig und verkleinert sich, statt im Wort umzubrechen (#175)', async () => {
  await render(<Button label="Eintragen" onPress={jest.fn()} variant="secondary" compact block dense />);

  const label = screen.getByText('Eintragen');
  expect(label.props.numberOfLines).toBe(1);
  expect(label.props.adjustsFontSizeToFit).toBe(true);
});

test('deaktiviert: meldet den Zustand und löst nichts aus', async () => {
  const onPress = jest.fn();
  await render(<Button label="Bauen" onPress={onPress} disabled />);

  const button = screen.getByRole('button', { name: 'Bauen' });
  await userEvent.press(button);

  expect(button).toBeDisabled();
  expect(onPress).not.toHaveBeenCalled();
});

test('lädt: behält die Beschriftung für Screenreader, meldet „beschäftigt“ und löst nichts aus', async () => {
  const onPress = jest.fn();
  await render(<Button label="Anfeuern" onPress={onPress} loading />);

  const button = screen.getByRole('button', { name: 'Anfeuern' });
  await userEvent.press(button);

  expect(button).toBeBusy();
  expect(onPress).not.toHaveBeenCalled();
});

test.each([
  ['Primär', <Button key="p" label="Speichern" onPress={jest.fn()} />],
  ['Sekundär', <Button key="s" label="+250 ml" variant="secondary" onPress={jest.fn()} />],
  ['Text', <Button key="t" label="Ok" variant="text" onPress={jest.fn()} />],
  ['kompakt', <Button key="k" label="+250 ml" variant="secondary" compact onPress={jest.fn()} />],
  ['Icon', <IconButton key="i" icon="gear" accessibilityLabel="Einstellungen" onPress={jest.fn()} />],
])('%s: Trefferfläche mindestens 48 × 48 dp', async (_variant, element) => {
  await render(element);

  const area = hitArea(screen.getByRole('button'));

  expect(area.height).toBeGreaterThanOrEqual(48);
  expect(area.width).toBeGreaterThanOrEqual(48);
});

test('Icon-Button trägt seine Beschriftung für Screenreader', async () => {
  const onPress = jest.fn();
  await render(<IconButton icon="close" accessibilityLabel="Schließen" onPress={onPress} />);

  await userEvent.press(screen.getByRole('button', { name: 'Schließen' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});
