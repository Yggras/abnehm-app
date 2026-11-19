import { baseIslandKey, fieldKey, fieldPlans, parseEndlessAreaKey, parseFieldKey, type FieldPlanEntry, type FieldSide, type GameCatalog } from './catalog.ts';
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

/**
 * Lage der Inselfelder auf dem Raster, einmal je Katalog vorbereitet; liefert zu einem Feldschlüssel Lage, Feldart
 * und bei eigenen Feldern die Seite, `undefined`, wenn der Katalog ihn nicht kennt. Grundinsel und feste Gebiete
 * liegen auf dem gemeinsamen Raster. Die k-te Ausprägung eines endlosen Gebiets liegt im k-ten Band oberhalb der
 * obersten Zeile aller festen Felder. Die Lage hängt nur an k, nicht an der Reihenfolge der Vorlagen, damit eine
 * spätere Vorlage keine bestehende Ausprägung verschiebt (Festlegung in #204, nicht belegt).
 */
export function fieldPlacement(catalog: GameCatalog): (key: string) => FieldPlanEntry | undefined {
  const plans = fieldPlans(catalog);
  const fixed = new Map(plans.filter((plan) => plan.onIslandGrid).flatMap((plan) => plan.fields.map((field) => [fieldKey(plan.area, field), field] as const)));
  const templates = new Map(plans.filter((plan) => !plan.onIslandGrid).map((plan) => [plan.area, plan.fields] as const));
  const top = Math.min(...[...fixed.values()].map((field) => field.y));
  return (key) => {
    const found = fixed.get(key);
    if (found !== undefined) return found;
    const parsed = parseFieldKey(key);
    const endless = parsed === undefined ? undefined : parseEndlessAreaKey(parsed.area);
    const entry = endless && templates.get(endless.template)?.find((field) => field.x === parsed!.x && field.y === parsed!.y);
    return entry === undefined ? undefined : { ...entry, y: top - endless!.k * landscapeBand.height + entry.y };
  };
}

/** Lage eines einzelnen Inselfelds (`fieldPlacement`). */
export function placeField(catalog: GameCatalog, key: string): FieldPlanEntry | undefined {
  return fieldPlacement(catalog)(key);
}
