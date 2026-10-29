import type { ClockReading } from '@abnehm/clock';
import type { LocalDate } from '@abnehm/contracts/base';
import type { MomoAppearance } from '@abnehm/contracts/island';
import type { ArtKey, FieldKind, Season } from '@abnehm/game-rules/catalog';

import { opacity, size, type ColorToken } from '../design';
import { artOf } from './art';

// Szenenmodell der Inselansicht (Spezifikation 4, Abschnitt 7): eine reine Funktion von Inselzustand,
// betrachtender Person, Modus, lokaler Uhrzeit und Zoom auf eine geordnete Zeichenliste. Der
// Skia-Canvas zeichnet nur diese Liste. Licht, Zeichenreihenfolge, Jahreszeiten, Abend und Nebel
// folgen dem Design-System › Insel (research/design-system.md#insel).

export type Point = Readonly<{ x: number; y: number }>;
/** Rasterzelle: Spalte `x`, Zeile `y` wie im Feldschlüssel `‹gebiet›:‹x›:‹y›`. */
export type Cell = Readonly<{ x: number; y: number }>;
export type Polygon = readonly Point[];
export type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Ein Feld der Insel; `ownerPersonId` ist bei Strand, Lichtung und Gemeinschaftsplatz `null`. */
export type SceneField = Readonly<{ key: string; x: number; y: number; kind: FieldKind; ownerPersonId: string | null }>;

/** Ein Objekt auf einem Feld; `art` ist die Grafik seiner aktuellen Stufe. */
export type SceneObject = Readonly<{ id: string; fieldKey: string; art: ArtKey; ownerPersonId: string }>;

/** Ein noch gesperrtes Gebiet mit seinen Rasterzellen; es liegt unter Nebel. */
export type FogArea = Readonly<{ area: string; cells: readonly Cell[] }>;

/** Inselzustand, wie ihn die Inselansicht zeichnet. */
export type IslandSceneInput = Readonly<{
  fields: readonly SceneField[];
  fog: readonly FogArea[];
  objects: readonly SceneObject[];
  momo: MomoAppearance;
}>;

/** Lokale Uhrzeit der betrachtenden Person. */
export type LocalTime = Readonly<{ localDate: LocalDate; minutesOfDay: number }>;

const minutesPerDay = 24 * 60;

/** Lokale Uhrzeit einer Ablesung: Tag aus der Uhr, Minute des Tages aus Zeitpunkt und UTC-Offset derselben Ablesung. */
export function localTimeOf(reading: ClockReading): LocalTime {
  const utcMinutes = Math.floor(Date.parse(reading.instant) / 60_000);
  const minutesOfDay = (((utcMinutes + reading.utcOffsetMinutes) % minutesPerDay) + minutesPerDay) % minutesPerDay;
  return { localDate: reading.localDate, minutesOfDay };
}

/** `bereiche` färbt die eigenen Felder und die des Partners (Schalter „Bereiche“). */
export type IslandMode = 'ansehen' | 'bereiche';

export type IslandSceneRequest = Readonly<{
  island: IslandSceneInput;
  viewerPersonId: string;
  mode: IslandMode;
  localTime: LocalTime;
  zoom: number;
}>;

/** Färbung eines Felds in der Bereichsansicht. */
export type AreaTint = Readonly<{ tone: 'self' | 'partner'; opacity: number }>;

/**
 * Ein Eintrag der Zeichenliste. Die Liste ist nach Ebenen geordnet: Wasser, Inselsockel, Felder,
 * Objekte samt Momo, Nebel, Overlays. Farben sind Design-Tokens, Deckkräfte Zahlen.
 */
