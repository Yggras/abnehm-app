/**
 * @jest-environment ./jest/skia-environment.js
 */
import { act, fireEvent, screen, userEvent, within } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import './testing/real-reanimated';
import { BackHandler } from 'react-native';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { color } from '../design';
import { withDeviceConfig } from '../design/testing/device-config';
import { hitArea } from '../design/testing/hit-area';
import { routeScreen } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { appGameService } from './app-game-service';
import { MomoTab } from './MomoTab';
import { IslandHost, testScreen } from './testing/island-host';
import { createLaichkugelWorld, type LaichkugelWorld } from './testing/laichkugel-world';
import type * as mockSkia from './testing/skia-mock';

// Nachweis für #192: Bau-Sheet und Bau-Modus im Tab „Momo“ auf echter SQLite mit dem echten Spieldienst
// (Spezifikation 4, Abschnitt 7). Philipp hat Bauen, also Seite a der Grundinsel: Ecke x 0–3 und y 0–4,
// Rollenbereich unter anderem x 0–5 und y 5–9. Die Insel zeichnet der echte Skia-Code (CanvasKit), das
// native Sheet ersetzt der Test-Adapter `inline-sheet`.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const user = userEvent.setup();
const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Bildschirmpunkt der Mitte eines Felds der Grundinsel am Start: Feld (0, 0) mit seiner Mitte (0, 16)
 * liegt bei (184, 168); siehe `IslandView.test.tsx`. Die Feldmitte von (x, y) liegt im Szenenraum bei
 * ((x − y) · 32, (x + y) · 16 + 16).
 */
const fieldOnScreen = (x: number, y: number) => ({ x: (x - y) * 32 + 184, y: (x + y) * 16 + 16 + 152 });
const ownCorner = fieldOnScreen(2, 2);
const ownRoleArea = fieldOnScreen(4, 6);
const clearing = fieldOnScreen(8, 6);

async function openIsland(energy: number) {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  world.couple();
  world.hatch();
  world.credit(energy);
  // „So wächst Momo“ hat Philipp schon gesehen.
  world.game.takeGrowthIntro();
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

async function tap({ x, y }: { x: number; y: number }) {
  await act(() => {
    const controller = createGestureController('insel-tippen');
    controller.begin({ x, y });
    controller.activate({ x, y });
    controller.end({ x, y });
  });
}

const builds = (world: LaichkugelWorld) =>
  world.operations().flatMap((operation) => (operation.type === 'buildObject' ? [operation.payload] : []));
/** Felder, die im Canvas in `island-buildable` leuchten. */
const glowing = () => screen.container.queryAll((node) => node.type === 'skPath' && node.props.color === color.islandBuildable);
const ownHalf = () => screen.getByRole('progressbar', { name: 'Level 1' }).props.accessibilityValue.text;
const tooSmall = () => screen.getAllByRole('button').map(hitArea).filter((area) => area.width < 48 || area.height < 48);

test('Tracer Bullet: über „Bauen“ eine Laterne wählen, ein leuchtendes Feld antippen; die Laterne steht, die eigene Hälfte wächst', async () => {
  const world = await openIsland(3);
  expect(ownHalf()).toBe('Deine Hälfte zu 0 Prozent gefüllt');

  await user.press(screen.getByRole('button', { name: 'Bauen' }));
  expect(screen.getByRole('header', { name: 'Bauen' })).toBeOnTheScreen();
  expect(screen.getByText('Du hast 3 Energie')).toBeOnTheScreen();
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel).filter((label) => label.includes('Energie'))).toEqual([
    'Holzweg, 1 Energie',
    'Sitzbank, 2 Energie',
    'Laterne, 3 Energie',
    'Blumenwiese, 1 Energie',
    'Beerenstrauch, 2 Energie',
    'Apfelbaum, 3 Energie',
  ]);

  await user.press(screen.getByRole('button', { name: 'Laterne, 3 Energie' }));

  // Bau-Modus: Das Sheet ist zu, die Leiste sagt, was gebaut wird; alle 60 freien eigenen Felder leuchten.
  expect(screen.queryByTestId('sheet')).toBeNull();
  expect(screen.getByText('Laterne bauen')).toBeOnTheScreen();
  expect(screen.getByText('Tippe auf ein leuchtendes Feld.')).toBeOnTheScreen();
  expect(glowing()).toHaveLength(60);

  await tap(ownRoleArea);

  expect(builds(world)).toEqual([expect.objectContaining({ blueprintKey: 'laterne' })]);
  expect(glowing()).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Bauen' })).toBeOnTheScreen();
  expect(screen.getByRole('image', { name: 'Momos Insel, Level 1, 1 eigene Objekte' })).toBeOnTheScreen();
  expect(screen.getByLabelText('0 Energie')).toBeOnTheScreen();
  // Bedarf(1) = 11: 3 von 11 sind 27 Prozent, abgerundet.
  expect(ownHalf()).toBe('Deine Hälfte zu 27 Prozent gefüllt');
});

