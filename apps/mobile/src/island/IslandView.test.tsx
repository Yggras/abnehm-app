/**
 * @jest-environment ./jest/skia-environment.js
 */
import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { contractFixtures } from '@abnehm/contracts/fixtures';
import { IslandProgress, MomoAppearance } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';
import { createGestureController } from 'react-native-gesture-handler/jest-utils';

import { IslandView, type IslandViewProps } from './IslandView';
import { islandLayout } from './layout';
import { IslandHost, testScreen } from './testing/island-host';
import { anna, philipp } from './testing/persons';
import type * as mockSkia from './testing/skia-mock';

// Tracer Bullet von #182: Die Inselansicht zeichnet eine Grundinsel aus den Vertrags-Fixtures mit dem
// echten Skia-Code (CanvasKit, siehe jest/skia-environment.js), ein Tipp trifft das richtige Feld.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());

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
    <IslandHost clock={clock}>
      <IslandView island={island} progress={progress} viewerPersonId={philipp} partnerName="Anna" energy={23} onOpen={jest.fn()} {...overrides} />
    </IslandHost>,
  );
  // Bildschirm 400 × 800: Der Start legt die Mitte der Lichtung in die Mitte des Bildschirms.
  await fireEvent(screen.getByTestId('insel'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, ...testScreen } } });
}

test('zeigt die Grundinsel aus den Vertrags-Fixtures mit HUD und Leiste', async () => {
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

test('Ziehen verschiebt: Nach 100 dp nach links trifft die Bildschirmmitte ein Feld weiter rechts', async () => {
  const onFieldPress = jest.fn();
  await renderIsland({ onFieldPress });

  const pan = createGestureController('insel-ziehen');
  pan.begin();
  pan.activate();
  pan.update({ translationX: -100, translationY: 0 });
  pan.end();
  // Ausschnitt (84, 152): Die Mitte (200, 400) zeigt den Szenenpunkt (116, 248), Feld (9, 5).
  tapAt(200, 400);

  expect(onFieldPress).toHaveBeenCalledWith({ type: 'feld', field: 'grundinsel:9:5', kind: 'lichtung', owner: null });
});

test.each([
  // Zoom 1,5 um die Mitte: Ausschnitt (176, 28); (200, 448) zeigt (16, 280), Feld (9, 8).
  [1.5, 448, 'grundinsel:9:8'],
  // Zoom 10 endet bei 2,0: Ausschnitt (168, −96); (200, 600) zeigt (16, 348), Feld (11, 10).
  // Bei Zoom 3 wäre es Feld (10, 9), bei 10 Feld (8, 8).
  [10, 600, 'grundinsel:11:10'],
])('Pinch um %d zoomt um die Finger und höchstens bis 2,0: ein Tipp bei y = %d trifft %s', async (scale, y, field) => {
  const onFieldPress = jest.fn();
  await renderIsland({ onFieldPress });

  const pinch = createGestureController('insel-zoomen');
  pinch.begin();
  pinch.activate({ scale: 1, focalX: 200, focalY: 400 });
  pinch.update({ scale, focalX: 200, focalY: 400 });
  pinch.end();
  tapAt(200, y);

  expect(onFieldPress).toHaveBeenCalledWith(expect.objectContaining({ field }));
});

test('wird der Canvas höher, etwa wenn die Tab-Leiste über die Insel wechselt, bleibt die Lichtung in der Mitte', async () => {
  const onFieldPress = jest.fn();
  await renderIsland({ onFieldPress });
  // `renderIsland` legt 400 × 800 an; vorher war der Canvas 100 dp niedriger.
  await fireEvent(screen.getByTestId('insel'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 900 } } });

  // Mitte (200, 450) zeigt weiter (16, 248), Feld (8, 7).
  tapAt(200, 450);

  expect(onFieldPress).toHaveBeenCalledWith(expect.objectContaining({ field: 'grundinsel:8:7' }));
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