export type SceneItem =
  | Readonly<{ layer: 'wasser'; type: 'wasser'; tone: ColorToken }>
  /** Tieferes Wasser unter einer Erdkante: der Schatten der Insel im Wasser. */
  | Readonly<{ layer: 'wasser'; type: 'inselschatten'; polygon: Polygon; tone: ColorToken }>
  /** Bewegt sich mit `phase` (0–1) im Takt; bei reduzierter Bewegung steht sie still. */
  | Readonly<{ layer: 'wasser'; type: 'welle'; at: Point; phase: number }>
  | Readonly<{ layer: 'sockel'; type: 'seite'; field: string; side: 'links' | 'rechts'; polygon: Polygon; tone: ColorToken; shade: number }>
  | Readonly<{ layer: 'felder'; type: 'feld'; field: string; polygon: Polygon; tone: ColorToken; tint: AreaTint | null }>
  /** `at` ist die Mitte des Felds; dort steht das Objekt mittig (Design-System › Insel). */
  | Readonly<{ layer: 'objekte'; type: 'objekt'; id: string; field: string; at: Point; art: ArtKey }>
  | Readonly<{ layer: 'objekte'; type: 'momo'; field: string; at: Point; appearance: MomoAppearance }>
  | Readonly<{ layer: 'nebel'; type: 'nebel'; area: string; cells: readonly Polygon[]; tone: ColorToken; opacity: number }>
  /** Schwebt mit `phase` (0–1) über der Insel: Blütenstaub, Laub oder Schnee; bei reduzierter Bewegung still. */
  | Readonly<{ layer: 'overlays'; type: 'partikel'; at: Point; phase: number; tone: ColorToken }>
  | Readonly<{ layer: 'overlays'; type: 'abend'; tone: ColorToken; opacity: number }>
  /** Laterne oder Fenster, das abends über der Abend-Überlagerung leuchtet. */
  | Readonly<{ layer: 'overlays'; type: 'licht'; field: string; at: Point; tone: ColorToken }>;

/** Was ein Tipp trifft; `owner` aus Sicht der betrachtenden Person. */
export type SceneHit =
  | Readonly<{ type: 'feld'; field: string; kind: FieldKind; owner: 'self' | 'partner' | null }>
  | Readonly<{ type: 'nebel'; area: string }>;

export type IslandScene = Readonly<{
  items: readonly SceneItem[];
  /** Meteorologische Jahreszeit am lokalen Datum der betrachtenden Person. */
  season: Season;
  /** Abend von 20 bis 6 Uhr lokaler Zeit. */
  daytime: Daytime;
  /** Laub von Bäumen und Büschen in dieser Jahreszeit. */
  foliage: ColorToken;
  /** Mitte der Lichtung: Momos Platz, auf den die Ansicht startet. */
  focus: Point;
  /** Ausdehnung aller Felder samt Erdschicht. */
  bounds: Rect;
  /** Umkehrabbildung derselben Projektion: was ein Punkt der Szene trifft, `null` im Wasser. */
  hitAt(point: Point): SceneHit | null;
}>;

export type Daytime = 'tag' | 'abend';

/** Deckkraft der Bereichsfärbung (Spezifikation 4, Abschnitt 7; Design-System › Insel: „je 28 % Deckkraft“). */
const areaTintOpacity = 0.28;

/** Eine Zelle mit Land: ein Feld der Insel oder ein Stück eines gesperrten Gebiets. */
type Ground = Cell & Readonly<{ key: string; field: SceneField | null; fogArea: string | null }>;

