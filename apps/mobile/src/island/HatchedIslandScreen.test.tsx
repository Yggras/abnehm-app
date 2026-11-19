/**
 * @jest-environment ./jest/skia-environment.js
 */
import { act, fireEvent, screen, userEvent } from '@testing-library/react-native';
import { router, Slot, Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { routeScreen } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { placeholderRoute } from '../shell/Placeholder';
import { appGameService } from './app-game-service';
import { MomoTab } from './MomoTab';
import { IslandHost, testScreen } from './testing/island-host';
import { createLaichkugelWorld, type LaichkugelWorld } from './testing/laichkugel-world';
import type * as mockSkia from './testing/skia-mock';

// Nachweis für #184: Nach dem Schlüpfen zeigt der Tab „Momo“ die echte Insel aus den lokalen Daten über die
// Inselansicht, beim ersten Öffnen einmalig „So wächst Momo“ (Spezifikation 4, Abschnitt 7) und nach einem
// Tipp auf Momo das Momo-Sheet mit Form und Level. Die Insel zeichnet der echte Skia-Code (CanvasKit),
// das native Sheet ersetzt der Test-Adapter `inline-sheet`.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const user = userEvent.setup();
const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const growthSentences = [
  'Tagesziele bringen Energie.',
  'Bauen gibt Energie aus und füllt deine Hälfte.',
  'Sind beide Hälften voll, steigt Momo ein Level.',
];

async function openHatched(arrange: (world: LaichkugelWorld) => void = () => {}) {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  world.couple();
  world.hatch();
  arrange(world);
  cleanups.push(appGameService.opened(world.game));
  const Layout = () => (
    <IslandHost clock={clock}>
      <MessageHostProvider>
        <Slot />
      </MessageHostProvider>
    </IslandHost>
  );
  await renderRouter(
    {
      _layout: Layout,
      index: () => null,
      momo: routeScreen('momo', MomoTab),
      'challenge/propose': placeholderRoute('challenge.propose'),
      'challenge/detail': placeholderRoute('challenge.detail'),
    },
    { initialUrl: '/momo' },
  );
  return world;
}

/** Misst den Canvas wie auf dem Gerät; der Start legt die Mitte der Lichtung in die Mitte des Bildschirms. */
async function layoutIsland() {
  await fireEvent(screen.getByTestId('insel'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...testScreen } } });
}

function tapAt(x: number, y: number) {
  const tap = createGestureController('insel-tippen');
  tap.begin({ x, y });
  tap.activate({ x, y });
  tap.end({ x, y });
}

test('Tracer Bullet: die echte Insel auf Level 1 mit HUD und Leiste; „So wächst Momo“ erscheint beim ersten Öffnen einmalig', async () => {
  await openHatched((world) => world.credit(2));

  expect(screen.getByRole('image', { name: 'Momos Insel, Level 1, 0 eigene Objekte' })).toBeOnTheScreen();
  expect(screen.getByRole('progressbar', { name: 'Level 1' })).toBeOnTheScreen();
  expect(screen.getByLabelText('2 Energie')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'So wächst Momo' })).toBeOnTheScreen();
  for (const sentence of growthSentences) expect(screen.getByText(sentence)).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Verstanden' }));
  expect(screen.queryByRole('header', { name: 'So wächst Momo' })).toBeNull();

  // Gemerkt je Installation: Beim nächsten Öffnen des Tabs erscheint es nicht wieder.
  await act(() => router.replace('/'));
  await act(() => router.replace('/momo'));
  expect(screen.getByRole('image', { name: 'Momos Insel, Level 1, 0 eigene Objekte' })).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: 'So wächst Momo' })).toBeNull();
});

test('Momo antippen öffnet das Momo-Sheet mit Form und Level; dort lässt sich „So wächst Momo“ erneut öffnen', async () => {
  await openHatched();
  await user.press(screen.getByRole('button', { name: 'Verstanden' }));
  await layoutIsland();

  // Momo steht auf der Lichtung (7, 7), am Start bei (184, 392); siehe `IslandView.test.tsx`.
  await act(() => tapAt(184, 392));

  expect(screen.getByRole('header', { name: 'Momo' })).toBeOnTheScreen();
  expect(screen.getByText('Kaulquappe · Level 1')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'So wächst Momo' }));
  expect(screen.getByRole('header', { name: 'So wächst Momo' })).toBeOnTheScreen();
  for (const sentence of growthSentences) expect(screen.getByText(sentence)).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Verstanden' }));
  expect(screen.queryByTestId('sheet')).toBeNull();
});

test('das Momo-Sheet führt zu den Challenges: „Challenge vorschlagen“, mit offenem Vorschlag „Zur Challenge“ (#210)', async () => {
  const world = await openHatched();
  await user.press(screen.getByRole('button', { name: 'Verstanden' }));
  await layoutIsland();
  await act(() => tapAt(184, 392));

  await user.press(screen.getByRole('button', { name: 'Challenge vorschlagen' }));
  expect(screen).toHavePathname('/challenge/propose');
  expect(screen.queryByTestId('sheet')).toBeNull();

  await act(() => router.replace('/momo'));
  const challengeId = world.challengeOnServer('anna', 'gut_getrunken');
  await layoutIsland();
  await act(() => tapAt(184, 392));
  await user.press(screen.getByRole('button', { name: 'Zur Challenge' }));
  expect(screen).toHavePathname('/challenge/detail');
  expect(screen).toHaveSearchParams({ challengeId });
});

test('schlüpft Momo, während die Person einen anderen Bildschirm sieht, erscheint „So wächst Momo“ erst beim Öffnen des Tabs', async () => {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  world.couple();
  cleanups.push(appGameService.opened(world.game));
  const Layout = () => (
    <IslandHost clock={clock}>
      <MessageHostProvider>
        <Stack />
      </MessageHostProvider>
    </IslandHost>
  );
  await renderRouter({ _layout: Layout, index: () => null, momo: routeScreen('momo', MomoTab), wir: () => null }, { initialUrl: '/momo' });
  // Der Tab bleibt gemountet, während die Person „Wir“ ansieht; dort kommt der Pull mit dem Schlüpfen an.
  await act(() => router.push('/wir'));
  await act(() => world.hatch());

  // Auch im verdeckten, aber gemounteten Bildschirm darf das Sheet nicht aufgehen.
  expect(screen.queryByTestId('sheet', { includeHiddenElements: true })).toBeNull();

  await act(() => router.back());
  expect(screen.getByRole('header', { name: 'So wächst Momo' })).toBeOnTheScreen();
});

test('der Levelbalken öffnet „So wächst Momo“ als zweiter Einstieg neben Momo', async () => {
  await openHatched();
  await user.press(screen.getByRole('button', { name: 'Verstanden' }));

  await user.press(screen.getByRole('progressbar', { name: 'Level 1' }));

  expect(screen.getByRole('header', { name: 'So wächst Momo' })).toBeOnTheScreen();
});

test('solange die Insel noch nicht vollständig angekommen ist, lädt der Tab', async () => {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  world.couple();
  // Der Inselfortschritt fehlt noch, etwa zwischen zwei Seiten desselben Pulls.
  world.hatch({ progress: false });
  cleanups.push(appGameService.opened(world.game));
  await renderRouter({ _layout: () => <IslandHost clock={clock}><Slot /></IslandHost>, momo: routeScreen('momo', MomoTab) }, { initialUrl: '/momo' });

  expect(screen.getByText('Momo lädt …')).toBeOnTheScreen();
});
