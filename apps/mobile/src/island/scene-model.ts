import type { LocalDate } from '@abnehm/contracts/base';
import type { CommonStage, MomoAppearance } from '@abnehm/contracts/island';
import { fieldKey, type ArtKey, type FieldKind, type Season } from '@abnehm/game-rules/catalog';

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

/** Ein Wahrzeichen auf seinem Bauplatz; `size` wächst mit jedem fertigen Ausbau ab 1 (#208). */
export type SceneLandmark = Readonly<{ site: string; art: ArtKey; size: number }>;

/** Gerüst des aktiven Gemeinschaftsprojekts auf seinem Bauplatz; es wächst mit der gemeinsamen Stufe (#208). */
export type SceneScaffold = Readonly<{ site: string; stage: CommonStage }>;

/** Inselzustand, wie ihn die Inselansicht zeichnet. */
export type IslandSceneInput = Readonly<{
  fields: readonly SceneField[];
  fog: readonly FogArea[];
  objects: readonly SceneObject[];
  momo: MomoAppearance;
  /** Wahrzeichen der fertigen Gemeinschaftsprojekte (#208). */
  landmarks?: readonly SceneLandmark[];
  /** Gerüst des aktiven Projekts; `null` ohne Projekt, etwa vor dem Schlüpfen. */
  scaffold?: SceneScaffold | null;
}>;

/** Lokale Uhrzeit der betrachtenden Person: Tag und Minute des Tages aus einer Ablesung der Uhr (`minutesOfDay`). */
export type LocalTime = Readonly<{ localDate: LocalDate; minutesOfDay: number }>;

/** Wem ein Feld gehört, aus Sicht der betrachtenden Person; gemeinsame Bereiche gehören niemandem. */
export type Owner = 'self' | 'partner' | null;

/** Seite der Erdschicht unter einem Feld. */
export type EarthSide = 'links' | 'rechts';

/**
 * `bereiche` färbt die eigenen Felder und die des Partners (Schalter „Bereiche“). Im Bau-Modus leuchten
 * die Felder, auf die der gewählte Bauplan darf (#192; `build-options.ts`).
 */
export type IslandMode = 'ansehen' | 'bereiche' | Readonly<{ type: 'bauen'; fields: ReadonlySet<string> }>;

export type IslandSceneRequest = Readonly<{
  island: IslandSceneInput;
  viewerPersonId: string;
  mode: IslandMode;
  localTime: LocalTime;
  zoom: number;
  /** Angetipptes Feld, hervorgehoben bis zur nächsten Auswahl. */
  selectedField?: string | null;
  /** Das eben gebaute Objekt; es erscheint mit Feder (#192). */
  appearing?: string | null;
  /**
   * Verwandlungsszene (#204): Momo blendet von `from` in die aktuelle Form über, danach zieht der Nebel über den
   * eben freigeschalteten Gebieten `lifting` ab. Deren Felder stehen schon in `island.fields`.
   */
  transformation?: Readonly<{ from: MomoAppearance; lifting: readonly FogArea[] }> | null;
}>;

