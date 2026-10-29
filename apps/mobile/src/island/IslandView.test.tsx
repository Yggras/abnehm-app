/**
 * @jest-environment ./jest/skia-environment.js
 */
import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { contractFixtures } from '@abnehm/contracts/fixtures';
import { IslandProgress, MomoAppearance } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ClockProvider } from '../clock/clock-context';
import { IslandView, type IslandViewProps } from './IslandView';
import { islandLayout } from './layout';

// Tracer Bullet von #182: Die Inselansicht zeichnet eine Grundinsel aus den Vertrags-Fixtures mit dem
// echten Skia-Code (CanvasKit, siehe jest/skia-environment.js), ein Tipp trifft das richtige Feld.
jest.mock('@shopify/react-native-skia', () => {
  jest.mock('@shopify/react-native-skia/lib/commonjs/Platform', () => {
    const Noop = () => undefined;
    return { OS: 'web', PixelRatio: 1, requireNativeComponent: Noop, resolveAsset: Noop, findNodeHandle: Noop, NativeModules: Noop, View: Noop };
  });
  jest.mock('@shopify/react-native-skia/lib/commonjs/skia/core/Font', () => ({
    useFont: () => null,
    matchFont: () => null,
    listFontFamilies: () => [],
    useFonts: () => null,
  }));
  return jest.requireActual<{ Mock: (canvasKit: unknown) => unknown }>('@shopify/react-native-skia/lib/commonjs/mock').Mock((globalThis as unknown as { CanvasKit: unknown }).CanvasKit);
});

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const progress = IslandProgress.parse(contractFixtures.island!.IslandProgress!.valid['Level 6, eigene Hälfte voll']);
const momo = MomoAppearance.parse(Object.values(contractFixtures.island!.MomoAppearance!.valid).find((value) => (value as MomoAppearance).stage === 'geschluepft'));
const island = { ...islandLayout(gameCatalog, { sides: { a: philipp, b: anna }, unlockedAreas: [] }), objects: [], momo };
// Mittwoch, 14. Oktober 2026, 14 Uhr in Berlin: Herbst, Tag.
const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });

/** Tipp an einer Stelle des Bildschirms: Beginn, Aktivierung und Ende an derselben Stelle. */
function tapAt(x: number, y: number) {
  const tap = createGestureController('insel-tippen');
  tap.begin({ x, y });
  tap.activate({ x, y });
  tap.end({ x, y });
}

async function renderIsland(overrides: Partial<IslandViewProps> = {}) {
  await render(
    <GestureHandlerRootView>
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 400, height: 800 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } }}>
      <ClockProvider clock={clock}>
      <IslandView
        island={island}
        progress={progress}
        viewerPersonId={philipp}
        partnerName="Anna"
        energy={23}
        newEvents={0}
        onOpen={jest.fn()}
        {...overrides}
      />
      </ClockProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>,
  );
  // Bildschirm 400 × 800: Der Start legt die Mitte der Lichtung in die Mitte des Bildschirms.
  fireEvent(screen.getByTestId('insel'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } });
}

test('zeigt die Fixture-Insel mit HUD und Leiste', async () => {
  await renderIsland();

  expect(screen.getByRole('image', { name: 'Momos Insel, Level 6, 0 eigene Objekte' })).toBeOnTheScreen();
  expect(screen.getByText('Herbst · Tag')).toBeOnTheScreen();
  expect(screen.getByLabelText('23 Energie')).toBeOnTheScreen();
  expect(screen.getByRole('progressbar', { name: 'Level 6' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Bauen' })).toBeOnTheScreen();
});

test('ein Tipp in der Bildschirmmitte trifft die Lichtung, einer weiter oben links die eigene Ecke', async () => {
  const onFieldPress = jest.fn();
  await renderIsland({ onFieldPress });

  // Mitte der Lichtung (Felder 6–9 × 5–9) liegt im Szenenraum bei (16, 248), am Start also bei (200, 400).
  tapAt(200, 400);
  // Feld (0, 0) hat seine Mitte bei (0, 16), am Start also 16 links und 232 über der Bildschirmmitte.
  tapAt(184, 168);

  expect(onFieldPress.mock.calls).toEqual([
    [{ type: 'feld', field: 'grundinsel:8:7', kind: 'lichtung', owner: null }],
    [{ type: 'feld', field: 'grundinsel:0:0', kind: 'ecke', owner: 'self' }],
  ]);
});

test('ein Tipp ins Wasser meldet nichts', async () => {
  const onFieldPress = jest.fn();
  await renderIsland({ onFieldPress });

  tapAt(5, 795);

  expect(onFieldPress).not.toHaveBeenCalled();
});

test('die Leiste öffnet ihre Ansichten', async () => {
  const onOpen = jest.fn();
  await renderIsland({ onOpen });

  await userEvent.press(screen.getByRole('button', { name: 'Bauen' }));

  expect(onOpen).toHaveBeenCalledWith('bauen');
});
