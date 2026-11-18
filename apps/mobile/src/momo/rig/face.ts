import type { ColorToken } from '../../design';
import type { RigMood } from './clips';
import { arcBand, capsule, ellipse, polygon, star } from './geometry';
import type { RigShape } from './types';

// Das Gesicht ist auf allen Formen gleich (Spezifikation 4, Abschnitt 6); das Manifest setzt es nur an
// seinen Anker. Je Stimmung ein Ausdruck aus Augen, Brauen, Mund und Wangen (Design-System › Momo,
// Tabelle der Stimmungen), dazu die Zeichen über dem Kopf. Koordinaten um die Mitte zwischen den Augen,
// bemessen für den Kopf der Kaulquappe. Maße sind Designwerte aus #187, nicht belegt.

const eyeX = 12;
const sides = [-1, 1] as const;

const cheeks: RigShape[] = sides.map((side) => ({ path: ellipse(side * 19, 6, 4.4, 3.2), tone: 'momoCheek', opacity: 0.55 }));

/** Offene Augen mit weißem Lichtpunkt. */
const openEyes = (r: number): RigShape[] =>
  sides.flatMap((side) => [
    { path: ellipse(side * eyeX, -2, r * 0.86, r), tone: 'ink' as const },
    { path: ellipse(side * eyeX - r * 0.3, -2 - r * 0.4, r * 0.32, r * 0.32), tone: 'licht' as const },
  ]);

/** Lachaugen „^ ^“. */
const laughingEyes: RigShape[] = sides.map((side) => ({ path: arcBand(side * eyeX, 1, 4.6, 3, 200, 340), tone: 'ink' }));

/** Geschlossene Augen „‿ ‿“, ruhig und nie traurig. */
const closedEyes: RigShape[] = sides.map((side) => ({ path: arcBand(side * eyeX, -4, 4.4, 3, 20, 160), tone: 'ink' }));

/** Offener Mund mit Zunge; `width` und `depth` geben die Größe des Lachens. */
const openMouth = (width: number, depth: number): RigShape[] => [
  { path: `M${-width} 3 L${width} 3 A${width} ${depth} 0 0 1 ${-width} 3 Z`, tone: 'ink' },
  { path: ellipse(0, 3 + depth * 0.68, width * 0.5, depth * 0.28), tone: 'momoCheek' },
];

const expressions: Readonly<Record<RigMood, readonly RigShape[]>> = {
  // offene Augen, kleines Lächeln
  zufrieden: [...openEyes(4.2), { path: arcBand(0, 1, 6, 4.6, 30, 150), tone: 'ink' }, ...cheeks],
  // Lachaugen, offener Mund
  freut_sich: [...laughingEyes, ...openMouth(5, 5.5), ...cheeks],
  // großes Lachen
  begeistert: [...laughingEyes, ...openMouth(7.5, 8.5), ...cheeks],
  // große Augen, Brauen hoch
  neugierig: [
    ...openEyes(5.4),
    ...sides.map((side): RigShape => ({ path: arcBand(side * eyeX, -1, 10.5, 9, 240, 300), tone: 'ink' })),
    { path: ellipse(0, 7, 2.2, 2.6), tone: 'ink' },
    ...cheeks,
  ],
  // geschlossene Augen, ruhiger Mund
  doest: [...closedEyes, { path: arcBand(0, 1, 4, 2.8, 40, 140), tone: 'ink' }, ...cheeks],
  // geschlossene Augen, kleiner runder Mund
  schlaeft: [...closedEyes, { path: ellipse(0, 7, 1.6, 1.2), tone: 'ink' }, ...cheeks],
  // In der Laichkugel schläft die Kaulquappe.
  wartet_im_ei: [...closedEyes, { path: ellipse(0, 7, 1.6, 1.2), tone: 'ink' }, ...cheeks],
};

export function expression(mood: RigMood): readonly RigShape[] {
  return expressions[mood];
}

/** Zeichen über dem Kopf in Tokens des Design-Systems; der Mond ist ein Designwert aus #187. */
export type EffectShape = Readonly<{ path: string; tone: Extract<ColorToken, 'energy' | 'hint' | 'inkMuted' | 'islandLamp'> }>;

/** Buchstabe „z“ als Fläche, Kantenlänge `s`. */
function zee(x: number, y: number, s: number): string {
  const t = s * 0.24;
  return polygon([
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + t },
    { x: x + t * 1.4, y: y + s - t },
    { x: x + s, y: y + s - t },
    { x: x + s, y: y + s },
    { x, y: y + s },
    { x, y: y + s - t },
    { x: x + s - t * 1.4, y: y + t },
    { x, y: y + t },
  ]);
}

const effects: Readonly<Record<RigMood, readonly EffectShape[]>> = {
  zufrieden: [],
  freut_sich: [],
  // drei Energie-Funken
  begeistert: [
    { path: star(0, 0, 7, 2.4), tone: 'energy' },
    { path: star(-14, 10, 5, 1.8), tone: 'energy' },
    { path: star(9, 15, 4.5, 1.6), tone: 'energy' },
  ],
  // Fragezeichen in `hint`
  neugierig: [
    { path: arcBand(0, -2, 6, 3, 180, 450), tone: 'hint' },
    { path: capsule({ x: 0, y: 3 }, { x: 0, y: 6 }, 1.5), tone: 'hint' },
    { path: ellipse(0, 10.5, 1.9, 1.9), tone: 'hint' },
  ],
  // „z z“ in `ink-muted`
  doest: [
    { path: zee(-6, 4, 5.5), tone: 'inkMuted' },
    { path: zee(2, -6, 7.5), tone: 'inkMuted' },
  ],
  // kleiner Mond
  schlaeft: [{ path: 'M0 -7 A7 7 0 1 0 6.06 3.5 A8 8 0 0 0 0 -7 Z', tone: 'islandLamp' }],
  wartet_im_ei: [],
};

export function effectsOf(mood: RigMood): readonly EffectShape[] {
  return effects[mood];
}
