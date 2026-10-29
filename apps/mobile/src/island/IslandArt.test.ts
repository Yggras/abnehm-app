/**
 * @jest-environment ./jest/skia-environment.js
 */
import { Skia } from '@shopify/react-native-skia';

import { fogPath } from './IslandArt';
import type * as mockSkia from './testing/skia-mock';

// Nebel über gesperrten Gebieten (Design-System › Insel): Raute und Wolke einer Zelle bilden eine
// geschlossene Fläche. Geprüft mit Skia auf CanvasKit, wie der Canvas den Pfad füllt.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());

// Feld (0, −1) bei Zoom 1: obere Ecke (32, −16), Mitte (32, 0); daneben Feld (1, −1).
const cells = [
  [{ x: 32, y: -16 }, { x: 64, y: 0 }, { x: 32, y: 16 }, { x: 0, y: 0 }],
  [{ x: 64, y: 0 }, { x: 96, y: 16 }, { x: 64, y: 32 }, { x: 32, y: 16 }],
];

test('die Wolke deckt die Mitte jeder Zelle ab, auch wo sie sich mit der Raute überlagert', () => {
  const path = Skia.Path.MakeFromSVGString(fogPath(cells))!;

  expect(path.contains(32, 0)).toBe(true);
  expect(path.contains(32, -8)).toBe(true);
  expect(path.contains(64, 16)).toBe(true);
});

test('zwischen benachbarten Wolken bleibt kein Loch', () => {
  const path = Skia.Path.MakeFromSVGString(fogPath(cells))!;

  // Gemeinsame Kante von (0, −1) und (1, −1).
  expect(path.contains(48, 8)).toBe(true);
});
