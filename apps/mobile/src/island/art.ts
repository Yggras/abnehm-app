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

function shadow(width: number): ArtPrimitive {
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
};

const byArt = new Map<ArtKey, ArtSpec>(
  gameCatalog.blueprints.flatMap((blueprint) => {
    const motif = motifs[blueprint.key];
    if (motif === undefined) return [];
    return blueprint.art.map((art, index) => {
      const stage = (index + 1) as Stage;
      const k = stageScale[stage];
      const light = motif.light && { x: motif.light.x * k, y: motif.light.y * k };
      return [art, { stage, lit: light !== null, light, drawing: scaled(motif.draw(stage), k) }] as const;
    });
  }),
);

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
