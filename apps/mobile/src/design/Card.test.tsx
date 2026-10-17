import { render, screen, userEvent } from '@testing-library/react-native';

import { Card } from './Card';
import { ListGroup, ListRow } from './ListRow';
import { Text } from './Text';

test('eine Standardkarte ist kein Bedienelement', async () => {
  await render(
    <Card>
      <Text>Kalorien</Text>
    </Card>,
  );

  expect(screen.queryByRole('button')).not.toBeOnTheScreen();
});

test('eine antippbare Karte öffnet Details und zeigt den Pfeil', async () => {
  const onPress = jest.fn();
  await render(
    <Card onPress={onPress} accessibilityLabel="Ernährung öffnen">
      <Text>Kalorien</Text>
    </Card>,
  );

  await userEvent.press(screen.getByRole('button', { name: 'Ernährung öffnen' }));

  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('icon-chevron', { includeHiddenElements: true })).toBeOnTheScreen();
});

test('Listenzeilen: Navigation mit Pfeil, deaktivierte Zeile ohne Auslösung', async () => {
  const open = jest.fn();
  const blocked = jest.fn();
  await render(
    <ListGroup>
      <ListRow title="Wochenplan" onPress={open} />
      <ListRow title="Health" subtitle="Braucht Internet" disabled onPress={blocked} />
      <ListRow title="Morgenlauf" subtitle="Ersetzt durch Import" replaced />
    </ListGroup>,
  );

  await userEvent.press(screen.getByRole('button', { name: 'Wochenplan' }));
  await userEvent.press(screen.getByRole('button', { name: 'Health Braucht Internet' }));

  expect(open).toHaveBeenCalledTimes(1);
  expect(blocked).not.toHaveBeenCalled();
  expect(screen.getByText('Ersetzt durch Import')).toBeOnTheScreen();
});