/** Färbung eines Felds in der Bereichsansicht. */
export type AreaTint = Readonly<{ tone: Exclude<Owner, null>; opacity: number }>;

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
  | Readonly<{ layer: 'sockel'; type: 'seite'; field: string; side: EarthSide; polygon: Polygon; tone: ColorToken; shade: number }>
  | Readonly<{ layer: 'felder'; type: 'feld'; field: string; polygon: Polygon; tone: ColorToken; tint: AreaTint | null }>
  /** `at` ist die Mitte des Felds; dort steht das Objekt mittig (Design-System › Insel). `appearing`: eben gebaut. */
  | Readonly<{ layer: 'objekte'; type: 'objekt'; id: string; field: string; at: Point; art: ArtKey; appearing: boolean }>
  /** Wahrzeichen eines fertigen Projekts mittig auf seinem Bauplatz, je Ausbau größer (`scale`, #208). */
  | Readonly<{ layer: 'objekte'; type: 'wahrzeichen'; field: string; at: Point; art: ArtKey; scale: number }>
  /** Gerüst des aktiven Projekts; `art` ist die Grafik seiner gemeinsamen Stufe (#208). */
  | Readonly<{ layer: 'objekte'; type: 'geruest'; field: string; at: Point; art: ArtKey }>
  /** `from`: die alte Form während der Verwandlung (#204), sonst `null`. */
  | Readonly<{ layer: 'objekte'; type: 'momo'; field: string; at: Point; appearance: MomoAppearance; from: MomoAppearance | null }>
  /** `lifting`: Nebel über einem eben freigeschalteten Gebiet, der nach der Verwandlung abzieht (#204). */
  | Readonly<{ layer: 'nebel'; type: 'nebel'; area: string; cells: readonly Polygon[]; tone: ColorToken; opacity: number; lifting: boolean }>
  /** Blatt, das mit `phase` (0–1) über der Insel schwebt, im Laub der Jahreszeit; bei reduzierter Bewegung still. */
  | Readonly<{ layer: 'overlays'; type: 'partikel'; at: Point; phase: number; tone: ColorToken }>
  | Readonly<{ layer: 'overlays'; type: 'abend'; tone: ColorToken; opacity: number }>
  /** Laterne oder Fenster, das abends über der Abend-Überlagerung leuchtet; `at` ist das Licht der Grafik. */
  | Readonly<{ layer: 'overlays'; type: 'licht'; field: string; at: Point; tone: ColorToken }>
  /** Gültiges Feld im Bau-Modus; leuchtet pulsierend, auch abends (Design-System › Insel). */
  | Readonly<{ layer: 'overlays'; type: 'baubar'; field: string; polygon: Polygon; tone: ColorToken }>
  /** Angetipptes Feld; liegt über allem, damit man es auch abends erkennt. */
  | Readonly<{ layer: 'overlays'; type: 'auswahl'; field: string; polygon: Polygon; tone: ColorToken; opacity: number }>;

/** Was ein Tipp trifft; `owner` aus Sicht der betrachtenden Person. */
export type SceneHit =
  /** Momo selbst; das Antippen öffnet das Momo-Sheet (#184). */
  | Readonly<{ type: 'momo' }>
  | Readonly<{ type: 'feld'; field: string; kind: FieldKind; owner: Owner }>
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
  /** Mitte der eben freigeschalteten Gebiete während der Verwandlung; dorthin schwenkt die Ansicht (#204). */
  reveal: Point | null;
  /** Ausdehnung aller Felder samt Erdschicht. */
  bounds: Rect;
  /** Umkehrabbildung derselben Projektion: was ein Punkt der Szene trifft, `null` im Wasser. */
  hitAt(point: Point): SceneHit | null;
}>;

export type Daytime = 'tag' | 'abend';

/** Deckkraft der Bereichsfärbung (Spezifikation 4, Abschnitt 7; Design-System › Insel: „je 28 % Deckkraft“). */
const areaTintOpacity = 0.28;

/** Vergrößerung eines Wahrzeichens je fertigem Ausbau, höchstens dreimal (Designwerte aus #208, nicht belegt). */
const landmarkGrowth = { step: 0.15, maxSteps: 3 } as const;

/** Größe eines Wahrzeichens nach `size − 1` fertigen Ausbauten. */
function landmarkScale(size: number): number {
  return 1 + landmarkGrowth.step * Math.min(Math.max(size - 1, 0), landmarkGrowth.maxSteps);
}

/** Deckkraft der Hervorhebung eines angetippten Felds (Designwert aus #182, nicht belegt). */
const selectionOpacity = 0.5;

/** Eine Zelle mit Land: ein Feld der Insel oder ein Stück eines gesperrten Gebiets. */
type Ground = Cell & Readonly<{ key: string; field: SceneField | null; fogArea: string | null }>;