test('die Baupläne stehen in einer scrollenden Liste, damit auf kleinen Bildschirmen und bei großer Schrift keiner verdeckt ist', async () => {
  await openIsland(3);
  await user.press(screen.getByRole('button', { name: 'Bauen' }));

  // Im Emulator `medium_phone` öffnete das Sheet halb hoch, Beerenstrauch und Apfelbaum lagen darunter
  // (Gerätelauf zu #192); die Liste scrollt deshalb in einem Sheet in voller Höhe.
  const list = screen.getByTestId('bauplaene');
  expect(list.type).toBe('RCTScrollView');
  expect(within(list).getByRole('button', { name: 'Apfelbaum, 3 Energie' })).toBeOnTheScreen();
});

test('ein Bauplan der anderen Rolle leuchtet nur in der eigenen Ecke; Tipps auf andere Felder bauen nicht', async () => {
  const world = await openIsland(3);
  await user.press(screen.getByRole('button', { name: 'Bauen' }));
  await user.press(screen.getByRole('button', { name: 'Apfelbaum, 3 Energie' }));

  expect(glowing()).toHaveLength(20);
  await tap(ownRoleArea);
  await tap(clearing);
  expect(builds(world)).toEqual([]);
  expect(screen.getByText('Apfelbaum bauen')).toBeOnTheScreen();

  await tap(ownCorner);
  expect(builds(world)).toEqual([expect.objectContaining({ blueprintKey: 'apfelbaum' })]);
});

test('ein freies eigenes Feld antippen: Das Sheet zeigt, was dort passt; zu Teures sagt neutral, was fehlt, und die Wahl baut sofort', async () => {
  const world = await openIsland(1);

  await tap(ownRoleArea);
  expect(screen.getByRole('header', { name: 'Auf dieses Feld bauen' })).toBeOnTheScreen();
  // Im Rollenbereich nur Baupläne der eigenen Rolle.
  expect(screen.getByRole('button', { name: 'Holzweg, 1 Energie' })).toBeEnabled();
  expect(screen.getByText('Noch 1 Energie')).toBeOnTheScreen();
  expect(screen.getByText('Noch 2 Energie')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Laterne, 3 Energie, Noch 2 Energie' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /Apfelbaum/ })).toBeNull();

  // Zu teuer lässt sich nicht wählen.
  await user.press(screen.getByRole('button', { name: 'Laterne, 3 Energie, Noch 2 Energie' }));
  expect(builds(world)).toEqual([]);

  await user.press(screen.getByRole('button', { name: 'Holzweg, 1 Energie' }));
  expect(screen.queryByTestId('sheet')).toBeNull();
  expect(builds(world)).toEqual([expect.objectContaining({ blueprintKey: 'holzweg' })]);
  expect(screen.getByRole('image', { name: 'Momos Insel, Level 1, 1 eigene Objekte' })).toBeOnTheScreen();
});

test('die eigene Ecke bietet alle freigeschalteten Baupläne an; ein bebautes Feld und die Lichtung öffnen kein Bau-Sheet', async () => {
  await openIsland(3);

  await tap(ownCorner);
  expect(screen.getAllByRole('button', { name: /Energie$/ })).toHaveLength(6);
  await user.press(screen.getByRole('button', { name: 'Holzweg, 1 Energie' }));

  await tap(ownCorner);
  expect(screen.queryByTestId('sheet')).toBeNull();
  await tap(clearing);
  expect(screen.queryByTestId('sheet')).toBeNull();
});

test('Abbrechen geht jederzeit: im Sheet durch Schließen, im Bau-Modus über die Leiste', async () => {
  const world = await openIsland(3);
  await user.press(screen.getByRole('button', { name: 'Bauen' }));
  await user.press(screen.getByRole('button', { name: 'Laterne, 3 Energie' }));

  await user.press(screen.getByRole('button', { name: 'Abbrechen' }));

  expect(screen.queryByText('Laterne bauen')).toBeNull();
  expect(glowing()).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Bauen' })).toBeOnTheScreen();
  // Ein Tipp auf ein freies eigenes Feld baut nun nicht, er öffnet wieder das Sheet.
  await tap(ownRoleArea);
  expect(screen.getByRole('header', { name: 'Auf dieses Feld bauen' })).toBeOnTheScreen();
  expect(builds(world)).toEqual([]);
});

describe('System-Zurück (Impeccable-Prüfung, B11)', () => {
  /** Löst System-Zurück aus wie Android: Der zuletzt angemeldete Handler kommt zuerst. */
  async function pressBack(spy: jest.SpyInstance): Promise<boolean> {
    const handlers = spy.mock.calls.map(([, handler]) => handler as () => boolean);
    const removed = new Set(spy.mock.results.flatMap((result, index) => ((result.value as { removed?: boolean }).removed ? [index] : [])));
    const active = handlers.filter((_, index) => !removed.has(index));
    let handled = false;
    await act(async () => {
      handled = active.reverse().some((handler) => handler() === true);
    });
    return handled;
  }

  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation(() => {
      const subscription = { removed: false, remove: () => (subscription.removed = true) };
      return subscription;
    });
  });
  afterEach(() => spy.mockRestore());

  const active = () => spy.mock.results.filter((result) => !(result.value as { removed: boolean }).removed).length;

  test('beendet zuerst den Bau-Modus, dann ein offenes Sheet; erst danach greift die normale Navigation', async () => {
    await openIsland(3);
    // Was ohne Bau-Modus und Sheet zuhört, etwa die Navigation.
    const navigation = active();
    await user.press(screen.getByRole('button', { name: 'Bauen' }));
    await user.press(screen.getByRole('button', { name: 'Laterne, 3 Energie' }));

    expect(await pressBack(spy)).toBe(true);
    expect(screen.queryByText('Laterne bauen')).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Bauen' }));
    expect(await pressBack(spy)).toBe(true);
    expect(screen.queryByTestId('sheet')).toBeNull();

    // Ohne Bau-Modus und Sheet hält die Insel System-Zurück nicht mehr auf; es geht an die Navigation.
    expect(active()).toBe(navigation);
  });
});

