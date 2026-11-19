/**
 * @jest-environment ./jest/skia-environment.js
 */
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import type { VisitorEventDetails } from '@abnehm/contracts/island-records';

import { openIslandScreen } from './testing/island-screen';
import type { LaichkugelWorld } from './testing/laichkugel-world';
import type * as mockSkia from './testing/skia-mock';

// Nachweis für #202: das Sheet „Ereignisse“ im Tab „Momo“ auf echter SQLite mit dem echten Spieldienst
// (Spezifikation 4, Abschnitt 9). Der Besuch liegt lokal, wie ihn der Pull ablegt; Philipp hat Bauen.
// Die Insel zeichnet der echte Skia-Code (CanvasKit), das native Sheet ersetzt der Test-Adapter `inline-sheet`.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const user = userEvent.setup();
const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const laterneForBrunnen: VisitorEventDetails = { wish: { type: 'bauplan_bauen', blueprintKey: 'laterne' }, reward: { type: 'bauplan', key: 'brunnen' } };
const sitzbankForMuschel: VisitorEventDetails = { wish: { type: 'bauplan_bauen', blueprintKey: 'sitzbank' }, reward: { type: 'deko', key: 'muschel' } };

const commandTypes = (world: LaichkugelWorld) => world.operations().flatMap((operation) => ('businessKey' in operation ? [operation.type] : []));
const openEvents = () => user.press(screen.getByRole('button', { name: 'Ereignisse' }));
/** Öffnet eine Ansicht über die Route `momo`, wie eine Aktion auf „Wir“; ein offenes Sheet wechselt den Inhalt. */
const openView = (view: 'ereignisse' | 'bauen' | 'lager') => act(() => router.navigate({ pathname: '/momo', params: { view } }));
const section = (name: string) => screen.queryByRole('header', { name });

/** Philipp baut den gewünschten Bauplan eine Minute nach dem Besuch: Nur Handlungen danach zählen. */
function buildLater(world: LaichkugelWorld, blueprintKey: string) {
  clock.advanceBy(60_000);
  expect(world.game.build({ fieldId: world.fieldId('grundinsel:0:0'), blueprintKey })).toMatchObject({ type: 'gebaut' });
}

afterEach(() => clock.set(Instant.parse('2026-10-14T12:00:00.000Z')));

test('Tracer Bullet: Der neue Besuch steht unter „Neu auf der Insel“; nach dem Bau des Wunschs holt Philipp den Bauplan ab', async () => {
  const world = await openIslandScreen(clock, cleanups, {
    energy: 5,
    arrange: (w) => void w.visitOnServer({ to: 'philipp', n: 1, templateKey: 'igel_ilse', details: laterneForBrunnen }),
  });

  await openEvents();

  expect(screen.getByRole('header', { name: 'Ereignisse' })).toBeOnTheScreen();
  expect(section('Neu auf der Insel')).toBeOnTheScreen();
  expect(section('Offene Wünsche')).toBeNull();
  expect(screen.getByText('Igel Ilse ist zu Besuch')).toBeOnTheScreen();
  expect(screen.getByText('Wünscht sich: Laterne')).toBeOnTheScreen();
  expect(screen.getByText('Bringt den Bauplan Brunnen mit')).toBeOnTheScreen();
  expect(screen.getByText('Wenn du den Bauplan Laterne baust, kannst du die Belohnung abholen.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Belohnung/ })).toBeNull();
  // Ansehen ist Öffnen; es kostet nichts und geht auch offline.
  expect(commandTypes(world)).toEqual(['markEventsSeen']);

  await act(async () => buildLater(world, 'laterne'));
  await openView('ereignisse');

  // Gesehen: Der Wunsch steht jetzt unter „Offene Wünsche“, ohne Frist.
  expect(section('Neu auf der Insel')).toBeNull();
  expect(section('Offene Wünsche')).toBeOnTheScreen();
  expect(screen.getByText('Kein Zeitdruck. Wünsche warten, bis du so weit bist.')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Belohnung von Igel Ilse abholen' }));

  expect(within(screen.getByTestId('message-slot')).getByText('Neuer Bauplan: Brunnen')).toBeOnTheScreen();
  expect(screen.getByText('Gerade wartet niemand auf dich. Besucher kommen ab und zu vorbei.')).toBeOnTheScreen();
  expect(commandTypes(world)).toEqual(['markEventsSeen', 'buildObject', 'claimEventReward']);

  // Der neue Bauplan steht sofort im Bau-Sheet.
  await openView('bauen');
  expect(screen.getByText('Brunnen')).toBeOnTheScreen();
});

test('Deko als Belohnung liegt danach im Lager', async () => {
  await openIslandScreen(clock, cleanups, {
    energy: 5,
    arrange: (w) => {
      w.visitOnServer({ to: 'philipp', n: 1, templateKey: 'fuchs_fridolin', details: sitzbankForMuschel, seen: true });
      buildLater(w, 'sitzbank');
    },
  });

  await openEvents();
  expect(screen.getByText('Bringt Muschel für dein Lager mit')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Belohnung von Fuchs Fridolin abholen' }));

  expect(within(screen.getByTestId('message-slot')).getByText('Muschel liegt jetzt in deinem Lager')).toBeOnTheScreen();
  await openView('lager');
  expect(within(screen.getByTestId('lager')).getByText('Muschel')).toBeOnTheScreen();
});

test('Ein Bau vor dem Besuch zählt nicht; der Besuch der Partnerin erscheint nicht', async () => {
  await openIslandScreen(clock, cleanups, {
    energy: 5,
    arrange: (w) => {
      expect(w.game.build({ fieldId: w.fieldId('grundinsel:0:0'), blueprintKey: 'laterne' })).toMatchObject({ type: 'gebaut' });
      clock.advanceBy(60_000);
      w.visitOnServer({ to: 'philipp', n: 1, templateKey: 'igel_ilse', details: laterneForBrunnen });
      w.visitOnServer({ to: 'anna', n: 2, templateKey: 'eule_otto', details: laterneForBrunnen });
    },
  });

  await openEvents();

  expect(screen.getByText('Igel Ilse ist zu Besuch')).toBeOnTheScreen();
  expect(screen.queryByText('Eule Otto ist zu Besuch')).toBeNull();
  expect(screen.queryByRole('button', { name: /Belohnung/ })).toBeNull();
});

test('Die Route `momo` mit `view: \'ereignisse\'` öffnet das Sheet; ohne Ereignisse steht dort ein ruhiger Leerzustand', async () => {
  await openIslandScreen(clock, cleanups, { energy: 0 });

  await openView('ereignisse');

  expect(screen.getByRole('header', { name: 'Ereignisse' })).toBeOnTheScreen();
  expect(screen.getByText('Gerade wartet niemand auf dich. Besucher kommen ab und zu vorbei.')).toBeOnTheScreen();
});
