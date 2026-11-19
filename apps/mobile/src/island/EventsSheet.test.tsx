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
  // Neu angekommen, und zugleich ein offener Wunsch ohne Frist.
  expect(section('Neu auf der Insel')).toBeOnTheScreen();
  expect(section('Offene Wünsche')).toBeOnTheScreen();
  expect(screen.getByText('Kein Zeitdruck. Wünsche warten, bis du so weit bist.')).toBeOnTheScreen();
  expect(screen.getAllByText('Igel Ilse ist zu Besuch')).toHaveLength(2);
  expect(screen.getByText('Wünscht sich: Laterne')).toBeOnTheScreen();
  expect(screen.getByText('Bringt den Bauplan Brunnen mit')).toBeOnTheScreen();
  expect(screen.getByText('Wenn du den Bauplan Laterne baust, kannst du die Belohnung abholen.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /Belohnung/ })).toBeNull();
  // Ansehen ist Öffnen; es kostet nichts und geht auch offline.
  expect(commandTypes(world)).toEqual(['markEventsSeen']);

  await act(async () => buildLater(world, 'laterne'));
  await openView('ereignisse');

  // Gesehen: Der Besuch ist nicht mehr neu, der Wunsch steht weiter unter „Offene Wünsche“.
  expect(section('Neu auf der Insel')).toBeNull();
  expect(section('Offene Wünsche')).toBeOnTheScreen();
  expect(screen.getAllByText('Igel Ilse ist zu Besuch')).toHaveLength(1);
  await user.press(screen.getByRole('button', { name: 'Belohnung von Igel Ilse abholen' }));

  // Die Bestätigung steht im Sheet; eine Meldung läge auf dem Gerät dahinter.
  expect(within(screen.getByTestId('sheet')).getByText('Neuer Bauplan: Brunnen')).toBeOnTheScreen();
  expect(screen.getByText('Gerade wartet niemand auf dich. Besucher kommen ab und zu vorbei.')).toBeOnTheScreen();
  expect(commandTypes(world)).toEqual(['markEventsSeen', 'buildObject', 'claimEventReward']);

  // Der neue Bauplan steht sofort im Bau-Sheet.
  await openView('bauen');
  expect(screen.getByText('Brunnen')).toBeOnTheScreen();
});

test('Deko als Belohnung liegt danach im Lager, wenn kein Besucher-Bauplan der Rolle mehr frei ist', async () => {
  await openIslandScreen(clock, cleanups, {
    energy: 5,
    arrange: (w) => {
      w.unlockOnServer(['brunnen', 'vogelhaus', 'wegweiser']);
      w.visitOnServer({ to: 'philipp', n: 1, templateKey: 'fuchs_fridolin', details: sitzbankForMuschel, seen: true });
      buildLater(w, 'sitzbank');
    },
  });

  await openEvents();
  expect(screen.getByText('Bringt Muschel für dein Lager mit')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Belohnung von Fuchs Fridolin abholen' }));

  expect(within(screen.getByTestId('sheet')).getByText('Muschel liegt jetzt in deinem Lager')).toBeOnTheScreen();
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

  expect(screen.getAllByText('Igel Ilse ist zu Besuch').length).toBeGreaterThan(0);
  expect(screen.queryByText('Eule Otto ist zu Besuch')).toBeNull();
  expect(screen.queryByRole('button', { name: /Belohnung/ })).toBeNull();
});

test('Entdeckung (#204): Die Schilfwiese steht unter „Neu auf der Insel“ und „Neue Gebiete“; Philipp holt den Steinfrosch ab, die Baupläne sind schon da', async () => {
  const world = await openIslandScreen(clock, cleanups, {
    energy: 5,
    arrange: (w) => {
      w.pullProgress(4, [2, 3, 4]);
      w.areaOnServer(4);
    },
  });

  await openEvents();

  expect(section('Neu auf der Insel')).toBeOnTheScreen();
  expect(screen.getByText('Neues Gebiet: Schilfwiese')).toBeOnTheScreen();
  expect(section('Neue Gebiete')).toBeOnTheScreen();
  expect(section('Offene Wünsche')).toBeNull();
  expect(screen.getByText('Schilfwiese entdeckt')).toBeOnTheScreen();
  expect(screen.getByText('Neue Baupläne für eure Insel: Steinmauer, Briefkasten, Seerosenteich und Schilfgras')).toBeOnTheScreen();
  expect(screen.getByText('Für dein Lager: Steinfrosch')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Steinfrosch abholen' }));

  expect(within(screen.getByTestId('sheet')).getByText('Steinfrosch liegt jetzt in deinem Lager')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Steinfrosch abholen' })).toBeNull();
  expect(commandTypes(world)).toEqual(['markEventsSeen', 'claimEventReward']);
  await openView('lager');
  expect(within(screen.getByTestId('lager')).getByText('Steinfrosch')).toBeOnTheScreen();
  // Die Entdeckungs-Baupläne kamen mit dem Ereignis; Philipp baut mit Bauen die Steinmauer.
  await openView('bauen');
  expect(screen.getByText('Steinmauer')).toBeOnTheScreen();
});

test('Die Route `momo` mit `view: \'ereignisse\'` öffnet das Sheet; ohne Ereignisse steht dort ein ruhiger Leerzustand', async () => {
  await openIslandScreen(clock, cleanups, { energy: 0 });

  await openView('ereignisse');

  expect(screen.getByRole('header', { name: 'Ereignisse' })).toBeOnTheScreen();
  expect(screen.getByText('Gerade wartet niemand auf dich. Besucher kommen ab und zu vorbei.')).toBeOnTheScreen();
});
