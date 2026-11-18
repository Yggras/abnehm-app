import { act, fireEvent, screen } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import './real-reanimated';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import type { Clock } from '@abnehm/clock';

import { color } from '../../design';
import { routeScreen } from '../../navigation';
import { MessageHostProvider } from '../../shell/MessageHost';
import { appGameService } from '../app-game-service';
import { MomoTab } from '../MomoTab';
import { IslandHost, testScreen } from './island-host';
import { createLaichkugelWorld, type LaichkugelWorld } from './laichkugel-world';

// Tab „Momo“ mit geschlüpfter Insel für RNTL-Tests von Bau-Modus (#192), Objekt-Sheet und Lager (#194): echte
// SQLite, echter Spieldienst und echte Route `momo`. Die Testdatei bindet Skia (CanvasKit) und das
// Inline-Sheet selbst per `jest.mock` ein, denn Jest hebt Mocks nur in der Testdatei an den Anfang. Das
// echte Reanimated lädt dieser Helfer direkt nach `expo-router/testing-library` (`real-reanimated.ts`);
// die Testdatei importiert ihn deshalb vor allem Code unter Test und `real-reanimated` nicht selbst.

/**
 * Bildschirmpunkt der Mitte eines Felds der Grundinsel am Start: Feld (0, 0) mit seiner Mitte (0, 16)
 * liegt bei (184, 168); siehe `IslandView.test.tsx`. Die Feldmitte von (x, y) liegt im Szenenraum bei
 * ((x − y) · 32, (x + y) · 16 + 16).
 */
export const fieldOnScreen = (x: number, y: number) => ({ x: (x - y) * 32 + 184, y: (x + y) * 16 + 16 + 152 });

/**
 * Öffnet den Tab „Momo“ mit geschlüpfter Insel; Philipp hat `energy` Energie und „So wächst Momo“ schon
 * gesehen. `arrange` legt vor dem Öffnen weitere Daten an, etwa Objekte. Räumt über `cleanups` auf.
 */
export async function openIslandScreen(
  clock: Clock,
  cleanups: (() => void)[],
  { energy, arrange }: Readonly<{ energy: number; arrange?: (world: LaichkugelWorld) => void }>,
): Promise<LaichkugelWorld> {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  world.couple();
  world.hatch();
  world.credit(energy);
  world.game.takeGrowthIntro();
  arrange?.(world);
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

/** Ein Tipp auf die Insel an einem Bildschirmpunkt. */
export async function tap({ x, y }: { x: number; y: number }) {
  await act(() => {
    const controller = createGestureController('insel-tippen');
    controller.begin({ x, y });
    controller.activate({ x, y });
    controller.end({ x, y });
  });
}

/** Felder, die im Canvas in `island-buildable` leuchten. */
export const glowing = () => screen.container.queryAll((node) => node.type === 'skPath' && node.props.color === color.islandBuildable);

/** Das hervorgehobene, zuletzt angetippte Feld (Overlay `auswahl` in `surface-card`). */
export const selected = () => screen.container.queryAll((node) => node.type === 'skPath' && node.props.color === color.surfaceCard && node.props.opacity === 0.5);
