import { CommonStage } from '@abnehm/contracts/island';
import type { ArtKey, Stage } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import { opacity, size, type ColorToken } from '../design';

// Grafiken der Inselobjekte (Spezifikation 4, Abschnitt 7; Design-System › Insel). Der Spielkatalog nennt
// je Bauplan die Grafik jeder Stufe nur als Schlüssel (`art`), die App zeichnet sie. Jede Grafik ist eine
// Liste flächiger Grundformen in Inselfarben um die Feldmitte, in dp bei Zoom 1: ohne Konturen und
// Verläufe, zweitönig mit Licht von links oben. Rechte Seiten dunkelt `ink` mit `opacity-shade-right`
// ab, linke mit `opacity-shade-left`, der Schlagschatten fällt nach rechts unten (`opacity-cast-shadow`).
// Objekte stehen mittig auf ihrem Feld und sind höchstens zwei Felder hoch; jede Stufe ist etwas größer
// und hat ein Detail mehr. Als Daten lassen sich diese Regeln prüfen (`art.test.ts`), gezeichnet wird mit
// Skia (`IslandArt.tsx`). Motive und Maße sind Designwerte aus #192, nicht belegt.

export type ArtPoint = Readonly<{ x: number; y: number }>;

/** Farbe einer Grundform; `laub` ist das Laub der Jahreszeit. */
export type ArtTone = ColorToken | 'laub';

export type ArtPrimitive =
  | Readonly<{ type: 'flaeche'; points: readonly ArtPoint[]; tone: ArtTone; opacity?: number }>
  | Readonly<{ type: 'kreis'; x: number; y: number; r: number; tone: ArtTone; opacity?: number }>
  /** Rechte Hälfte eines Kreises, die Schattenseite bei Licht von links oben. */
  | Readonly<{ type: 'halbkreis'; x: number; y: number; r: number; tone: ArtTone; opacity?: number }>
  | Readonly<{ type: 'oval'; x: number; y: number; width: number; height: number; tone: ArtTone; opacity?: number }>;

/** Wie die Inselansicht eine Grafik zeichnet; `light` ist, wo sie abends in `island-lamp` leuchtet. */
export type ArtSpec = Readonly<{ stage: Stage; lit: boolean; light: ArtPoint | null; drawing: readonly ArtPrimitive[] }>;

const tile = size.islandTile;

// --- Bausteine ---------------------------------------------------------------------------------------

/** Schlagschatten nach rechts unten um die Feldmitte; auch Momo steht darauf (`IslandArt.tsx`). */
export function shadow(width: number): ArtPrimitive {
  return { type: 'oval', x: -width / 2 + 4, y: -2, width, height: width / 2.4, tone: 'ink', opacity: opacity.castShadow };
}

/** Quader auf dem Boden: Grundriss eine Raute mit halber Breite `a` um `at`, Höhe `h`. */
function box(at: ArtPoint, a: number, h: number, top: ColorToken, side: ColorToken): ArtPrimitive[] {
  const b = a / 2;
  const { x, y } = at;
  const left = [{ x: x - a, y: y - h }, { x, y: y - h + b }, { x, y: y + b }, { x: x - a, y }];
  const right = [{ x, y: y - h + b }, { x: x + a, y: y - h }, { x: x + a, y }, { x, y: y + b }];
  return [
    { type: 'flaeche', points: left, tone: side },
    { type: 'flaeche', points: left, tone: 'ink', opacity: opacity.shadeLeft },
    { type: 'flaeche', points: right, tone: side },
    { type: 'flaeche', points: right, tone: 'ink', opacity: opacity.shadeRight },
    { type: 'flaeche', points: [{ x, y: y - h - b }, { x: x + a, y: y - h }, { x, y: y - h + b }, { x: x - a, y: y - h }], tone: top },
  ];
}

/** Kugel mit Schattenseite rechts, etwa Laub oder ein Busch. */
function ball(x: number, y: number, r: number, tone: ArtTone): ArtPrimitive[] {
  return [
    { type: 'kreis', x, y, r, tone },
    { type: 'halbkreis', x, y, r, tone: 'ink', opacity: opacity.shadeRight },
  ];
}

function dot(x: number, y: number, r: number, tone: ArtTone): ArtPrimitive {
  return { type: 'kreis', x, y, r, tone };
}

function rect(x: number, y: number, width: number, height: number, tone: ArtTone): ArtPrimitive {
  return { type: 'flaeche', points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], tone };
}

function scaled(drawing: readonly ArtPrimitive[], k: number): ArtPrimitive[] {
  return drawing.map((shape) => {
    switch (shape.type) {
      case 'flaeche':
        return { ...shape, points: shape.points.map(({ x, y }) => ({ x: x * k, y: y * k })) };
      case 'kreis':
      case 'halbkreis':
        return { ...shape, x: shape.x * k, y: shape.y * k, r: shape.r * k };
      case 'oval':
        return { ...shape, x: shape.x * k, y: shape.y * k, width: shape.width * k, height: shape.height * k };
    }
  });
}

// --- Motive ------------------------------------------------------------------------------------------

