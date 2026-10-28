import type { IslandRole } from '@abnehm/contracts/island';

import { baseIslandKey, fieldKey, type FieldPlanEntry, type GameCatalog } from './catalog.ts';
import { fieldQuota, type FieldQuota } from './fields.ts';
import { areaLevels } from './unlocks.ts';

// Prüfung des Spielkatalogs gegen Format und Spielregeln (Spezifikation 4, Abschnitte 3–5). Läuft in
// den Tests über den ausgelieferten Katalog; jedes Inhalts-Ticket hält sie grün.

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

/** Alle Verstöße des Katalogs; leer, wenn er gültig ist. */
export function checkCatalog(catalog: GameCatalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const issue = (rule: CatalogRule, key: string) => issues.push({ rule, key });

  if (!Number.isInteger(catalog.version) || catalog.version < 1) issue('version', String(catalog.version));

  // Schlüssel: ein gemeinsamer Raum, weil ein Inselobjekt einen Bauplan- oder Dekoschlüssel trägt.
  const seen = new Set<string>();
  for (const { key } of [
    ...catalog.blueprints,
    ...catalog.deko,
    ...catalog.areas,
    ...catalog.landscapeTemplates,
    ...catalog.visitorTemplates,
    ...catalog.accessories,
    ...catalog.projects,
    ...catalog.challengeTemplates,
  ]) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) || key.startsWith('endlos_') || key === baseIslandKey) issue('schluessel_format', key);
    if (seen.has(key)) issue('schluessel_doppelt', key);
    seen.add(key);
  }

  const blueprints = new Map(catalog.blueprints.map((blueprint) => [blueprint.key, blueprint]));
  const deko = new Map(catalog.deko.map((entry) => [entry.key, entry]));
  const known = (map: ReadonlyMap<string, unknown>, key: string) => {
    if (!map.has(key)) issue('verweis_unbekannt', key);
    return map.has(key);
  };

  // Baupläne und Preise.
  for (const role of roles) {
    const prices = catalog.blueprints.flatMap((b) => (b.origin === 'start' && b.role === role ? [b.startPrice] : [])).sort((x, y) => x - y);
    if (prices.join() !== '1,2,3') issue('start_bauplaene', role);
  }
  for (const blueprint of catalog.blueprints) {
    if (blueprint.origin !== 'start' && !(Number.isInteger(blueprint.priceLevel) && blueprint.priceLevel >= 1)) {
      issue('preislevel', blueprint.key);
    }
  }

  // Level-Freischaltungen.
  const unlocked = new Set<string>();
  for (const { level, role, blueprint } of catalog.levelUnlocks) {
    const key = `${level}:${role}`;
    if (!Number.isInteger(level) || level < 2 || unlocked.has(key)) issue('level_freischaltung', key);
    unlocked.add(key);
    if (!known(blueprints, blueprint)) continue;
    const entry = blueprints.get(blueprint)!;
    if (entry.role !== role || entry.origin !== 'level') issue('level_freischaltung', key);
  }

  // Felder und Kontingente: Grundinsel mit dem Kontingent zum Schlüpfen, jedes Gebiet mit dem Zuwachs.
  const atHatching = fieldQuota(0);
  const perArea = { ecke: fieldQuota(1).ecke - atHatching.ecke, rollenbereich: fieldQuota(1).rollenbereich - atHatching.rollenbereich };
  const occupied = new Set<string>();
  const checkFields = (area: string, fields: readonly FieldPlanEntry[], quota: FieldQuota, sharesIsland: boolean) => {
    const local = new Set<string>();
    for (const field of fields) {
      if (!Number.isInteger(field.x) || !Number.isInteger(field.y)) issue('feld_koordinate', fieldKey(area, field));
      const position = `${field.x}:${field.y}`;
      if (local.has(position) || (sharesIsland && occupied.has(position))) issue('feld_doppelt', sharesIsland ? position : fieldKey(area, field));
      local.add(position);
      if (sharesIsland) occupied.add(position);
    }
    const count = (side: 'a' | 'b', kind: 'ecke' | 'rollenbereich') =>
      fields.filter((field) => field.kind === kind && 'side' in field && field.side === side).length;
    if ((['a', 'b'] as const).some((side) => count(side, 'ecke') !== quota.ecke || count(side, 'rollenbereich') !== quota.rollenbereich)) {
      issue('feldkontingent', area);
    }
  };
  checkFields(baseIslandKey, catalog.baseIsland.fields, atHatching, true);
  for (const area of catalog.areas) checkFields(area.key, area.fields, perArea, true);
  for (const template of catalog.landscapeTemplates) checkFields(template.key, template.fields, perArea, false);

  // Gebiete, Landschaftsvorlagen und Entdeckung.
  const discovery = (role: IslandRole, key: string) => {
    if (!known(blueprints, key)) return;
    const entry = blueprints.get(key)!;
    if (entry.role !== role || entry.origin !== 'entdeckung') issue('entdeckung', key);
  };
  const areaAt = new Set<number>();
  for (const area of catalog.areas) {
    if (!areaLevels.includes(area.unlockLevel) || areaAt.has(area.unlockLevel)) issue('gebiet_level', area.key);
    areaAt.add(area.unlockLevel);
    for (const role of roles) area.discoveryBlueprints[role].forEach((key) => discovery(role, key));
    for (const key of area.discoveryDeko) if (known(deko, key) && deko.get(key)!.origin !== 'entdeckung') issue('entdeckung', key);
  }
  for (const template of catalog.landscapeTemplates) for (const role of roles) discovery(role, template.discoveryBlueprints[role]);

  // Deko, Besucher, Challenges und Projekte.
  for (const entry of catalog.deko) {
    if (entry.origin === 'jahreszeit' && !(Number.isInteger(entry.yearIndex) && entry.yearIndex >= 1)) issue('jahreszeit', entry.key);
  }
  for (const visitor of catalog.visitorTemplates) {
    visitor.rewards.blueprints.forEach((key) => known(blueprints, key));
    visitor.rewards.deko.forEach((key) => known(deko, key));
  }
  for (const challenge of catalog.challengeTemplates) known(deko, challenge.deko);
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

