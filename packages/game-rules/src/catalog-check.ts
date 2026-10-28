import { CatalogKey } from '@abnehm/contracts/base';
import type { IslandRole } from '@abnehm/contracts/island';

import {
  baseIslandKey,
  entriesOf,
  fieldKey,
  fieldPlans,
  isReservedKey,
  keyedEntryKinds,
  type CatalogEntries,
  type FieldPlan,
  type GameCatalog,
  type KeyedEntryKind,
} from './catalog.ts';
import { fieldQuota } from './fields.ts';
import { areaLevels } from './unlocks.ts';

// Prüfung des Spielkatalogs gegen Format und Spielregeln (Spezifikation 4, Abschnitte 3–5) und Widmung
// seiner Schlüssel für die Versionsprüfung. Läuft in den Tests über den ausgelieferten Katalog; jedes
// Inhalts-Ticket hält sie grün.

export type CatalogRule =
  | 'version'
  | 'schluessel_format'
  | 'schluessel_doppelt'
  | 'verweis_unbekannt'
  | 'start_bauplaene'
  | 'preislevel'
  | 'level_freischaltung'
  | 'feldkontingent'
  | 'feld_doppelt'
  | 'feld_koordinate'
  | 'gebiet_level'
  | 'entdeckung'
  | 'bauplatz'
  | 'jahreszeit';

export type CatalogIssue = Readonly<{ rule: CatalogRule; key: string }>;

const roles: readonly IslandRole[] = ['bauen', 'natur'];
const isWholeNumberFrom = (value: number, min: number) => Number.isInteger(value) && value >= min;

/** Alle Verstöße des Katalogs; leer, wenn er gültig ist. */
export function checkCatalog(catalog: GameCatalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const issue = (rule: CatalogRule, key: string) => issues.push({ rule, key });

  if (!isWholeNumberFrom(catalog.version, 1)) issue('version', String(catalog.version));

  // Schlüssel: ein gemeinsamer Raum, weil ein Inselobjekt einen Bauplan- oder Dekoschlüssel trägt.
  const seen = new Set<string>();
  for (const { key } of keyedEntryKinds.flatMap((kind) => entriesOf(catalog, kind))) {
    if (!CatalogKey.safeParse(key).success || isReservedKey(key)) issue('schluessel_format', key);
    if (seen.has(key)) issue('schluessel_doppelt', key);
    seen.add(key);
  }

  const blueprints = new Map(catalog.blueprints.map((blueprint) => [blueprint.key, blueprint]));
  const deko = new Map(catalog.deko.map((entry) => [entry.key, entry]));
  /** Meldet einen Verweis auf einen fehlenden Eintrag; liefert, ob der Eintrag existiert. */
  const checkReference = (entries: ReadonlyMap<string, unknown>, key: string) => {
    if (!entries.has(key)) issue('verweis_unbekannt', key);
    return entries.has(key);
  };

  // Baupläne und Preise.
  for (const role of roles) {
    const prices = catalog.blueprints.flatMap((b) => (b.origin === 'start' && b.role === role ? [b.startPrice] : [])).sort((x, y) => x - y);
    if (prices.join() !== '1,2,3') issue('start_bauplaene', role);
  }
  for (const blueprint of catalog.blueprints) {
    if (blueprint.origin !== 'start' && !isWholeNumberFrom(blueprint.priceLevel, 1)) issue('preislevel', blueprint.key);
  }

  // Level-Freischaltungen.
  const unlocked = new Set<string>();
  for (const { level, role, blueprint } of catalog.levelUnlocks) {
    const key = `${level}:${role}`;
    if (!isWholeNumberFrom(level, 2) || unlocked.has(key)) issue('level_freischaltung', key);
    unlocked.add(key);
    if (!checkReference(blueprints, blueprint)) continue;
    const entry = blueprints.get(blueprint)!;
    if (entry.role !== role || entry.origin !== 'level') issue('level_freischaltung', key);
  }

  // Felder und Kontingente: Grundinsel mit dem Kontingent zum Schlüpfen, jedes Gebiet mit dem Zuwachs.
  const atHatching = fieldQuota(0);
  const quotaOf = (plan: FieldPlan) =>
    plan.source === 'grundinsel'
      ? atHatching
      : { ecke: fieldQuota(1).ecke - atHatching.ecke, rollenbereich: fieldQuota(1).rollenbereich - atHatching.rollenbereich };
  const onIsland = new Set<string>();
  for (const plan of fieldPlans(catalog)) {
    // Grundinsel und feste Gebiete teilen ein Raster; Vorlagen haben je ein eigenes.
    const occupied = plan.source === 'landschaftsvorlage' ? new Set<string>() : onIsland;
    for (const field of plan.fields) {
      if (!Number.isInteger(field.x) || !Number.isInteger(field.y)) issue('feld_koordinate', fieldKey(plan.area, field));
      const position = `${field.x}:${field.y}`;
      if (occupied.has(position)) issue('feld_doppelt', plan.source === 'landschaftsvorlage' ? fieldKey(plan.area, field) : position);
      occupied.add(position);
    }
    const quota = quotaOf(plan);
    const count = (side: 'a' | 'b', kind: 'ecke' | 'rollenbereich') =>
      plan.fields.filter((field) => field.kind === kind && 'side' in field && field.side === side).length;
    if ((['a', 'b'] as const).some((side) => count(side, 'ecke') !== quota.ecke || count(side, 'rollenbereich') !== quota.rollenbereich)) {
      issue('feldkontingent', plan.area);
    }
  }

  // Gebiete, Landschaftsvorlagen und Entdeckung.
  const checkDiscovery = (role: IslandRole, key: string) => {
    if (!checkReference(blueprints, key)) return;
    const entry = blueprints.get(key)!;
    if (entry.role !== role || entry.origin !== 'entdeckung') issue('entdeckung', key);
  };
  const areaAt = new Set<number>();
  for (const area of catalog.areas) {
    if (!areaLevels.includes(area.unlockLevel) || areaAt.has(area.unlockLevel)) issue('gebiet_level', area.key);
    areaAt.add(area.unlockLevel);
    for (const role of roles) area.discoveryBlueprints[role].forEach((key) => checkDiscovery(role, key));
    for (const key of area.discoveryDeko) {
      if (checkReference(deko, key) && deko.get(key)!.origin !== 'entdeckung') issue('entdeckung', key);
    }
  }
  for (const template of catalog.landscapeTemplates) for (const role of roles) checkDiscovery(role, template.discoveryBlueprints[role]);

  // Deko, Besucher, Challenges und Projekte.
  for (const entry of catalog.deko) {
    if (entry.origin === 'jahreszeit' && !isWholeNumberFrom(entry.yearIndex, 1)) issue('jahreszeit', entry.key);
  }
  for (const visitor of catalog.visitorTemplates) {
    visitor.rewards.blueprints.forEach((key) => checkReference(blueprints, key));
    visitor.rewards.deko.forEach((key) => checkReference(deko, key));
  }
  for (const challenge of catalog.challengeTemplates) checkReference(deko, challenge.deko);
  const plaza = new Set(catalog.baseIsland.fields.filter((f) => f.kind === 'gemeinschaftsplatz').map((f) => fieldKey(baseIslandKey, f)));
  const sites = new Set<string>();
  for (const project of catalog.projects) {
    if (!plaza.has(project.site) || sites.has(project.site)) issue('bauplatz', project.key);
    sites.add(project.site);
  }

  return issues;
}

