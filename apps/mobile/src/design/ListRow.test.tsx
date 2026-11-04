import { render, screen, userEvent } from '@testing-library/react-native';

import { ListGroup, ListRow } from './ListRow';
import { hitArea } from './testing/hit-area';

// Auswahlzeile für kurze Listen, etwa die Aktivitätsart im Sportformular (#173): Radio mit Zustand und
// Häkchen statt Pfeil, nie nur Farbe.

test('Auswahl: Radio mit Zustand und Häkchen statt Pfeil', async () => {
  await render(
    <ListGroup>
      <ListRow icon="run" title="Laufen" selected onPress={jest.fn()} />
      <ListRow icon="bike" title="Radfahren" selected={false} onPress={jest.fn()} />
    </ListGroup>,
  );

  expect(screen.getByRole('radio', { name: 'Laufen' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Radfahren' })).not.toBeChecked();
  expect(screen.getAllByTestId('icon-check', { includeHiddenElements: true })).toHaveLength(1);
  expect(screen.queryByTestId('icon-chevron', { includeHiddenElements: true })).not.toBeOnTheScreen();
});

test('Auswahl löst aus und hat mindestens 48 × 48 dp', async () => {
  const onPress = jest.fn();
  await render(<ListRow icon="swim" title="Schwimmen" selected={false} onPress={onPress} />);

  const row = screen.getByRole('radio', { name: 'Schwimmen' });
  await userEvent.press(row);

  expect(onPress).toHaveBeenCalledTimes(1);
  expect(hitArea(row).height).toBeGreaterThanOrEqual(48);
  expect(hitArea(row).width).toBeGreaterThanOrEqual(48);
});

test('Navigation bleibt ein Knopf mit Pfeil', async () => {
  await render(<ListRow icon="calendar" title="Wochenplan" onPress={jest.fn()} />);

  expect(screen.getByRole('button', { name: 'Wochenplan' })).toBeOnTheScreen();
  expect(screen.getByTestId('icon-chevron', { includeHiddenElements: true })).toBeOnTheScreen();
});