export function islandScene({ island, viewerPersonId, mode, localTime, zoom }: IslandSceneRequest): IslandScene {
  const project = projection(zoom);
  const season = seasonOf(localTime.localDate);
  const daytime = daytimeOf(localTime.minutesOfDay);
  const ground: Ground[] = [
    ...island.fields.map((field) => ({ x: field.x, y: field.y, key: field.key, field, fogArea: null })),
    ...island.fog.flatMap(({ area, cells }) =>
      cells.map((cell) => ({ x: cell.x, y: cell.y, key: `${area}:${cell.x}:${cell.y}`, field: null, fogArea: area })),
    ),
  ];
  const groundByCell = new Map(ground.map((cell) => [cellKey(cell), cell]));
  const ownerOf = (field: SceneField) =>
    field.ownerPersonId === null ? null : field.ownerPersonId === viewerPersonId ? 'self' : 'partner';

  const sides = ground.flatMap((cell) =>
    exposedSides(cell, groundByCell).map(
      (side): Extract<SceneItem, { type: 'seite' }> => ({
        layer: 'sockel',
        type: 'seite',
        field: cell.key,
        side,
        polygon: project.side(cell, side),
        tone: 'islandEarth',
        shade: side === 'links' ? opacity.shadeLeft : opacity.shadeRight,
      }),
    ),
  );
  const bounds = boundsOf([...ground.map((cell) => project.diamond(cell)), ...sides.map((side) => side.polygon)]);
  const onLand = (point: Point) => groundByCell.has(cellKey(project.cellAt(point)));
  const water: SceneItem[] = [
    { layer: 'wasser', type: 'wasser', tone: 'islandWater' },
    ...sides.map(
      (side): SceneItem => ({
        layer: 'wasser',
        type: 'inselschatten',
        polygon: side.polygon.map(({ x, y }) => ({ x, y: y + project.depth })),
        tone: 'islandWaterDeep',
      }),
    ),
    ...wavePoints(bounds, project.depth)
      .filter((point) => !onLand(point))
      .map((at, index, all): SceneItem => ({ layer: 'wasser', type: 'welle', at, phase: index / all.length })),
  ];

  const tiles = ground.map(
    (cell): SceneItem => ({
      layer: 'felder',
      type: 'feld',
      field: cell.key,
      polygon: project.diamond(cell),
      tone: groundColor(cell.field?.kind ?? null, season),
      tint: mode === 'bereiche' && cell.field !== null ? tintOf(ownerOf(cell.field)) : null,
    }),
  );

  const fieldsByKey = new Map(island.fields.map((field) => [field.key, field]));
  const place = momoPlace(island.fields);
  const standing: { cell: Cell; item: SceneItem }[] = island.objects.flatMap((object) => {
    const field = fieldsByKey.get(object.fieldKey);
    if (field === undefined) return [];
    return [{ cell: field, item: { layer: 'objekte', type: 'objekt', id: object.id, field: field.key, at: project.center(field), art: object.art } }];
  });
  if (place !== null) {
    standing.push({ cell: place, item: { layer: 'objekte', type: 'momo', field: place.key, at: project.center(place), appearance: island.momo } });
  }
  standing.sort((a, b) => depth(a.cell) - depth(b.cell) || a.cell.x - b.cell.x);

  const fog = island.fog.map(
    ({ area, cells }): SceneItem => ({
      layer: 'nebel',
      type: 'nebel',
      area,
      cells: cells.map((cell) => project.diamond(cell)),
      // „Weiß mit opacity-fog“ (Design-System › Insel); das Weiß der App ist `surface-card`.
      tone: 'surfaceCard',
      opacity: opacity.fog,
    }),
  );

  const fields = island.fields;
  const particles = Array.from({ length: Math.min(particleCount, fields.length) }, (_, index): SceneItem => ({
    layer: 'overlays',
    type: 'partikel',
    at: project.center(fields[Math.floor((index * fields.length) / Math.min(particleCount, fields.length))]!),
    phase: index / particleCount,
    tone: particleColor[season],
  }));

  const evening: SceneItem[] =
    daytime === 'tag'
      ? []
      : [
          { layer: 'overlays', type: 'abend', tone: 'islandNight', opacity: opacity.evening },
          ...island.objects.flatMap((object): SceneItem[] => {
            const field = fieldsByKey.get(object.fieldKey);
            if (field === undefined || !artOf(object.art).lit) return [];
            return [{ layer: 'overlays', type: 'licht', field: field.key, at: project.center(field), tone: 'islandLamp' }];
          }),
        ];

  const lichtung = island.fields.filter((field) => field.kind === 'lichtung');

  return {
    season,
    daytime,
    foliage: season === 'herbst' ? 'islandFoliageAutumn' : 'islandFoliage',
    focus: lichtung.length > 0 ? project.point(centroid(lichtung)) : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    bounds,
    items: [...water, ...sides, ...tiles, ...standing.map(({ item }) => item), ...fog, ...particles, ...evening],
    hitAt(point) {
      const cell = groundByCell.get(cellKey(project.cellAt(point)));
      if (cell === undefined) return null;
      if (cell.field === null) return { type: 'nebel', area: cell.fogArea! };
      return { type: 'feld', field: cell.field.key, kind: cell.field.kind, owner: ownerOf(cell.field) };
    },
  };
}