/**
 * Wofür jeder Schlüssel steht: Art und die Eigenschaften, von denen gespeicherte Inseln abhängen,
 * etwa die Rolle eines Bauplans, Art und Seite eines Felds oder die Nummer eines Projekts. Felder
 * einer Landschaftsvorlage stehen als `‹vorlage›:‹x›:‹y›`, Level-Freischaltungen als `level:‹L›:‹rolle›`.
 */
export function catalogDedications(catalog: GameCatalog): Record<string, string> {
  const keys: Record<string, string> = {};
  const fields = (area: string, plan: readonly FieldPlanEntry[]) => {
    for (const field of plan) keys[fieldKey(area, field)] = 'side' in field ? `feld:${field.kind}:${field.side}` : `feld:${field.kind}`;
  };
  for (const blueprint of catalog.blueprints) keys[blueprint.key] = `bauplan:${blueprint.role}`;
  for (const { level, role, blueprint } of catalog.levelUnlocks) keys[`level:${level}:${role}`] = blueprint;
  fields(baseIslandKey, catalog.baseIsland.fields);
  for (const area of catalog.areas) {
    keys[area.key] = `gebiet:${area.unlockLevel}`;
    fields(area.key, area.fields);
  }
  for (const template of catalog.landscapeTemplates) {
    keys[template.key] = 'landschaftsvorlage';
    fields(template.key, template.fields);
  }
  for (const entry of catalog.deko) {
    keys[entry.key] = entry.origin === 'jahreszeit' ? `deko:jahreszeit:${entry.season}:${entry.yearIndex}` : `deko:${entry.origin}`;
  }
  for (const visitor of catalog.visitorTemplates) keys[visitor.key] = 'besuchervorlage';
  for (const accessory of catalog.accessories) keys[accessory.key] = `accessoire:${accessory.slot}`;
  catalog.projects.forEach((project, index) => (keys[project.key] = `gemeinschaftsprojekt:${index + 1}`));
  for (const challenge of catalog.challengeTemplates) keys[challenge.key] = 'challenge_vorlage';
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