export function islandScene({ island, viewerPersonId, mode, localTime, zoom, selectedField = null, appearing = null, transformation = null }: IslandSceneRequest): IslandScene {
  const project = projection(zoom);
  const season = seasonOf(localTime.localDate);
  const daytime = daytimeOf(localTime.minutesOfDay);
  const ground: Ground[] = [
    ...island.fields.map((field) => ({ x: field.x, y: field.y, key: field.key, field, fogArea: null })),
    ...island.fog.flatMap(({ area, cells }) =>
      cells.map((cell) => ({ x: cell.x, y: cell.y, key: fieldKey(area, cell), field: null, fogArea: area })),
    ),
  ];
  const groundByCell = new Map(ground.map((cell) => [cellKey(cell), cell]));
  const ownerOf = (field: SceneField): Owner =>
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

  const fieldItems = ground.map(
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
  const lichtung = island.fields.filter((field) => field.kind === 'lichtung');
  const place = momoPlace(lichtung);
  const standing: { cell: Cell; item: SceneItem }[] = island.objects.flatMap((object) => {
    const field = fieldsByKey.get(object.fieldKey);
    if (field === undefined) return [];
    const item: SceneItem = { layer: 'objekte', type: 'objekt', id: object.id, field: field.key, at: project.center(field), art: object.art, appearing: object.id === appearing };
    return [{ cell: field, item }];
  });
  // Wahrzeichen vor ihrem Gerüst: Beim Ausbau steht das Gerüst um das vorhandene Wahrzeichen (#208).
  for (const landmark of island.landmarks ?? []) {
    const field = fieldsByKey.get(landmark.site);
    if (field === undefined) continue;
    standing.push({ cell: field, item: { layer: 'objekte', type: 'wahrzeichen', field: field.key, at: project.center(field), art: landmark.art, scale: landmarkScale(landmark.size) } });
  }
  const scaffoldField = island.scaffold == null ? undefined : fieldsByKey.get(island.scaffold.site);
  if (scaffoldField !== undefined && island.scaffold != null) {
    standing.push({ cell: scaffoldField, item: { layer: 'objekte', type: 'geruest', field: scaffoldField.key, at: project.center(scaffoldField), art: `geruest_${island.scaffold.stage}` } });
  }
  if (place !== null) {
    const { field } = place;
    standing.push({
      cell: field,
      item: { layer: 'objekte', type: 'momo', field: field.key, at: project.center(field), appearance: island.momo, from: transformation?.from ?? null },
    });
  }
  standing.sort((a, b) => depth(a.cell) - depth(b.cell) || a.cell.x - b.cell.x);

  const fogOf = (lifting: boolean) => ({ area, cells }: FogArea): SceneItem => ({
    layer: 'nebel',
    type: 'nebel',
    area,
    cells: cells.map((cell) => project.diamond(cell)),
    // „Weiß mit opacity-fog“ (Design-System › Insel); das Weiß der App ist `surface-card`.
    tone: 'surfaceCard',
    opacity: opacity.fog,
    lifting,
  });
  const lifting = transformation?.lifting ?? [];
  const fog = [...island.fog.map(fogOf(false)), ...lifting.map(fogOf(true))];

  const foliage: ColorToken = season === 'herbst' ? 'islandFoliageAutumn' : 'islandFoliage';
  const fields = island.fields;
  const particleTotal = Math.min(particleCount, fields.length);
  const particles = Array.from({ length: particleTotal }, (_, index): SceneItem => ({
    layer: 'overlays',
    type: 'partikel',
    at: project.center(fields[Math.floor((index * fields.length) / particleTotal)]!),
    phase: index / particleCount,
    tone: foliage,
  }));

  const evening: SceneItem[] =
    daytime === 'tag'
      ? []
      : [
          { layer: 'overlays', type: 'abend', tone: 'islandNight', opacity: opacity.evening },
          ...island.objects.flatMap((object): SceneItem[] => {
            const field = fieldsByKey.get(object.fieldKey);
            const { light } = artOf(object.art);
            if (field === undefined || light === null) return [];
            const center = project.center(field);
            return [{ layer: 'overlays', type: 'licht', field: field.key, at: { x: center.x + light.x * zoom, y: center.y + light.y * zoom }, tone: 'islandLamp' }];
          }),
        ];

  const buildable: SceneItem[] =
    typeof mode === 'object'
      ? island.fields
          .filter((field) => mode.fields.has(field.key))
          .map((field): SceneItem => ({ layer: 'overlays', type: 'baubar', field: field.key, polygon: project.diamond(field), tone: 'islandBuildable' }))
      : [];

  const selected = selectedField === null ? undefined : fieldsByKey.get(selectedField);
  const selection: SceneItem[] =
    selected === undefined
      ? []
      : [{ layer: 'overlays', type: 'auswahl', field: selected.key, polygon: project.diamond(selected), tone: 'surfaceCard', opacity: selectionOpacity }];

  return {
    season,
    daytime,
    foliage,
    focus: place === null ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 } : project.point(place.middle),
    reveal: lifting.length === 0 ? null : centerOf(boundsOf(lifting.flatMap(({ cells }) => cells.map((cell) => project.diamond(cell))))),
    bounds,
    items: [...water, ...sides, ...fieldItems, ...standing.map(({ item }) => item), ...fog, ...particles, ...evening, ...buildable, ...selection],
    hitAt(point) {
      if (place !== null && project.onMomo(place.field, point)) return { type: 'momo' };
      const cell = groundByCell.get(cellKey(project.cellAt(point)));
      if (cell === undefined) return null;
      if (cell.field === null) return { type: 'nebel', area: cell.fogArea! };
      return { type: 'feld', field: cell.field.key, kind: cell.field.kind, owner: ownerOf(cell.field) };
    },
  };
}

