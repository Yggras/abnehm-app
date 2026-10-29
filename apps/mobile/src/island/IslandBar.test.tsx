import { render, screen, userEvent } from '@testing-library/react-native';

import { hitArea } from '../design/testing/hit-area';
import { IslandBar } from './IslandBar';

// Untere Leiste des Tabs „Momo“ (Spezifikation 4, Abschnitt 7): Lager · Projekt · Bauen · Ereignisse
// als Einstiege für die späteren Tickets.

test('vier Einstiege in fester Reihenfolge; jeder meldet seine Ansicht', async () => {
  const onOpen = jest.fn();
  await render(<IslandBar newEvents={0} onOpen={onOpen} />);

  const buttons = screen.getAllByRole('button');
  expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual(['Lager', 'Projekt', 'Bauen', 'Ereignisse']);

  for (const name of ['Lager', 'Projekt', 'Bauen', 'Ereignisse']) await userEvent.press(screen.getByRole('button', { name }));
  expect(onOpen.mock.calls).toEqual([['lager'], ['projekt'], ['bauen'], ['ereignisse']]);
});

test('neue Ereignisse stehen als Zahl am Einstieg „Ereignisse“', async () => {
  await render(<IslandBar newEvents={2} onOpen={jest.fn()} />);

  expect(screen.getByRole('button', { name: 'Ereignisse, 2 neu' })).toBeOnTheScreen();
  expect(screen.getByText('2')).toBeOnTheScreen();
});

test('ohne neue Ereignisse gibt es keine Zahl', async () => {
  await render(<IslandBar newEvents={0} onOpen={jest.fn()} />);

  expect(screen.queryByText('0')).not.toBeOnTheScreen();
});

test('jeder Einstieg hat mindestens 48 × 48 dp Trefferfläche', async () => {
  await render(<IslandBar newEvents={1} onOpen={jest.fn()} />);

  const tooSmall = screen.getAllByRole('button').map(hitArea).filter((area) => area.width < 48 || area.height < 48);
  expect(tooSmall).toEqual([]);
});
