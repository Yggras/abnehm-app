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

/** Gemeinsame Bereiche ohne Besitzer; dort baut niemand. */
export const sharedFieldKinds = ['strand', 'lichtung', 'gemeinschaftsplatz'] as const;
export type SharedFieldKind = (typeof sharedFieldKinds)[number];
export type OwnedFieldKind = 'ecke' | 'rollenbereich';
export type FieldKind = SharedFieldKind | OwnedFieldKind;

/**
 * Seite einer Person auf der Insel. Die Felder einer Seite gehören einer Person und bleiben bei ihr,
 * auch nach einem Rollentausch. Welche Person welche Seite bekommt, legt das Schlüpfen fest (#184).
 */
export type FieldSide = 'a' | 'b';

/** Art eines Felds; gehört es einer Person, dazu ihre Seite. */
export type FieldAssignment = Readonly<{ kind: SharedFieldKind } | { kind: OwnedFieldKind; side: FieldSide }>;

/** Ein Feld eines Feldplans; der Feldschlüssel ist `‹gebiet›:‹x›:‹y›`. */
export type FieldPlanEntry = Readonly<{ x: number; y: number }> & FieldAssignment;

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

export type GameCatalog = Readonly<{
  /** Steigt mit jeder Änderung; je Version gibt es einen Schnappschuss (`catalog-versions/`). */
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

const endlessPrefix = 'endlos_';

/**
 * Schlüssel der k-ten Ausprägung eines endlosen Gebiets. Die Vorlage steht im Schlüssel, damit ein
 * Feld `endlos_‹k›_‹vorlage›:‹x›:‹y›` gültig bleibt, wenn spätere Kataloge Vorlagen ergänzen.
 */
export function endlessAreaKey(k: number, template: string): string {
  return `${endlessPrefix}${k}_${template}`;
}

function parseEndlessAreaKey(area: string): { k: number; template: string } | undefined {
  const match = new RegExp(`^${endlessPrefix}([1-9][0-9]*)_(.+)$`).exec(area);
  return match === null ? undefined : { k: Number(match[1]), template: match[2]! };
}

/** Schlüssel, die Feldschlüssel bilden, ohne Katalogeintrag zu sein; kein Eintrag darf sie tragen. */
export function isReservedKey(key: string): boolean {
  return key === baseIslandKey || key.startsWith(endlessPrefix);
}

/** Feldschlüssel `‹gebiet›:‹x›:‹y›`. */
export function fieldKey(area: string, field: Readonly<{ x: number; y: number }>): string {
  return `${area}:${field.x}:${field.y}`;
}

/** Ein Feldplan des Katalogs. */
export type FieldPlan = Readonly<{
  area: string;
  source: 'grundinsel' | 'gebiet' | 'landschaftsvorlage';
  /**
   * Grundinsel und feste Gebiete liegen auf einem gemeinsamen Raster. Die Felder einer
   * Landschaftsvorlage sind relativ und entstehen je Ausprägung unter deren eigenem Gebiet.
   */
  onIslandGrid: boolean;
  fields: readonly FieldPlanEntry[];
}>;

/** Alle Feldpläne des Katalogs. */
export function fieldPlans(catalog: GameCatalog): FieldPlan[] {
  return [
    { area: baseIslandKey, source: 'grundinsel', onIslandGrid: true, fields: catalog.baseIsland.fields },
    ...catalog.areas.map((area) => ({ area: area.key, source: 'gebiet' as const, onIslandGrid: true, fields: area.fields })),
    ...catalog.landscapeTemplates.map((template) => ({
      area: template.key,
      source: 'landschaftsvorlage' as const,
      onIslandGrid: false,
      fields: template.fields,
    })),
  ];
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

/** Arten mit eigenem Schlüssel; Felder tragen Feldschlüssel aus ihrem Feldplan. */
export type KeyedEntryKind = Exclude<CatalogEntryKind, 'feld'>;

// Eine neue Art in `CatalogEntries` ist hier ein Typfehler, bis sie eingetragen ist. So erreichen
// Nachschlagen, Schlüsselprüfung und Schnappschuss jede Art.
const keyedEntries: { [K in KeyedEntryKind]: (catalog: GameCatalog) => readonly CatalogEntries[K][] } = {
  bauplan: (catalog) => catalog.blueprints,
  deko: (catalog) => catalog.deko,
  gebiet: (catalog) => catalog.areas,
  landschaftsvorlage: (catalog) => catalog.landscapeTemplates,
  besuchervorlage: (catalog) => catalog.visitorTemplates,
  accessoire: (catalog) => catalog.accessories,
  gemeinschaftsprojekt: (catalog) => catalog.projects.map((project, index) => ({ ...project, sequenceNumber: index + 1 })),
  challenge_vorlage: (catalog) => catalog.challengeTemplates,
};

export const keyedEntryKinds = Object.keys(keyedEntries) as KeyedEntryKind[];

/** Die Einträge einer Art in Katalogreihenfolge. */
export function entriesOf<K extends KeyedEntryKind>(catalog: GameCatalog, kind: K): readonly CatalogEntries[K][] {
  return keyedEntries[kind](catalog);
}

export type CatalogLookup<T> = Readonly<{ type: 'found'; entry: T }> | Readonly<{ type: 'contract_error'; error: ContractError }>;

export type CatalogIndex = Readonly<{
  /** Eintrag einer Art; ein unbekannter Schlüssel, auch einer anderen Art, ergibt `unknown_catalog_key`. */
  find<K extends CatalogEntryKind>(kind: K, key: string): CatalogLookup<CatalogEntries[K]>;
}>;

/** Nachschlagen im Katalog, etwa für die Prüfung eines Befehls auf dem Server. */
export function indexCatalog(catalog: GameCatalog): CatalogIndex {
  const entries = new Map(
    keyedEntryKinds.map((kind) => [kind, new Map<string, unknown>(entriesOf(catalog, kind).map((entry) => [entry.key, entry]))]),
  );
  const fields = new Map<string, CatalogField>();
  const templates = new Map<string, FieldPlan>();
  for (const plan of fieldPlans(catalog)) {
    if (!plan.onIslandGrid) templates.set(plan.area, plan);
    else for (const field of plan.fields) fields.set(fieldKey(plan.area, field), { key: fieldKey(plan.area, field), area: plan.area, ...field });
  }

  const findField = (key: string): CatalogField | undefined => {
    const fixed = fields.get(key);
    if (fixed !== undefined) return fixed;
    const parsed = parseFieldKey(key);
    const endless = parsed === undefined ? undefined : parseEndlessAreaKey(parsed.area);
    const field = endless && templates.get(endless.template)?.fields.find(({ x, y }) => x === parsed!.x && y === parsed!.y);
    return field ? { key, area: parsed!.area, ...field } : undefined;
  };

  return {
    find(kind, key) {
      const entry = kind === 'feld' ? findField(key) : entries.get(kind)!.get(key);
      if (entry !== undefined) return { type: 'found', entry: entry as CatalogEntries[typeof kind] };
      // Ohne den Schlüssel selbst: Ein manipulierter Schlüssel wäre sonst Text im Kontext.
      return { type: 'contract_error', error: { code: 'unknown_catalog_key', context: { kind }, retryable: false } };
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
