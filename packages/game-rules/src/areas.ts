import { baseIslandKey, fieldKey, fieldPlans, type FieldPlanEntry, type FieldSide, type GameCatalog } from './catalog.ts';
import type { IslandFieldOwner } from './hatching.ts';
import { unlocksAt, type UnlockedArea } from './unlocks.ts';

// Gebietsfreischaltung (Spezifikation 4, Abschnitte 3, 5, 7 und 9; #204). An den Formlevels schaltet ein festes
// Gebiet frei, ab Level 49 alle 6 Level ein endloses Gebiet aus der nächsten Landschaftsvorlage. Die Felder
// entstehen für beide Personen: Seite a und Seite b des Feldplans gehören denselben Personen wie auf der
// Grundinsel, auch nach einem Rollentausch (Felder bleiben bei ihrer Person, Abschnitt 7). Dazu kommt die
// Entdeckung mit den Entdeckungs-Bauplänen für die Insel und der Entdeckungs-Deko, die jede Person abholt.

/** Wem welche Seite der Insel gehört. */
export type IslandSides = Readonly<Record<FieldSide, string>>;

/** Was eine Entdeckung bringt: die Baupläne für die Insel und die Deko, die jede Person abholt. */
export type Discovery = Readonly<{ areaKey: string; blueprints: readonly string[]; deko: readonly string[] }>;

export type AreaUnlock = Readonly<{
  level: number;
  area: UnlockedArea;
  /** Die neuen Inselfelder mit Besitzer; gemeinsame Bereiche gehören niemandem. */
  fields: readonly IslandFieldOwner[];
  discovery: Discovery;
}>;

/**
 * Anlassschlüssel der Gebietsfreischaltung und ihrer Entdeckung: `gebiet:‹insel›:‹gebiet›`, eindeutig je Insel
 * (Spezifikation 4, Abschnitte 2.2 und 9).
 */
export function areaOccasionKey(islandId: string, areaKey: string): string {
  return `gebiet:${islandId}:${areaKey}`;
}

/** Wem Seite a und Seite b gehören, aus den materialisierten Feldern der Grundinsel; `null` ohne sie. */
export function sidesOf(catalog: GameCatalog, fields: readonly IslandFieldOwner[]): IslandSides | null {
  const owners = new Map(fields.map((field) => [field.key, field.ownerPersonId]));
  const ownerOf = (side: FieldSide) => {
    const entry = catalog.baseIsland.fields.find((field) => 'side' in field && field.side === side);
    return entry === undefined ? null : (owners.get(fieldKey(baseIslandKey, entry)) ?? null);
  };
  const a = ownerOf('a');
  const b = ownerOf('b');
  return a === null || b === null ? null : { a, b };
}

/** Das Gebiet, das Level `level` freischaltet, samt Feldern und Entdeckung; `null` ohne Gebiet. */
export function areaUnlockAt(catalog: GameCatalog, { level, sides }: Readonly<{ level: number; sides: IslandSides }>): AreaUnlock | null {
  const unlocks = unlocksAt(catalog, level);
  const { area } = unlocks;
  if (area === null) return null;
  const plan = area.type === 'gebiet' ? catalog.areas.find(({ key }) => key === area.key) : catalog.landscapeTemplates.find(({ key }) => key === area.template);
  if (plan === undefined) return null;
  return {
    level,
    area,
    fields: plan.fields.map((field) => ({ key: fieldKey(area.key, field), ownerPersonId: 'side' in field ? sides[field.side] : null })),
    discovery: {
      areaKey: area.key,
      blueprints: unlocks.blueprints.filter((blueprint) => blueprint.reason === 'entdeckung').map((blueprint) => blueprint.key),
      deko: 'discoveryDeko' in plan ? plan.discoveryDeko : [],
    },
  };
}

/**
 * Band, in dem jede Landschaftsvorlage liegt: 16 Spalten, 5 Zeilen ab (0, 0); so breit wie die Grundinsel und
 * so hoch wie ein Gebiet aus 80 Feldern (Designwert aus #204, nicht belegt; `checkCatalog` prüft es).
 */
export const landscapeBand = { width: 16, height: 5 } as const;

/** Ein Feld auf dem Inselraster: Lage, Feldart und bei eigenen Feldern die Seite. */
export type PlacedField = FieldPlanEntry;

/**
 * Lage eines Inselfelds auf dem Raster; `undefined`, wenn der Katalog es nicht kennt. Grundinsel und feste
 * Gebiete liegen auf dem gemeinsamen Raster. Die k-te Ausprägung eines endlosen Gebiets liegt im k-ten Band
 * oberhalb der obersten Zeile aller festen Felder. Die Lage hängt nur an k, nicht an der Reihenfolge der
 * Vorlagen, damit eine spätere Vorlage keine bestehende Ausprägung verschiebt (Festlegung in #204, nicht belegt).
 */
export function placeField(catalog: GameCatalog, key: string): PlacedField | undefined {
  const match = /^([a-z][a-z0-9_]*):(-?[0-9]+):(-?[0-9]+)$/.exec(key);
  if (match === null) return undefined;
  const [, area = '', x = '', y = ''] = match;
  const at = { x: Number(x), y: Number(y) };
  const plans = fieldPlans(catalog);
  const fixed = plans.find((plan) => plan.onIslandGrid && plan.area === area);
  if (fixed !== undefined) return fixed.fields.find((field) => field.x === at.x && field.y === at.y);

  const endless = /^endlos_([1-9][0-9]*)_(.+)$/.exec(area);
  const template = endless === null ? undefined : plans.find((plan) => !plan.onIslandGrid && plan.area === endless[2]);
  const entry = template?.fields.find((field) => field.x === at.x && field.y === at.y);
  if (entry === undefined) return undefined;
  const top = Math.min(...plans.filter((plan) => plan.onIslandGrid).flatMap((plan) => plan.fields.map((field) => field.y)));
  return { ...entry, y: top - Number(endless![1]) * landscapeBand.height + entry.y };
}
