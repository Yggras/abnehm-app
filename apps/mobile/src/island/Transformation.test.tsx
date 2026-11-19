/**
 * @jest-environment ./jest/skia-environment.js
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import './testing/real-reanimated';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { color } from '../design';
import { routeScreen } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { appGameService } from './app-game-service';
import { MomoTab } from './MomoTab';
import { IslandHost, testScreen } from './testing/island-host';
import { createLaichkugelWorld, type LaichkugelWorld } from './testing/laichkugel-world';
import type * as mockSkia from './testing/skia-mock';

// Nachweis für #204 an der Oberfläche: die Verwandlungsszene im Tab „Momo“ (Spezifikation 4, Abschnitt 6). Die
// Insel zeichnet der echte Skia-Code (CanvasKit) mit dem echten Reanimated; geprüft wird an der Zeichnung, ob über
// der Schilfwiese Nebel liegt. Ein Pull hebt die Insel auf Level 4 und bringt das Gebiet.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
beforeEach(() => jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  jest.useRealTimers();
});

/**
 * Nebel im Canvas: Pfade in `surface-card` aus Rauten und Wolken (`fogPath` zeichnet die Wolken als Bögen), wie ihn
 * das Szenenmodell über gesperrte und eben freigeschaltete Gebiete legt. Wellen sind Kurven, die Auswahl ist eine Raute.
 */
const fog = () =>
  screen.container.queryAll((node) => node.type === 'skPath' && node.props.color === color.surfaceCard && String(node.props.path).includes(' a'));

async function openTab(arrange: (world: LaichkugelWorld) => void = () => {}) {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  world.couple();
  world.hatch();
  world.game.takeGrowthIntro();
  arrange(world);
  cleanups.push(appGameService.opened(world.game));
  const Layout = () => (
    <IslandHost clock={clock}>
      <MessageHostProvider>
        <Slot />
      </MessageHostProvider>
    </IslandHost>
  );
  await renderRouter({ _layout: Layout, index: () => null, momo: routeScreen('momo', MomoTab) }, { initialUrl: '/momo' });
  await fireEvent(screen.getByTestId('insel'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...testScreen } } });
  return world;
}

test('Tracer: Kommt Level 4 per Pull, während der Tab offen ist, verwandelt sich Momo, und der Nebel zieht von der Schilfwiese ab', async () => {
  const world = await openTab();
  // Vor Level 4 liegt die Schilfwiese unter Nebel.
  expect(fog()).toHaveLength(1);

  await act(() => {
    world.pullProgress(4, [2, 3, 4]);
    world.areaOnServer(4);
  });

  // Die Schilfwiese ist freigeschaltet; über ihr liegt der Nebel, der gleich abzieht.
  expect(screen.getByRole('image', { name: 'Momos Insel, Level 4, 0 eigene Objekte' })).toBeOnTheScreen();
  expect(fog()).toHaveLength(1);

  // Überblendung und Abziehen dauern je `duration-celebrate`; danach ist der Nebel weg.
  await act(() => jest.advanceTimersByTime(2 * 1200));
  expect(fog()).toHaveLength(0);
});

test('beim nächsten Öffnen nach einem Pull im Hintergrund kommt die Verwandlung genau einmal', async () => {
  const world = await openTab();
  await act(() => router.replace('/'));
  await act(() => {
    world.pullProgress(4, [2, 3, 4]);
    world.areaOnServer(4);
  });

  await act(() => router.replace('/momo'));
  await fireEvent(screen.getByTestId('insel'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...testScreen } } });
  expect(fog()).toHaveLength(1);
  await act(() => jest.advanceTimersByTime(2 * 1200));
  expect(fog()).toHaveLength(0);

  await act(() => router.replace('/'));
  await act(() => router.replace('/momo'));
  expect(fog()).toHaveLength(0);
});

test('ohne gemerktes Level zeigt der Tab die Insel still im aktuellen Stand, ohne Nebel über der Schilfwiese', async () => {
  await openTab((world) => {
    world.pullProgress(4, [2, 3, 4]);
    world.areaOnServer(4);
  });

  expect(screen.getByRole('image', { name: 'Momos Insel, Level 4, 0 eigene Objekte' })).toBeOnTheScreen();
  expect(fog()).toHaveLength(0);
});
