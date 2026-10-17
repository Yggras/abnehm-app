import type { Insets } from 'react-native';

import { elevation, size, type ElevationToken } from './tokens';

/**
 * Trefferfläche: Bedienelemente kleiner als `touch-min` (48 × 48 dp) erweitern sie mit `hitSlop`
 * ([RN-Doku](https://reactnative.dev/docs/pressable#hitslop)), etwa Chips (36) und kompakte Buttons (44).
 */
export function touchSlop(visibleHeight: number, visibleWidth: number = size.touchMin): Insets {
  const vertical = Math.max(0, (size.touchMin - visibleHeight) / 2);
  const horizontal = Math.max(0, (size.touchMin - visibleWidth) / 2);
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}

/**
 * Gedrückt sinkt ein Element um so viel, wie seine Sockelkante schrumpft (Karte und Primär-Button
 * 4 → 1 dp, also `press-depth`; Sekundär-Button 3 → 1 dp). Die Unterkante bleibt dadurch stehen.
 */
export function pressDepth(resting: ElevationToken, pressed: ElevationToken): number {
  const edge = (token: ElevationToken) => elevation[token][0].offsetY;
  return edge(resting) - edge(pressed);
}