/** Isometrische Projektion 2:1: Feld `island-tile` breit und halb so hoch, jeweils mal Zoom. */
function projection(zoom: number) {
  const halfWidth = (size.islandTile * zoom) / 2;
  const halfHeight = halfWidth / 2;
  const top = (cell: Cell): Point => ({ x: (cell.x - cell.y) * halfWidth, y: (cell.x + cell.y) * halfHeight });
  return {
    /** Tiefe der Erdschicht: eine halbe Feldhöhe (Designwert aus #182, nicht belegt). */
    depth: halfHeight,
    /** Punkt der Inselebene zu Rasterkoordinaten, auch zwischen den Feldern. */
    point: top,
    /** Raute eines Felds im Uhrzeigersinn ab der oberen Ecke. */
    diamond(cell: Cell): Polygon {
      const { x, y } = top(cell);
      return [
        { x, y },
        { x: x + halfWidth, y: y + halfHeight },
        { x, y: y + 2 * halfHeight },
        { x: x - halfWidth, y: y + halfHeight },
      ];
    },
    /** Mitte eines Felds. */
    center(cell: Cell): Point {
      const { x, y } = top(cell);
      return { x, y: y + halfHeight };
    },
    /** Seitenfläche unter der linken bzw. rechten unteren Kante eines Felds, eine Erdschicht tief. */
    side(cell: Cell, side: 'links' | 'rechts'): Polygon {
      const { x, y } = top(cell);
      const bottom = { x, y: y + 2 * halfHeight };
      const corner = side === 'links' ? { x: x - halfWidth, y: y + halfHeight } : { x: x + halfWidth, y: y + halfHeight };
      const [from, to] = side === 'links' ? [corner, bottom] : [bottom, corner];
      return [from, to, { x: to.x, y: to.y + halfHeight }, { x: from.x, y: from.y + halfHeight }];
    },
    /** Feld unter einem Punkt: `u = x − y` und `v = x + y` in halben Feldmaßen, abgerundet. */
    cellAt(point: Point): Cell {
      const u = point.x / halfWidth;
      const v = point.y / halfHeight;
      return { x: Math.floor((v + u) / 2), y: Math.floor((v - u) / 2) };
    },
  };
}

const cellKey = (cell: Cell) => `${cell.x}:${cell.y}`;

/** Wellen und Partikel sind Designwerte aus #182 (nicht belegt); zusammen bleiben sie weit unter den 157 Animationen des Spikes. */
const waveCount = 16;
const particleCount = 8;

/** Blütenstaub und Sonnenfunken, Laub, Schnee (Designwerte aus #182, nicht belegt). */
const particleColor: Record<Season, ColorToken> = {
  fruehling: 'islandLamp',
  sommer: 'islandLamp',
  herbst: 'islandFoliageAutumn',
  winter: 'islandGrassWinter',
};

