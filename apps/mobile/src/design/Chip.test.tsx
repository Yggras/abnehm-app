import { render, screen, userEvent } from '@testing-library/react-native';

import { Chip } from './Chip';
import { hitArea } from './testing/hit-area';

test('Einzelauswahl: Radio mit Zustand und Häkchen, nicht nur Farbe', async () => {
  await render(<Chip label="3 Monate" selection="single" selected onPress={jest.fn()} />);

  expect(screen.getByRole('radio', { name: '3 Monate' })).toBeChecked();
  expect(screen.getByTestId('icon-check', { includeHiddenElements: true })).toBeOnTheScreen();
});

test('Mehrfachauswahl: Checkbox je Option', async () => {
  const onPress = jest.fn();
  await render(<Chip label="Mo" accessibilityLabel="Montag" selection="multiple" selected={false} square onPress={onPress} />);

  const chip = screen.getByRole('checkbox', { name: 'Montag' });
  await userEvent.press(chip);

  expect(chip).not.toBeChecked();
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('Schnellwahl löst direkt aus', async () => {
  const onPress = jest.fn();
  await render(<Chip label="Glas 250 ml" onPress={onPress} />);

  await userEvent.press(screen.getByRole('button', { name: 'Glas 250 ml' }));

  expect(onPress).toHaveBeenCalledTimes(1);
});

test('deaktiviert löst nichts aus', async () => {
  const onPress = jest.fn();
  await render(<Chip label="Alles" selection="single" disabled onPress={onPress} />);

  await userEvent.press(screen.getByRole('radio', { name: 'Alles' }));

  expect(onPress).not.toHaveBeenCalled();
});

test.each([
  ['Pille', <Chip key="p" label="Mo" onPress={jest.fn()} />],
  ['quadratisch', <Chip key="q" label="Mo" square onPress={jest.fn()} />],
])('%s: 36 dp sichtbar, 48 × 48 dp Trefferfläche', async (_shape, element) => {
  await render(element);

  const area = hitArea(screen.getByRole('button'));

  expect(area.height).toBeGreaterThanOrEqual(48);
  expect(area.width).toBeGreaterThanOrEqual(48);
});
