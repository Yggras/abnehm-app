import type { ContractError } from '@abnehm/contracts/errors';
import type { IslandRole, MomoForm } from '@abnehm/contracts/island';

// Format des versionierten Spielkatalogs (Spezifikation 4, Abschnitt 4). Der Katalog wird mit App und
// Server ausgeliefert; Schlüssel werden nie entfernt oder umgewidmet, damit bestehende Inseln gültig
// bleiben. Namen sind der sichtbare deutsche Text, Grafiken nur Schlüssel, die die App zeichnet.

/** Verweis auf eine Grafik der App. Den Server interessiert nur der Schlüssel. */
export type ArtKey = string;

/** Stufe eines Objekts: gebaut auf 1, aufgewertet bis 3. */
export type Stage = 1 | 2 | 3;

/** Darstellung je Stufe 1–3. */
export type StageArt = readonly [ArtKey, ArtKey, ArtKey];

type BlueprintBase = Readonly<{ key: string; name: string; role: IslandRole; art: StageArt }>;

/**
 * Bauplan. Die drei Start-Baupläne je Rolle kosten fest 1, 2 und 3 Energie; alle anderen haben einen
 * Preislevel, aus dem die Spielregeln den Preis berechnen.
 */
export type Blueprint =
  | (BlueprintBase & Readonly<{ origin: 'start'; startPrice: 1 | 2 | 3 }>)
  | (BlueprintBase & Readonly<{ origin: 'level' | 'entdeckung' | 'besucher'; priceLevel: number }>);

/** Level-Freischaltung: ab Level 2 je Level und Rolle höchstens ein Bauplan der Herkunft `level`. */
export type LevelUnlock = Readonly<{ level: number; role: IslandRole; blueprint: string }>;

export type SharedFieldKind = 'strand' | 'lichtung' | 'gemeinschaftsplatz';
export type OwnedFieldKind = 'ecke' | 'rollenbereich';
export type FieldKind = SharedFieldKind | OwnedFieldKind;

/**
 * Seite einer Person auf der Insel. Felder gehören der Person ihrer Seite und bleiben bei ihr, auch
 * nach einem Rollentausch; welche Person welche Seite bekommt, regelt `hatchingSide`.
 */
export type FieldSide = 'a' | 'b';

/** Ein Feld eines Feldplans; der Feldschlüssel ist `‹gebiet›:‹x›:‹y›`. */
export type FieldPlanEntry = Readonly<
  { x: number; y: number } & ({ kind: SharedFieldKind } | { kind: OwnedFieldKind; side: FieldSide })
>;

/** Grundinsel: Strand, Lichtung, Gemeinschaftsplatz und die Startfelder beider Seiten. */
export type BaseIsland = Readonly<{ fields: readonly FieldPlanEntry[] }>;

type PerRole<T> = Readonly<Record<IslandRole, T>>;

/** Eines der sieben festen Gebiete; schaltet mit seinem Formlevel frei. */
export type Area = Readonly<{
  key: string;
  name: string;
  unlockLevel: number;
  fields: readonly FieldPlanEntry[];
  discoveryBlueprints: PerRole<readonly [string, string]>;
  discoveryDeko: readonly string[];
}>;

/** Vorlage für die endlosen Gebiete ab Level 49; Feldkoordinaten relativ zur Ausprägung. */
export type LandscapeTemplate = Readonly<{
  key: string;
  name: string;
  fields: readonly FieldPlanEntry[];
  /** Ein wiederverwendeter Entdeckungs-Bauplan je Rolle. */
  discoveryBlueprints: PerRole<string>;
}>;

export type Season = 'fruehling' | 'sommer' | 'herbst' | 'winter';

type DekoBase = Readonly<{ key: string; name: string; art: ArtKey }>;

/** Deko; Jahreszeiten-Deko gehört zu einer meteorologischen Jahreszeit und kommt ab einem Jahresindex. */
export type Deko =
  | (DekoBase & Readonly<{ origin: 'besucher' | 'entdeckung' | 'challenge' }>)
  | (DekoBase & Readonly<{ origin: 'jahreszeit'; season: Season; yearIndex: number }>);

/** Besucher (Tier) mit Wunsch und Belohnungspool. */
export type VisitorTemplate = Readonly<{
  key: string;
  name: string;
  animal: ArtKey;
  wish: 'bauplan_bauen';
  rewards: Readonly<{ blueprints: readonly string[]; deko: readonly string[] }>;
}>;

/** Lage, Drehung (Grad) und Größe eines Accessoires an einer Entwicklungsform. */
export type AccessoryFit = Readonly<{ x: number; y: number; rotation: number; scale: number }>;

export type Accessory = Readonly<{
  key: string;
  name: string;
  slot: 'kopf' | 'hals';
  art: ArtKey;
  fit: Readonly<Record<MomoForm, AccessoryFit>>;
}>;

/** Gemeinschaftsprojekt; die Reihenfolge im Katalog ist die feste Projektreihenfolge. */
export type ProjectTemplate = Readonly<{
  key: string;
  name: string;
  landmark: ArtKey;
  /** Feldschlüssel des Bauplatzes am Gemeinschaftsplatz. */
  site: string;
}>;

export type ChallengeTemplate = Readonly<{ key: string; name: string; deko: string }>;

/**
 * Schlüssel der k-ten Ausprägung eines endlosen Gebiets. Die Vorlage steht im Schlüssel, damit ein
 * Feld `endlos_‹k›_‹vorlage›:‹x›:‹y›` gültig bleibt, wenn spätere Kataloge Vorlagen ergänzen.
 */