/**
 * Momos Trefferfläche bei Zoom 1: ein Rechteck von 44 × 46 dp um die Figur, deren Mitte 19 dp über der
 * Feldmitte liegt. Das Momo-Rig steht dort in einem Rahmen von 40 dp mit dem Bodenpunkt auf der
 * Feldmitte (`IslandArt.tsx`, #187); Kopf, Krone und Strohhütchen reichen bis etwa 40 dp darüber, das
 * Rechteck von 42 dp darüber bis 4 dp darunter. 44 × 44 pt ist laut Apple HIG die Standardgröße von
 * Bedienelementen auf iOS, das Minimum 28 × 28 pt
 * (https://developer.apple.com/design/human-interface-guidelines/accessibility, „Mobility“).
 * Vorher deckte die Fläche nur die Figur ab; ein Tipp an Momos Kopfkante traf im Android-Emulator das Feld
 * dahinter (Impeccable-Kritik zu #184).
 */
const momoHit = { lift: 19, halfWidth: 22, halfHeight: 23 } as const;

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
    /** Ob ein Punkt Momo auf seinem Feld trifft (`momoHit`, mit dem Zoom skaliert). */
    onMomo(cell: Cell, point: Point): boolean {
      const { x, y } = top(cell);
      const figure = { x, y: y + halfHeight - momoHit.lift * zoom };
      return Math.abs(point.x - figure.x) <= momoHit.halfWidth * zoom && Math.abs(point.y - figure.y) <= momoHit.halfHeight * zoom;
    },
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
    side(cell: Cell, side: EarthSide): Polygon {
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

/** Zahl der Wellen und Partikel: Designwerte aus #182 (nicht belegt), zusammen weit unter den 157 Animationen des Spikes. */
const waveCount = 16;
const particleCount = 8;


/** Punkte auf einer Ellipse rund um die Insel, einen Feldabstand außerhalb ihrer Ausdehnung. */
function wavePoints(bounds: Rect, margin: number): Point[] {
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const radius = { x: bounds.width / 2 + 4 * margin, y: bounds.height / 2 + 2 * margin };
  return Array.from({ length: waveCount }, (_, index) => {
    const angle = ((index + 0.5) / waveCount) * 2 * Math.PI;
    return { x: center.x + radius.x * Math.cos(angle), y: center.y + radius.y * Math.sin(angle) };
  });
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
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
function exposedSides(cell: Cell, ground: ReadonlyMap<string, Ground>): EarthSide[] {
  const sides: EarthSide[] = [];
  if (!ground.has(cellKey({ x: cell.x, y: cell.y + 1 }))) sides.push('links');
  if (!ground.has(cellKey({ x: cell.x + 1, y: cell.y }))) sides.push('rechts');
  return sides;
}

/**
 * Momos Platz auf der Lichtung: ihr Mittelpunkt (in Rasterkoordinaten) und das Feld, das ihm am
 * nächsten liegt; bei Gleichstand das hintere nach Zeichenreihenfolge.
 */
function momoPlace(lichtung: readonly SceneField[]): Readonly<{ field: SceneField; middle: Point }> | null {
  if (lichtung.length === 0) return null;
  const middle = centroid(lichtung);
  const distance = (field: SceneField) => Math.hypot(field.x + 0.5 - middle.x, field.y + 0.5 - middle.y);
  const field = [...lichtung].sort((a, b) => distance(a) - distance(b) || depth(a) - depth(b) || a.x - b.x)[0]!;
  return { field, middle };
}

/** Mittelpunkt von Feldern in Rasterkoordinaten. */
function centroid(cells: readonly Cell[]): Point {
  return {
    x: cells.reduce((sum, cell) => sum + cell.x + 0.5, 0) / cells.length,
    y: cells.reduce((sum, cell) => sum + cell.y + 0.5, 0) / cells.length,
  };
}

function tintOf(owner: Owner): AreaTint | null {
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

/**
 * Boden einer Zelle: Strand aus Sand, der Gemeinschaftsplatz aus Stein (`island-stone`: Wege, Steine;
 * Referenzentwurf „Momo“), sonst Wiese, auch in gesperrten Gebieten (`null`).
 */
function groundColor(kind: FieldKind | null, season: Season): ColorToken {
  if (kind === 'strand') return 'islandSand';
  if (kind === 'gemeinschaftsplatz') return 'islandStone';
  return grass[season];
}