/** Holzweg: Bohlen flach auf dem Feld; Stufe 2 mit Randsteinen, Stufe 3 mit zwei Pfosten. */
function holzweg(stage: Stage): ArtPrimitive[] {
  const [top, right, bottom, left] = [{ x: 0, y: -11 }, { x: 22, y: 0 }, { x: 0, y: 11 }, { x: -22, y: 0 }];
  const along = (from: ArtPoint, to: ArtPoint, t: number) => ({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  const seam = (t: number): ArtPrimitive => ({
    type: 'flaeche',
    points: [along(left, bottom, t), along(top, right, t), along(top, right, t + 0.06), along(left, bottom, t + 0.06)],
    tone: 'ink',
    opacity: opacity.shadeLeft,
  });
  const drawing: ArtPrimitive[] = [{ type: 'flaeche', points: [top, right, bottom, left], tone: 'islandWood' }, seam(0.3), seam(0.64)];
  if (stage >= 2) drawing.push(dot(-24, 0, 2.5, 'islandStone'), dot(24, 0, 2.5, 'islandStone'));
  if (stage >= 3) drawing.push(...box({ x: -11, y: -5.5 }, 2, 9, 'islandWood', 'islandWood'), ...box({ x: 11, y: -5.5 }, 2, 9, 'islandWood', 'islandWood'));
  return drawing;
}

/** Sitzbank: Lehne und Sitz; Stufe 2 mit Kissen, Stufe 3 mit Blumentopf daneben. */
function sitzbank(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [shadow(tile * 0.4), ...box({ x: -4, y: -3 }, 9, 12, 'islandWood', 'islandWood'), ...box({ x: 0, y: 2 }, 11, 6, 'islandWood', 'islandWood')];
  if (stage >= 2) drawing.push({ type: 'flaeche', points: [{ x: 0, y: -7.5 }, { x: 7, y: -4 }, { x: 0, y: -0.5 }, { x: -7, y: -4 }], tone: 'islandRoof' });
  if (stage >= 3) drawing.push(...box({ x: 14, y: 4 }, 4, 5, 'islandEarth', 'islandRoof'), ...ball(14, -3, 4, 'laub'));
  return drawing;
}

/** Wo die Laterne leuchtet: Mitte ihres Lampenkastens. */
const lanternLight = { x: 0, y: -31 } as const;

/** Laterne: Pfahl mit Lampe; Stufe 2 mit Dach und Sockel, Stufe 3 mit Wimpel. */
function laterne(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [shadow(tile * 0.25)];
  if (stage >= 2) drawing.push(...box({ x: 0, y: 0 }, 4, 3, 'islandStone', 'islandStone'));
  drawing.push(rect(-1.5, -28, 3, 28, 'islandWood'), ...box({ x: 0, y: -27 }, 5, 8, 'islandRoofAlt', 'islandLamp'));
  if (stage >= 2) drawing.push({ type: 'flaeche', points: [{ x: -6, y: -35 }, { x: 0, y: -41 }, { x: 6, y: -35 }], tone: 'islandRoofAlt' });
  if (stage >= 3) drawing.push(rect(-0.75, -48, 1.5, 7, 'islandWood'), { type: 'flaeche', points: [{ x: 0.75, y: -48 }, { x: 9, y: -45.5 }, { x: 0.75, y: -43 }], tone: 'islandRoof' });
  return drawing;
}

/** Blüten der Blumenwiese, flach auf dem Feld. */
const flowers: readonly Readonly<{ x: number; y: number; tone: ColorToken }>[] = [
  { x: -10, y: 0, tone: 'islandLamp' },
  { x: -3, y: -4, tone: 'islandRoof' },
  { x: 5, y: -1, tone: 'surfaceCard' },
  { x: 11, y: 2, tone: 'islandLamp' },
  { x: 0, y: 4, tone: 'islandRoof' },
];
const moreFlowers: readonly Readonly<{ x: number; y: number; tone: ColorToken }>[] = [
  { x: -15, y: 4, tone: 'surfaceCard' },
  { x: 14, y: -3, tone: 'islandRoof' },
  { x: 7, y: 6, tone: 'surfaceCard' },
];

/** Blumenwiese: Blüten mit Blättern; Stufe 2 mit mehr Blüten, Stufe 3 mit einem Schmetterling. */
function blumenwiese(stage: Stage): ArtPrimitive[] {
  const blooms = stage >= 2 ? [...flowers, ...moreFlowers] : flowers;
  const drawing: ArtPrimitive[] = blooms.flatMap(({ x, y, tone }) => [
    { type: 'oval', x: x - 4, y: y + 0.5, width: 5, height: 2.5, tone: 'laub' } as const,
    dot(x, y, 2.5, tone),
  ]);
  if (stage >= 3) {
    drawing.push(
      { type: 'oval', x: -8, y: -21, width: 5, height: 4, tone: 'islandRoofAlt' },
      { type: 'oval', x: -3, y: -21, width: 5, height: 4, tone: 'islandRoofAlt' },
      rect(-3.5, -21.5, 1, 5, 'ink'),
    );
  }
  return drawing;
}

/** Beerenstrauch: Busch mit Beeren; Stufe 2 dichter mit mehr Beeren, Stufe 3 mit Korb voller Beeren. */
function beerenstrauch(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [shadow(tile * 0.4)];
  if (stage >= 2) drawing.push(...ball(0, -13, 7, 'laub'));
  drawing.push(dot(-4, -7, 8, 'laub'), ...ball(5, -6, 7, 'laub'), dot(-6, -9, 1.8, 'islandRoofAlt'), dot(-1, -5, 1.8, 'islandRoofAlt'), dot(6, -8, 1.8, 'islandRoofAlt'));
  if (stage >= 2) drawing.push(dot(2, -14, 1.8, 'islandRoofAlt'), dot(-3, -12, 1.8, 'islandRoofAlt'));
  if (stage >= 3) drawing.push(...box({ x: 13, y: 3 }, 5, 4, 'islandWood', 'islandWood'), dot(12, -2, 1.8, 'islandRoofAlt'), dot(14.5, -1.5, 1.8, 'islandRoofAlt'));
  return drawing;
}

/** Apfelbaum: Stamm und Krone mit Äpfeln; Stufe 2 mit mehr Äpfeln, Stufe 3 mit voller Krone und Fallobst. */
function apfelbaum(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [shadow(tile * 0.45)];
  if (stage >= 3) drawing.push(...ball(-7, -33, 6, 'laub'));
  drawing.push(rect(-2, -18, 4, 18, 'islandEarth'), ...ball(0, -26, 12, 'laub'), dot(-4, -28, 2, 'islandRoof'), dot(5, -23, 2, 'islandRoof'));
  if (stage >= 2) drawing.push(dot(-7, -22, 2, 'islandRoof'), dot(2, -33, 2, 'islandRoof'));
  if (stage >= 3) drawing.push(dot(-8, 3, 2, 'islandRoof'), dot(9, 4, 2, 'islandRoof'));
  return drawing;
}

// --- Besucher-Baupläne (#202) ------------------------------------------------------------------------

/** Brunnen: Steinbecken mit Wasser; Stufe 2 mit zwei Pfosten, Stufe 3 mit Dach. */
function brunnen(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [shadow(tile * 0.45), ...box({ x: 0, y: 0 }, 13, 8, 'islandWater', 'islandStone')];
  if (stage >= 2) drawing.push(rect(-11, -26, 2, 22, 'islandWood'), rect(9, -26, 2, 22, 'islandWood'));
  if (stage >= 3) drawing.push({ type: 'flaeche', points: [{ x: -15, y: -25 }, { x: 0, y: -34 }, { x: 15, y: -25 }], tone: 'islandRoof' });
  return drawing;
}

/** Vogelhaus: Häuschen auf einem Pfahl; Stufe 2 mit Giebeldach, Stufe 3 mit einem Vogel darauf. */
function vogelhaus(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [
    shadow(tile * 0.25),
    rect(-1.5, -22, 3, 22, 'islandWood'),
    ...box({ x: 0, y: -22 }, 7, 9, 'islandRoof', 'islandWood'),
    dot(-3.5, -26, 1.6, 'ink'),
  ];
  if (stage >= 2) drawing.push({ type: 'flaeche', points: [{ x: -9, y: -33 }, { x: 0, y: -39 }, { x: 9, y: -33 }], tone: 'islandRoofAlt' });
  if (stage >= 3) drawing.push(dot(4, -40, 2.5, 'islandLamp'));
  return drawing;
}

/** Wegweiser: Pfosten mit Schild; Stufe 2 mit zweitem Schild, Stufe 3 mit Kieseln am Fuß. */
function wegweiser(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [
    shadow(tile * 0.25),
    rect(-1.5, -28, 3, 28, 'islandWood'),
    { type: 'flaeche', points: [{ x: -8, y: -25 }, { x: 10, y: -25 }, { x: 13, y: -22 }, { x: 10, y: -19 }, { x: -8, y: -19 }], tone: 'islandSand' },
  ];
  if (stage >= 2) {
    drawing.push({ type: 'flaeche', points: [{ x: 8, y: -16 }, { x: -10, y: -16 }, { x: -13, y: -13 }, { x: -10, y: -10 }, { x: 8, y: -10 }], tone: 'islandSand' });
  }
  if (stage >= 3) drawing.push(dot(-6, 1, 2.5, 'islandStone'), dot(6, 2, 2, 'islandStone'));
  return drawing;
}

/** Sonnenblume mit Stiel und Korb, Kopf an (x, y). */
function sunflower(x: number, y: number, r: number): ArtPrimitive[] {
  return [rect(x - 0.75, y, 1.5, -y, 'laub'), dot(x, y, r, 'islandLamp'), dot(x, y, r * 0.4, 'islandEarth')];
}

/** Sonnenblumen: zwei Blumen; Stufe 2 mit Blättern, Stufe 3 mit einer dritten Blume. */
function sonnenblumen(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [];
  if (stage >= 3) drawing.push(...sunflower(0, -14, 4));
  drawing.push(...sunflower(-6, -21, 5), ...sunflower(5, -25, 5));
  if (stage >= 2) {
    drawing.push({ type: 'oval', x: -12, y: -11, width: 6, height: 3, tone: 'laub' }, { type: 'oval', x: 6, y: -13, width: 6, height: 3, tone: 'laub' });
  }
  return drawing;
}

/** Pilz mit Stiel und roter Kappe an (x, y), Größe `k`. */
function mushroom(x: number, y: number, k: number): ArtPrimitive[] {
  return [
    rect(x - k, y - 4 * k, 2 * k, 4 * k, 'surfaceCard'),
    { type: 'oval', x: x - 4 * k, y: y - 6.5 * k, width: 8 * k, height: 4 * k, tone: 'islandRoof' },
    dot(x - 1.5 * k, y - 5.2 * k, 0.8 * k, 'surfaceCard'),
  ];
}

/** Pilzkreis: Pilze im Gras; jede Stufe ein Pilz mehr. */
function pilzkreis(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [...mushroom(-7, -1, 1.1), ...mushroom(6, -3, 1.3)];
  if (stage >= 2) drawing.push(...mushroom(0, 4, 0.9));
  if (stage >= 3) drawing.push(...mushroom(-12, 4, 0.8));
  return drawing;
}

/** Kürbis mit Schattenseite und Stiel an (x, y), Radius r. */
function pumpkin(x: number, y: number, r: number): ArtPrimitive[] {
  return [
    { type: 'oval', x: x - r * 1.2, y: y - r, width: r * 2.4, height: r * 2, tone: 'islandFoliageAutumn' },
    { type: 'halbkreis', x, y, r, tone: 'ink', opacity: opacity.shadeRight },
    rect(x - 0.75, y - r - 2, 1.5, 2.5, 'laub'),
  ];
}

/** Kürbisbeet: Erde mit Kürbissen; jede Stufe ein Kürbis mehr. */
function kuerbisbeet(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [{ type: 'flaeche', points: [{ x: 0, y: -9 }, { x: 18, y: 0 }, { x: 0, y: 9 }, { x: -18, y: 0 }], tone: 'islandEarth' }];
  if (stage >= 3) drawing.push(...pumpkin(2, -5, 3.5));
  drawing.push(...pumpkin(-6, -1, 5));
  if (stage >= 2) drawing.push(...pumpkin(7, 2, 4));
  return drawing;
}

// --- Entdeckungs-Baupläne von Gebiet 1 (#204) --------------------------------------------------------

/** Steinmauer: zwei Steinblöcke; Stufe 2 mit einem Block obenauf, Stufe 3 mit Moos und einer Blüte. */
function steinmauer(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [shadow(tile * 0.5), ...box({ x: -8, y: 0 }, 7, 9, 'islandStone', 'islandStone'), ...box({ x: 8, y: 0 }, 7, 9, 'islandStone', 'islandStone')];
  if (stage >= 2) drawing.push(...box({ x: 0, y: -9 }, 6, 7, 'islandStone', 'islandStone'));
  if (stage >= 3) drawing.push({ type: 'oval', x: -6, y: -20, width: 9, height: 4, tone: 'laub' }, dot(4, -13, 1.8, 'islandRoof'));
  return drawing;
}

/**
 * Briefkasten: ein liegender Kasten mit gewölbtem Deckel und Schlitz auf einem Pfahl, breiter als hoch, damit er
 * sich von der Laterne abhebt (Impeccable-Kritik zu #204); Stufe 2 mit Fähnchen, Stufe 3 mit einem Brief im Schlitz.
 */
function briefkasten(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [
    shadow(tile * 0.3),
    rect(-1.5, -18, 3, 18, 'islandWood'),
    { type: 'oval', x: -10, y: -31, width: 20, height: 8, tone: 'islandRoofAlt' },
    rect(-10, -27, 20, 10, 'islandRoofAlt'),
    { type: 'flaeche', points: [{ x: 0, y: -31 }, { x: 10, y: -31 }, { x: 10, y: -17 }, { x: 0, y: -17 }], tone: 'ink', opacity: opacity.shadeRight },
    rect(-6, -25, 9, 1.5, 'ink'),
  ];
  if (stage >= 2) drawing.push(rect(9, -34, 1.5, 12, 'islandWood'), { type: 'flaeche', points: [{ x: 10.5, y: -34 }, { x: 15, y: -32 }, { x: 10.5, y: -30 }], tone: 'islandRoof' });
  if (stage >= 3) drawing.push({ type: 'flaeche', points: [{ x: -5, y: -29 }, { x: 2, y: -30.5 }, { x: 2.5, y: -25 }, { x: -4.5, y: -24 }], tone: 'surfaceCard' });
  return drawing;
}

/** Seerose auf dem Wasser: ein Blatt mit Kerbe an (x, y). */
function lilyPad(x: number, y: number, width: number): ArtPrimitive[] {
  return [
    { type: 'oval', x: x - width / 2, y: y - width / 4, width, height: width / 2, tone: 'laub' },
    { type: 'flaeche', points: [{ x, y }, { x: x + width / 2, y: y - width / 8 }, { x: x + width / 2, y: y + width / 8 }], tone: 'islandWater' },
  ];
}

/** Seerosenteich: Wasser mit zwei Blättern; Stufe 2 mit zwei Blättern mehr, Stufe 3 mit einer Blüte. */
function seerosenteich(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [
    { type: 'flaeche', points: [{ x: 0, y: -10 }, { x: 20, y: 0 }, { x: 0, y: 10 }, { x: -20, y: 0 }], tone: 'islandWater' },
    { type: 'flaeche', points: [{ x: 0, y: 10 }, { x: 20, y: 0 }, { x: 20, y: 1.5 }, { x: 0, y: 11.5 }], tone: 'islandWaterDeep' },
    ...lilyPad(-8, -1, 8),
    ...lilyPad(5, -4, 7),
  ];
  if (stage >= 2) drawing.push(...lilyPad(-1, 4, 6), ...lilyPad(10, 2, 6));
  if (stage >= 3) drawing.push(dot(5, -5, 2.4, 'islandRoof'), dot(5, -5, 1, 'islandLamp'));
  return drawing;
}

/** Ein Halm Schilf mit Kolben an der Spitze, Fuß bei x, `h` hoch. */
function reed(x: number, h: number): ArtPrimitive[] {
  return [rect(x - 0.75, -h, 1.5, h, 'laub'), { type: 'oval', x: x - 1.6, y: -h + 1, width: 3.2, height: 7, tone: 'islandEarth' }];
}

/** Schilfgras: drei Halme; Stufe 2 mit zwei Halmen mehr, Stufe 3 mit zwei weiteren und Blättern am Fuß. */
function schilfgras(stage: Stage): ArtPrimitive[] {
  const drawing: ArtPrimitive[] = [shadow(tile * 0.3), ...reed(-4, 24), ...reed(1, 30), ...reed(6, 22)];
  if (stage >= 2) drawing.push(...reed(-9, 18), ...reed(10, 26));
  if (stage >= 3) drawing.push(...reed(-1, 16), ...reed(13, 15), { type: 'oval', x: -10, y: -4, width: 8, height: 3, tone: 'laub' }, { type: 'oval', x: 3, y: -3, width: 8, height: 3, tone: 'laub' });
  return drawing;
}

// --- Besucher-Deko (#202) ----------------------------------------------------------------------------

/** Deko je Grafikschlüssel; flach und klein, sie steht wie ein Objekt mittig auf ihrem Feld. */
const decorations: Readonly<Record<string, () => ArtPrimitive[]>> = {
  muschel: () => [
    shadow(16),
    { type: 'flaeche', points: [{ x: -8, y: 0 }, { x: -6, y: -8 }, { x: 0, y: -10 }, { x: 6, y: -8 }, { x: 8, y: 0 }, { x: 0, y: 2 }], tone: 'islandSand' },
    { type: 'flaeche', points: [{ x: -0.6, y: -9 }, { x: 0.6, y: -9 }, { x: 0.6, y: 1 }, { x: -0.6, y: 1 }], tone: 'ink', opacity: opacity.shadeRight },
    { type: 'flaeche', points: [{ x: -4.5, y: -7.5 }, { x: -3.5, y: -7.5 }, { x: -1, y: 1 }, { x: -2, y: 1 }], tone: 'ink', opacity: opacity.shadeLeft },
    { type: 'flaeche', points: [{ x: 3.5, y: -7.5 }, { x: 4.5, y: -7.5 }, { x: 2, y: 1 }, { x: 1, y: 1 }], tone: 'ink', opacity: opacity.shadeRight },
  ],
  treibholz: () => [
    shadow(30),
    { type: 'flaeche', points: [{ x: -15, y: -2 }, { x: -12, y: -6 }, { x: 15, y: -1 }, { x: 12, y: 3 }], tone: 'islandWood' },
    { type: 'flaeche', points: [{ x: -15, y: -2 }, { x: 12, y: 3 }, { x: 15, y: -1 }, { x: 15, y: 1 }, { x: 12, y: 5 }, { x: -15, y: 0 }], tone: 'ink', opacity: opacity.shadeRight },
    dot(-12, -4, 2, 'islandEarth'),
  ],
  flaschenpost: () => [
    shadow(24),
    { type: 'oval', x: -11, y: -8, width: 18, height: 9, tone: 'islandRoofAlt' },
    rect(-5, -6, 7, 4, 'surfaceCard'),
    rect(7, -5.5, 5, 3, 'islandRoofAlt'),
    rect(11.5, -6, 2, 4, 'islandWood'),
  ],
  kieselturm: () => [shadow(20), ...ball(0, -3, 7, 'islandStone'), ...ball(0, -12, 5, 'islandStone'), ...ball(0, -19, 3.5, 'islandStone')],
  seestern: () => [
    shadow(20),
    {
      type: 'flaeche',
      points: [
        { x: 0, y: -12 }, { x: 3, y: -5 }, { x: 10, y: -5 }, { x: 4.5, y: -1 }, { x: 7, y: 6 },
        { x: 0, y: 2 }, { x: -7, y: 6 }, { x: -4.5, y: -1 }, { x: -10, y: -5 }, { x: -3, y: -5 },
      ],
      tone: 'islandRoof',
    },
    dot(0, -3, 1.5, 'islandLamp'),
  ],
  windrad: () => [
    shadow(14),
    rect(-1, -24, 2, 24, 'islandWood'),
    { type: 'flaeche', points: [{ x: 0, y: -26 }, { x: -2, y: -36 }, { x: 3, y: -34 }], tone: 'islandRoof' },
    { type: 'flaeche', points: [{ x: 0, y: -26 }, { x: 10, y: -28 }, { x: 8, y: -23 }], tone: 'islandLamp' },
    { type: 'flaeche', points: [{ x: 0, y: -26 }, { x: 2, y: -16 }, { x: -3, y: -18 }], tone: 'islandRoofAlt' },
    { type: 'flaeche', points: [{ x: 0, y: -26 }, { x: -10, y: -24 }, { x: -8, y: -29 }], tone: 'surfaceCard' },
    dot(0, -26, 1.5, 'ink'),
  ],
  vogeltraenke: () => [
    shadow(26),
    ...box({ x: 0, y: 0 }, 4, 10, 'islandStone', 'islandStone'),
    { type: 'oval', x: -12, y: -15, width: 24, height: 8, tone: 'islandStone' },
    { type: 'oval', x: -9, y: -14, width: 18, height: 5, tone: 'islandWater' },
  ],
  steinherz: () => [
    shadow(20),
    dot(-4, -10, 5, 'islandStone'),
    dot(4, -10, 5, 'islandStone'),
    { type: 'flaeche', points: [{ x: -8.8, y: -8.5 }, { x: 8.8, y: -8.5 }, { x: 0, y: 2 }], tone: 'islandStone' },
    { type: 'halbkreis', x: 4, y: -10, r: 5, tone: 'ink', opacity: opacity.shadeRight },
  ],
  /** Entdeckungs-Deko von Gebiet 1 (#204): ein Frosch aus Stein. */
  steinfrosch: () => [
    shadow(22),
    { type: 'oval', x: -10, y: -11, width: 20, height: 12, tone: 'islandStone' },
    { type: 'halbkreis', x: 0, y: -5, r: 6, tone: 'ink', opacity: opacity.shadeRight },
    { type: 'oval', x: -11, y: -3, width: 7, height: 3.5, tone: 'islandStone' },
    { type: 'oval', x: 4, y: -3, width: 7, height: 3.5, tone: 'islandStone' },
    dot(-4.5, -12, 3, 'islandStone'),
    dot(4.5, -12, 3, 'islandStone'),
    dot(-4.5, -12.5, 1.2, 'ink'),
    dot(4.5, -12.5, 1.2, 'ink'),
    { type: 'flaeche', points: [{ x: -4, y: -7 }, { x: 4, y: -7 }, { x: 0, y: -6 }], tone: 'ink', opacity: opacity.shadeLeft },
  ],
};

// --- Besucher (#202) ---------------------------------------------------------------------------------

const eye = (x: number, y: number): ArtPrimitive => dot(x, y, 1.2, 'ink');

/** Tiere der Besuchervorlagen, nach rechts schauend; Bildnisse im Sheet „Ereignisse“. */
const animals: Readonly<Record<string, () => ArtPrimitive[]>> = {
  tier_igel: () => [
    shadow(28),
    { type: 'flaeche', points: [{ x: -14, y: -2 }, { x: -12, y: -14 }, { x: -6, y: -20 }, { x: 2, y: -20 }, { x: 8, y: -14 }, { x: 8, y: -2 }], tone: 'islandEarth' },
    { type: 'flaeche', points: [{ x: -10, y: -18 }, { x: -8, y: -24 }, { x: -4, y: -19 }, { x: 0, y: -24 }, { x: 3, y: -18 }], tone: 'islandEarth' },
    { type: 'oval', x: 4, y: -12, width: 13, height: 9, tone: 'islandSand' },
    dot(17, -7.5, 1.6, 'ink'),
    eye(10, -10),
  ],
  tier_fuchs: () => [
    shadow(30),
    { type: 'oval', x: -16, y: -14, width: 12, height: 7, tone: 'islandRoof' },
    dot(-16, -10.5, 2.5, 'surfaceCard'),
    { type: 'oval', x: -8, y: -16, width: 18, height: 12, tone: 'islandRoof' },
    dot(10, -20, 6, 'islandRoof'),
    { type: 'flaeche', points: [{ x: 6, y: -24 }, { x: 7, y: -31 }, { x: 11, y: -25 }], tone: 'islandRoof' },
    { type: 'flaeche', points: [{ x: 11, y: -25 }, { x: 14, y: -31 }, { x: 15, y: -23 }], tone: 'islandRoof' },
    { type: 'flaeche', points: [{ x: 13, y: -20 }, { x: 19, y: -18 }, { x: 13, y: -16 }], tone: 'surfaceCard' },
    eye(12, -21),
    rect(-5, -5, 2, 5, 'islandRoof'),
    rect(5, -5, 2, 5, 'islandRoof'),
  ],
  tier_schwan: () => [
    { type: 'oval', x: -16, y: -5, width: 32, height: 7, tone: 'islandWater' },
    { type: 'oval', x: -13, y: -14, width: 22, height: 12, tone: 'surfaceCard' },
    { type: 'halbkreis', x: -2, y: -8, r: 6, tone: 'ink', opacity: opacity.shadeRight },
    rect(5, -28, 3, 16, 'surfaceCard'),
    dot(7.5, -29, 3.5, 'surfaceCard'),
    { type: 'flaeche', points: [{ x: 10, y: -30 }, { x: 15, y: -28 }, { x: 10, y: -27 }], tone: 'islandRoof' },
    eye(8.5, -30),
  ],
  tier_eule: () => [
    shadow(22),
    { type: 'oval', x: -10, y: -28, width: 20, height: 28, tone: 'islandWood' },
    { type: 'oval', x: -6, y: -18, width: 12, height: 16, tone: 'islandSand' },
    { type: 'flaeche', points: [{ x: -9, y: -25 }, { x: -8, y: -32 }, { x: -4, y: -27 }], tone: 'islandWood' },
    { type: 'flaeche', points: [{ x: 4, y: -27 }, { x: 8, y: -32 }, { x: 9, y: -25 }], tone: 'islandWood' },
    dot(-3.5, -22, 3.5, 'surfaceCard'),
    dot(3.5, -22, 3.5, 'surfaceCard'),
    eye(-3, -22),
    eye(4, -22),
    { type: 'flaeche', points: [{ x: -1.5, y: -19 }, { x: 1.5, y: -19 }, { x: 0, y: -15 }], tone: 'islandLamp' },
  ],
  tier_hase: () => [
    shadow(26),
    { type: 'oval', x: -13, y: -14, width: 20, height: 14, tone: 'islandStone' },
    dot(-13, -8, 3, 'surfaceCard'),
    dot(8, -16, 6, 'islandStone'),
    { type: 'oval', x: 3, y: -34, width: 4, height: 14, tone: 'islandStone' },
    { type: 'oval', x: 8, y: -33, width: 4, height: 13, tone: 'islandStone' },
    eye(10, -17),
    dot(13.5, -14.5, 1, 'islandRoof'),
  ],
  tier_ente: () => [
    shadow(24),
    { type: 'oval', x: -12, y: -14, width: 20, height: 12, tone: 'islandLamp' },
    { type: 'flaeche', points: [{ x: -12, y: -10 }, { x: -16, y: -14 }, { x: -11, y: -13 }], tone: 'islandLamp' },
    dot(6, -18, 6, 'islandLamp'),
    { type: 'flaeche', points: [{ x: 10, y: -18 }, { x: 17, y: -17 }, { x: 10, y: -15 }], tone: 'islandRoof' },
    eye(7, -20),
    rect(-3, -3, 1.5, 3, 'islandRoof'),
    rect(1, -3, 1.5, 3, 'islandRoof'),
  ],
  tier_eichhoernchen: () => [
    shadow(24),
    { type: 'oval', x: -18, y: -32, width: 13, height: 26, tone: 'islandEarth' },
    { type: 'oval', x: -8, y: -18, width: 14, height: 17, tone: 'islandEarth' },
    { type: 'oval', x: -4, y: -13, width: 7, height: 10, tone: 'islandSand' },
    dot(5, -21, 5, 'islandEarth'),
    { type: 'flaeche', points: [{ x: 2, y: -25 }, { x: 3, y: -31 }, { x: 6, y: -25 }], tone: 'islandEarth' },
    eye(7, -22),
    dot(6, -10, 2.5, 'islandWood'),
  ],
  tier_schildkroete: () => [
    shadow(30),
    rect(-10, -4, 3, 4, 'islandFoliage'),
    rect(6, -4, 3, 4, 'islandFoliage'),
    dot(13, -7, 4, 'islandFoliage'),
    eye(14.5, -8),
    { type: 'oval', x: -14, y: -16, width: 26, height: 14, tone: 'islandRoofAlt' },
    { type: 'halbkreis', x: -1, y: -9, r: 7, tone: 'ink', opacity: opacity.shadeRight },
    dot(-6, -11, 2, 'islandSand'),
    dot(0, -13, 2, 'islandSand'),
    dot(5, -10, 2, 'islandSand'),
  ],
};

// --- Gemeinschaftsprojekte (#208) --------------------------------------------------------------------

/**
 * Gerüst des aktiven Projekts je gemeinsamer Stufe: aus Holzstangen und Bohlen, mit jeder Stufe höher und mit
 * einer Lage mehr. Bei `fast_geschafft` steht schon der Dachfirst. Motiv und Maße sind Designwerte aus #208, nicht
 * belegt; die Gerüst-Stufen je Projekt kann #209 ersetzen.
 */
function scaffold(stage: CommonStage): ArtPrimitive[] {
  const level = { gestartet: 1, gut_unterwegs: 2, fast_geschafft: 3, geschafft: 3 }[stage];
  const height = 8 + 8 * level;
  const pole = (x: number, y: number) => rect(x - 1, y - height, 2, height, 'islandWood');
  const plank = (y: number) => rect(-16, y, 32, 2.5, 'islandWood');
  const drawing: ArtPrimitive[] = [
    shadow(tile * 0.55),
    // Bohlenstapel am Fuß: Hier wird gebaut.
    rect(-20, -3, 12, 3, 'islandWood'),
    { type: 'flaeche', points: [{ x: -20, y: -3 }, { x: -8, y: -3 }, { x: -8, y: 0 }, { x: -20, y: 0 }], tone: 'ink', opacity: opacity.shadeRight },
    pole(-14, -2),
    pole(14, -2),
  ];
  if (level >= 2) drawing.push(pole(-5, -6), pole(5, -6));
  for (let lage = 1; lage <= level; lage += 1) drawing.push(plank(-2 - 8 * lage));
  if (level >= 3) drawing.push({ type: 'flaeche', points: [{ x: -16, y: -2 - height }, { x: 0, y: -10 - height }, { x: 16, y: -2 - height }], tone: 'islandRoof', opacity: 0.6 });
  if (stage === 'geschafft') drawing.push(rect(-1, -18 - height, 2, 8, 'islandWood'), { type: 'flaeche', points: [{ x: 1, y: -18 - height }, { x: 8, y: -15 - height }, { x: 1, y: -12 - height }], tone: 'islandLamp' });
  return drawing;
}

/**
 * Wahrzeichen von Projekt 1: ein Gartenhäuschen mit Giebeldach, Tür und Fenster. Platzhalter aus #208, damit das
 * fertige Projekt auf der Insel sichtbar steht; die Wahrzeichen-Grafiken liefert #209.
 */
function gartenhaeuschen(): ArtPrimitive[] {
  return [
    shadow(tile * 0.6),
    ...box({ x: 0, y: 0 }, 16, 14, 'islandSand', 'islandSand'),
    { type: 'flaeche', points: [{ x: -18, y: -14 }, { x: 0, y: -28 }, { x: 0, y: -14 + 8 }], tone: 'islandRoof' },
    { type: 'flaeche', points: [{ x: 0, y: -28 }, { x: 18, y: -14 }, { x: 0, y: -14 + 8 }], tone: 'islandRoof' },
    { type: 'flaeche', points: [{ x: 0, y: -28 }, { x: 18, y: -14 }, { x: 0, y: -14 + 8 }], tone: 'ink', opacity: opacity.shadeRight },
    rect(-11, -11, 5, 8, 'islandWood'),
    rect(4, -10, 6, 5, 'islandLamp'),
  ];
}

/** Grafikschlüssel des Gerüsts zu einer gemeinsamen Stufe. */
export function scaffoldArt(stage: CommonStage): ArtKey {
  return `geruest_${stage}`;
}

/** Grafiken der Gemeinschaftsprojekte: Gerüst je Stufe (`scaffoldArt`) und Wahrzeichen je Grafikschlüssel. */
const projectArt: (readonly [ArtKey, ArtSpec])[] = [
  ...CommonStage.options.map((stage) => [scaffoldArt(stage), { stage: 1, lit: false, light: null, drawing: scaffold(stage) }] as const),
  ['gartenhaeuschen', { stage: 1, lit: false, light: null, drawing: gartenhaeuschen() }],
];

/** Neutraler Block für einen Schlüssel ohne Grafik. */
const block: ArtSpec = {
  stage: 1,
  lit: false,
  light: null,
  drawing: [shadow(tile * 0.6), ...box({ x: 0, y: 0 }, tile * 0.28, 18, 'islandRoof', 'islandSand')],
};

// --- Katalog -----------------------------------------------------------------------------------------

/** Jede Stufe ist etwas größer (Design-System › Insel: „jede Stufe etwas größer mit einem Detail“). */
const stageScale: Readonly<Record<Stage, number>> = { 1: 1, 2: 1.1, 3: 1.2 };

type Motif = Readonly<{ draw: (stage: Stage) => ArtPrimitive[]; light: ArtPoint | null }>;

/** Motiv je Bauplan des Katalogs. */
const motifs: Readonly<Record<string, Motif>> = {
  holzweg: { draw: holzweg, light: null },
  sitzbank: { draw: sitzbank, light: null },
  laterne: { draw: laterne, light: lanternLight },
  blumenwiese: { draw: blumenwiese, light: null },
  beerenstrauch: { draw: beerenstrauch, light: null },
  apfelbaum: { draw: apfelbaum, light: null },
  brunnen: { draw: brunnen, light: null },
  vogelhaus: { draw: vogelhaus, light: null },
  wegweiser: { draw: wegweiser, light: null },
  sonnenblumen: { draw: sonnenblumen, light: null },
  pilzkreis: { draw: pilzkreis, light: null },
  kuerbisbeet: { draw: kuerbisbeet, light: null },
  steinmauer: { draw: steinmauer, light: null },
  briefkasten: { draw: briefkasten, light: null },
  seerosenteich: { draw: seerosenteich, light: null },
  schilfgras: { draw: schilfgras, light: null },
};

/** Deko und Tiere haben keine Stufen; sie stehen als Stufe 1 ohne Licht. */
const flat = (drawing: readonly ArtPrimitive[]): ArtSpec => ({ stage: 1, lit: false, light: null, drawing });

const flatArt: (readonly [ArtKey, ArtSpec])[] = [
  ...gameCatalog.deko.flatMap((entry) => {
    const draw = decorations[entry.art];
    return draw === undefined ? [] : [[entry.art, flat(draw())] as const];
  }),
  ...gameCatalog.visitorTemplates.flatMap((visitor) => {
    const draw = animals[visitor.animal];
    return draw === undefined ? [] : [[visitor.animal, flat(draw())] as const];
  }),
];

const byArt = new Map<ArtKey, ArtSpec>([
  ...flatArt,
  ...projectArt,
  ...gameCatalog.blueprints.flatMap((blueprint) => {
    const motif = motifs[blueprint.key];
    if (motif === undefined) return [];
    return blueprint.art.map((art, index) => {
      const stage = (index + 1) as Stage;
      const k = stageScale[stage];
      const light = motif.light && { x: motif.light.x * k, y: motif.light.y * k };
      return [art, { stage, lit: light !== null, light, drawing: scaled(motif.draw(stage), k) }] as const;
    });
  }),
]);

export function artOf(art: ArtKey): ArtSpec {
  return byArt.get(art) ?? block;
}

/** Ausdehnung einer Grafik um die Feldmitte. */
export function artBounds({ drawing }: ArtSpec): Readonly<{ x: number; y: number; width: number; height: number }> {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const shape of drawing) {
    switch (shape.type) {
      case 'flaeche':
        for (const { x, y } of shape.points) {
          xs.push(x);
          ys.push(y);
        }
        break;
      case 'kreis':
        xs.push(shape.x - shape.r, shape.x + shape.r);
        ys.push(shape.y - shape.r, shape.y + shape.r);
        break;
      case 'halbkreis':
        xs.push(shape.x, shape.x + shape.r);
        ys.push(shape.y - shape.r, shape.y + shape.r);
        break;
      case 'oval':
        xs.push(shape.x, shape.x + shape.width);
        ys.push(shape.y, shape.y + shape.height);
        break;
    }
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}