export function endlessAreaKey(k: number, template: string): string {
  return `endlos_${k}_${template}`;
}

export type GameCatalog = Readonly<{
  /** Steigt mit jeder Änderung; je Version gibt es einen Schnappschuss der Schlüssel (`catalog-versions/`). */
  version: number;
  blueprints: readonly Blueprint[];
  levelUnlocks: readonly LevelUnlock[];
  baseIsland: BaseIsland;
  areas: readonly Area[];
  landscapeTemplates: readonly LandscapeTemplate[];
  deko: readonly Deko[];
  visitorTemplates: readonly VisitorTemplate[];
  accessories: readonly Accessory[];
  projects: readonly ProjectTemplate[];
  challengeTemplates: readonly ChallengeTemplate[];
}>;

/** Schlüssel der Grundinsel in Feldschlüsseln. */
export const baseIslandKey = 'grundinsel';

/** Feldschlüssel `‹gebiet›:‹x›:‹y›`. */
export function fieldKey(area: string, field: Readonly<{ x: number; y: number }>): string {
  return `${area}:${field.x}:${field.y}`;
}

/** Ein Feld des Katalogs mit seinem Schlüssel und Gebiet. */
export type CatalogField = Readonly<{ key: string; area: string }> & FieldPlanEntry;

/** Was der Katalog je Art nachschlagen kann. */
export type CatalogEntries = {
  bauplan: Blueprint;
  deko: Deko;
  feld: CatalogField;
  gebiet: Area;
  landschaftsvorlage: LandscapeTemplate;
  besuchervorlage: VisitorTemplate;
  accessoire: Accessory;
  gemeinschaftsprojekt: ProjectTemplate & Readonly<{ sequenceNumber: number }>;
  challenge_vorlage: ChallengeTemplate;
};
export type CatalogEntryKind = keyof CatalogEntries;

export type CatalogLookup<T> = Readonly<{ type: 'found'; entry: T }> | Readonly<{ type: 'contract_error'; error: ContractError }>;

export type CatalogIndex = Readonly<{
  /** Eintrag einer Art; ein unbekannter Schlüssel, auch einer anderen Art, ergibt `unknown_catalog_key`. */
  find<K extends CatalogEntryKind>(kind: K, key: string): CatalogLookup<CatalogEntries[K]>;
}>;

/** Nachschlagen im Katalog, etwa für die Prüfung eines Befehls auf dem Server. */
export function indexCatalog(catalog: GameCatalog): CatalogIndex {
  const byKey = <T extends { key: string }>(entries: readonly T[]) => new Map(entries.map((entry) => [entry.key, entry]));
  const fixedFields = new Map<string, CatalogField>();
  const addFields = (area: string, fields: readonly FieldPlanEntry[]) => {
    for (const field of fields) fixedFields.set(fieldKey(area, field), { key: fieldKey(area, field), area, ...field });
  };
  addFields(baseIslandKey, catalog.baseIsland.fields);
  for (const area of catalog.areas) addFields(area.key, area.fields);
  const templates = byKey(catalog.landscapeTemplates);

  const entries: { [K in Exclude<CatalogEntryKind, 'feld'>]: ReadonlyMap<string, CatalogEntries[K]> } = {
    bauplan: byKey(catalog.blueprints),
    deko: byKey(catalog.deko),
    gebiet: byKey(catalog.areas),
    landschaftsvorlage: templates,
    besuchervorlage: byKey(catalog.visitorTemplates),
    accessoire: byKey(catalog.accessories),
    gemeinschaftsprojekt: byKey(catalog.projects.map((project, index) => ({ ...project, sequenceNumber: index + 1 }))),
    challenge_vorlage: byKey(catalog.challengeTemplates),
  };

  const findField = (key: string): CatalogField | undefined => {
    const fixed = fixedFields.get(key);
    if (fixed !== undefined) return fixed;
    const parsed = parseFieldKey(key);
    if (parsed === undefined) return undefined;
    const endless = /^endlos_[1-9][0-9]*_(.+)$/.exec(parsed.area);
    const template = endless === null ? undefined : templates.get(endless[1]!);
    const field = template?.fields.find(({ x, y }) => x === parsed.x && y === parsed.y);
    return field === undefined ? undefined : { key, area: parsed.area, ...field };
  };

  return {
    find(kind, key) {
      const entry = kind === 'feld' ? findField(key) : entries[kind as Exclude<CatalogEntryKind, 'feld'>].get(key);
      if (entry !== undefined) return { type: 'found', entry: entry as CatalogEntries[typeof kind] };
      // Kontextwerte dürfen keinen Text tragen; ein manipulierter Schlüssel bleibt deshalb weg.
      const context: Record<string, string> = /^[A-Za-z0-9_.:+/-]{1,200}$/.test(key) ? { kind, key } : { kind };
      return { type: 'contract_error', error: { code: 'unknown_catalog_key', context, retryable: false } };
    },
  };
}

/** Zerlegt `‹gebiet›:‹x›:‹y›`; Koordinaten nur in kanonischer Schreibweise. */
function parseFieldKey(key: string): { area: string; x: number; y: number } | undefined {
  const match = /^([a-z][a-z0-9_]*):(-?[0-9]+):(-?[0-9]+)$/.exec(key);
  if (match === null) return undefined;
  const [, area = '', x = '', y = ''] = match;
  if (String(Number(x)) !== x || String(Number(y)) !== y) return undefined;
  return { area, x: Number(x), y: Number(y) };
}
