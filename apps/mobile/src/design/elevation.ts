import type { BoxShadowValue } from 'react-native';

import { elevation, type ElevationToken, type ShadowLayer } from './tokens';

/**
 * Token-Adapter für die Sockelkante: übersetzt die Elevationen des Design-Systems in
 * React-Native-`boxShadow` ([RN-Doku](https://reactnative.dev/docs/view-style-props#boxshadow)).
 *
 * Das Design-System beschreibt Schatten in Web-Syntax, positives `offsetY` liegt unten. Die
 * RN-Doku nennt positives `offsetY` dagegen „up“ ([BoxShadowValue](https://reactnative.dev/docs/boxshadowvalue)).
 * Welche Richtung auf den Geräten gilt, belegt der Gerätesmoke (Komponentenkatalog, Abschnitt
 * „Sockelkante“). Weicht sie ab, wird nur dieser Faktor korrigiert, nie ein Komponentenstil.
 */
const offsetYDirection = 1;

function toBoxShadow(layers: readonly ShadowLayer[]): BoxShadowValue[] {
  return layers.map((layer) => ({
    offsetX: layer.offsetX,
    offsetY: offsetYDirection * layer.offsetY,
    blurRadius: layer.blur,
    spreadDistance: layer.spread,
    color: layer.color,
  }));
}

/** `boxShadow`-Werte je Elevation, z. B. `{ boxShadow: boxShadow.card }`. */
export const boxShadow = Object.fromEntries(
  Object.entries(elevation).map(([name, layers]) => [name, toBoxShadow(layers)]),
) as Record<ElevationToken, BoxShadowValue[]>;