/** Punkte auf einer Ellipse rund um die Insel, einen Feldabstand außerhalb ihrer Ausdehnung. */
function wavePoints(bounds: Rect, margin: number): Point[] {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const radius = { x: bounds.width / 2 + 4 * margin, y: bounds.height / 2 + 2 * margin };
  return Array.from({ length: waveCount }, (_, index) => {
    const angle = ((index + 0.5) / waveCount) * 2 * Math.PI;
    return { x: center.x + radius.x * Math.cos(angle), y: center.y + radius.y * Math.sin(angle) };
  });
}

function boundsOf(polygons: readonly Polygon[]): Rect {
  const points = polygons.flat();
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Zeichenreihenfolge von hinten nach vorn: Zeile + Spalte aufsteigend (Design-System › Insel). */
const depth = (cell: Cell) => cell.x + cell.y;

/** Erde zeigt eine Zelle nur, wo vor ihr kein Land liegt: links ohne Nachbarn in y + 1, rechts ohne in x + 1. */
function exposedSides(cell: Cell, ground: ReadonlyMap<string, Ground>): ('links' | 'rechts')[] {
  const sides: ('links' | 'rechts')[] = [];
  if (!ground.has(cellKey({ x: cell.x, y: cell.y + 1 }))) sides.push('links');
  if (!ground.has(cellKey({ x: cell.x + 1, y: cell.y }))) sides.push('rechts');
  return sides;
}

/**
 * Momos Platz: das Feld der Lichtung, das dem Mittelpunkt der Lichtung am nächsten liegt; bei
 * Gleichstand das hintere nach Zeichenreihenfolge.
 */
function momoPlace(fields: readonly SceneField[]): SceneField | null {
  const lichtung = fields.filter((field) => field.kind === 'lichtung');
  if (lichtung.length === 0) return null;
  const middle = centroid(lichtung);
  const distance = (field: SceneField) => Math.hypot(field.x + 0.5 - middle.x, field.y + 0.5 - middle.y);
  return [...lichtung].sort((a, b) => distance(a) - distance(b) || depth(a) - depth(b) || a.x - b.x)[0]!;
}

/** Mittelpunkt von Feldern in Rasterkoordinaten. */
function centroid(cells: readonly Cell[]): Point {
  return {
    x: cells.reduce((sum, cell) => sum + cell.x + 0.5, 0) / cells.length,
    y: cells.reduce((sum, cell) => sum + cell.y + 0.5, 0) / cells.length,
  };
}

function tintOf(owner: 'self' | 'partner' | null): AreaTint | null {
  return owner === null ? null : { tone: owner, opacity: areaTintOpacity };
}

/**
 * Abend auf der Insel von 20 bis 6 Uhr: dieselbe Zeit, in der Momo dort schläft (Spezifikation 4,
 * Abschnitt 6, neu festgelegt; Design-System › Insel: „Abend: … Momo schläft“).
 */
function daytimeOf(minutesOfDay: number): Daytime {
  return minutesOfDay >= 20 * 60 || minutesOfDay < 6 * 60 ? 'abend' : 'tag';
}

/** Meteorologische Jahreszeit: Frühling ab 1. März, Sommer ab 1. Juni, Herbst ab 1. September, Winter ab 1. Dezember. */
function seasonOf(localDate: LocalDate): Season {
  const month = Number(localDate.slice(5, 7));
  if (month >= 3 && month <= 5) return 'fruehling';
  if (month >= 6 && month <= 8) return 'sommer';
  if (month >= 9 && month <= 11) return 'herbst';
  return 'winter';
}

/** Jahreszeiten tauschen nur Gras und Laub (Design-System › Insel). */
const grass: Record<Season, ColorToken> = {
  fruehling: 'islandGrassSpring',
  sommer: 'islandGrass',
  herbst: 'islandGrassAutumn',
  winter: 'islandGrassWinter',
};

/** Boden einer Zelle; ein gesperrtes Gebiet (`null`) ist Wiese. */
function groundColor(kind: FieldKind | null, season: Season): ColorToken {
  if (kind === 'strand') return 'islandSand';
  return grass[season];
}