/** Schlüssel einer Katalogversion mit ihrer Widmung, sortiert; liegt je Version unter `catalog-versions/`. */
export type CatalogSnapshot = Readonly<{ version: number; keys: Readonly<Record<string, string>> }>;

// Wofür ein Schlüssel steht: Art und die Eigenschaften, von denen gespeicherte Inseln abhängen. Eine
// neue Art in `CatalogEntries` ist hier ein Typfehler, bis ihre Widmung eingetragen ist.
const dedications: { [K in KeyedEntryKind]: (entry: CatalogEntries[K]) => string } = {
  bauplan: (blueprint) => `bauplan:${blueprint.role}`,
  deko: (entry) => (entry.origin === 'jahreszeit' ? `deko:jahreszeit:${entry.season}:${entry.yearIndex}` : `deko:${entry.origin}`),
  gebiet: (area) => `gebiet:${area.unlockLevel}`,
  landschaftsvorlage: () => 'landschaftsvorlage',
  besuchervorlage: () => 'besuchervorlage',
  accessoire: (accessory) => `accessoire:${accessory.slot}`,
  gemeinschaftsprojekt: (project) => `gemeinschaftsprojekt:${project.sequenceNumber}`,
  challenge_vorlage: () => 'challenge_vorlage',
};

/**
 * Widmung aller Schlüssel: Einträge je Art, Felder als `feld:‹art›[:‹seite›]` (Felder einer
 * Landschaftsvorlage unter `‹vorlage›:‹x›:‹y›`) und Level-Freischaltungen als `level:‹L›:‹rolle›`.
 */
export function catalogDedications(catalog: GameCatalog): Record<string, string> {
  const keys: Record<string, string> = {};
  for (const kind of keyedEntryKinds) {
    const dedicate = dedications[kind] as (entry: CatalogEntries[KeyedEntryKind]) => string;
    for (const entry of entriesOf(catalog, kind)) keys[entry.key] = dedicate(entry);
  }
  for (const { level, role, blueprint } of catalog.levelUnlocks) keys[`level:${level}:${role}`] = blueprint;
  for (const plan of fieldPlans(catalog)) {
    for (const field of plan.fields) keys[fieldKey(plan.area, field)] = 'side' in field ? `feld:${field.kind}:${field.side}` : `feld:${field.kind}`;
  }
  return Object.fromEntries(Object.entries(keys).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Schlüssel der vorigen Version, die fehlen oder anders gewidmet sind; Ergänzungen sind erlaubt. */
export function catalogChanges(previous: CatalogSnapshot, current: CatalogSnapshot): { removed: string[]; rededicated: string[] } {
  const entries = Object.entries(previous.keys);
  return {
    removed: entries.filter(([key]) => !Object.hasOwn(current.keys, key)).map(([key]) => key),
    rededicated: entries.filter(([key, dedication]) => Object.hasOwn(current.keys, key) && current.keys[key] !== dedication).map(([key]) => key),
  };
}