test('die Route `momo` mit `view: bauen` öffnet das Bau-Sheet, auch ein zweites Mal', async () => {
  await openIsland(3);

  await act(() => router.navigate({ pathname: '/momo', params: { view: 'bauen' } }));
  expect(screen.getByRole('header', { name: 'Bauen' })).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Laterne, 3 Energie' }));
  await user.press(screen.getByRole('button', { name: 'Abbrechen' }));

  await act(() => router.navigate({ pathname: '/momo', params: { view: 'bauen' } }));
  expect(screen.getByRole('header', { name: 'Bauen' })).toBeOnTheScreen();
});

test('wer den Tab verlässt, bricht den Bau-Modus ab', async () => {
  await openIsland(3);
  await user.press(screen.getByRole('button', { name: 'Bauen' }));
  await user.press(screen.getByRole('button', { name: 'Laterne, 3 Energie' }));

  await act(() => router.replace('/'));
  await act(() => router.replace('/momo'));
  await fireEvent(screen.getByTestId('insel'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...testScreen } } });

  expect(screen.queryByText('Laterne bauen')).toBeNull();
  expect(glowing()).toHaveLength(0);
});

test('Bau-Sheet und Bau-Leiste: jedes Bedienelement hat mindestens 48 × 48 dp', async () => {
  await openIsland(1);
  await user.press(screen.getByRole('button', { name: 'Bauen' }));
  expect(tooSmall()).toEqual([]);

  await user.press(screen.getByRole('button', { name: 'Holzweg, 1 Energie' }));
  expect(tooSmall()).toEqual([]);
});

describe('Schriftfaktor 2,0', () => {
  withDeviceConfig('schriftfaktor-2');

  test('Bau-Sheet und Bau-Leiste bleiben vollständig bedienbar', async () => {
    const world = await openIsland(3);
    await user.press(screen.getByRole('button', { name: 'Bauen' }));
    expect(screen.getByText('Du hast 3 Energie')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Laterne, 3 Energie' }));
    expect(screen.getByText('Laterne bauen')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeOnTheScreen();

    await tap(ownRoleArea);
    expect(builds(world)).toHaveLength(1);
  });
});

describe('reduzierte Bewegung', () => {
  withDeviceConfig('reduzierte-bewegung');

  test('der Bau gelingt genauso; die Felder leuchten ruhig, und das Objekt steht', async () => {
    const world = await openIsland(3);
    await user.press(screen.getByRole('button', { name: 'Bauen' }));
    await user.press(screen.getByRole('button', { name: 'Laterne, 3 Energie' }));
    expect(glowing()).toHaveLength(60);

    await tap(ownRoleArea);

    expect(builds(world)).toHaveLength(1);
    expect(screen.getByRole('image', { name: 'Momos Insel, Level 1, 1 eigene Objekte' })).toBeOnTheScreen();
    expect(ownHalf()).toBe('Deine Hälfte zu 27 Prozent gefüllt');
  });
});
