import type { ArtKey } from '@abnehm/game-rules/catalog';

import type { ColorToken } from '../../design';
import type { Flat } from './types';

// Accessoire-Grafiken (Spezifikation 4, Abschnitt 6; Design-System › Momo-Accessoires). Jedes
// Accessoire ist einmal gezeichnet, höchstens als Hinter- und Vorderteil; das Rig setzt es an den
// Steckplatz der Form und passt es mit Lage, Drehung und Größe aus dem Spielkatalog ein. Es folgt
// derselben Lichtregel wie Momo: rechte Hälfte im Schatten. Kopf-Accessoires nie in `momo-frond`.
// Ursprung ist der Steckplatz: am Kopf der Scheitel, am Hals die Mitte vorn. Maße und Farben sind
// Designwerte aus #187, nicht belegt.

export type AccessoryShape = Flat<ColorToken>;
export type AccessoryArt = Readonly<{ hinten?: readonly AccessoryShape[]; vorn: readonly AccessoryShape[] }>;

/** Muschel, die mit dem Scharnier an der Kette hängt. */
function shell(x: number, y: number, r: number): string {
  return `M${x} ${y - r * 0.4} L${x + r} ${y + r * 0.55} A${r} ${r * 0.9} 0 0 1 ${x - r} ${y + r * 0.55} Z`;
}

const necklace = [-14, -7, 0, 7, 14].map((x) => ({ x, y: 0.02 * x * x }));

export const accessoryArt: Readonly<Record<ArtKey, AccessoryArt>> = {
  strohhuetchen: {
    // Die hintere Krempe liegt hinter dem Kopf, die vordere davor.
    hinten: [{ path: 'M-14 -1 A14 3.6 0 0 1 14 -1 Z', tone: 'islandSand', shade: true }],
    vorn: [
      { path: 'M-14 -1 A14 3.6 0 0 0 14 -1 Z', tone: 'islandSand', shade: true },
      { path: 'M-8 -1 C-8 -12 8 -12 8 -1 Z', tone: 'islandSand', shade: true },
      { path: 'M-8.1 -4.2 L8.1 -4.2 L8.2 -1 L-8.2 -1 Z', tone: 'primary' },
    ],
  },
  muschelkette: {
    vorn: necklace.map(({ x, y }, index) => ({ path: shell(x, y, 3.8), tone: index === 2 ? 'momoCheek' : 'surfaceCard', shade: true })),
  },
};
