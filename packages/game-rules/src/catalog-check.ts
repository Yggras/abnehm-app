import { CatalogKey } from '@abnehm/contracts/base';
import { IslandRole } from '@abnehm/contracts/island';

import {
  baseIslandKey,
  entriesOf,
  fieldKey,
  fieldPlans,
  isReservedKey,
  keyedEntryKinds,
  type ChallengeMeasure,
  type FieldPlan,
  type FieldSide,
  type GameCatalog,
  type OwnedFieldKind,
} from './catalog.ts';
import { fieldQuota } from './fields.ts';
import { areaLevels } from './unlocks.ts';
import { isWholeNumber } from './whole-number.ts';

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
  | 'jahreszeit'
  | 'besucher'
  | 'challenge';

export type CatalogIssue = Readonly<{ rule: CatalogRule; key: string }>;

const roles = IslandRole.options;
const sides: readonly FieldSide[] = ['a', 'b'];

/** Alle Verstöße des Katalogs; leer, wenn er gültig ist. */
export function checkCatalog(catalog: GameCatalog): CatalogIssue[] {
  const issues: CatalogIssue[] = [];
  const issue = (rule: CatalogRule, key: string) => issues.push({ rule, key });

  if (!isWholeNumber(catalog.version, 1)) issue('version', String(catalog.version));

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
    if (blueprint.origin !== 'start' && !isWholeNumber(blueprint.priceLevel, 1)) issue('preislevel', blueprint.key);
  }

  // Level-Freischaltungen.
  const unlocked = new Set<string>();
  for (const { level, role, blueprint } of catalog.levelUnlocks) {
    const key = `${level}:${role}`;
    if (!isWholeNumber(level, 2) || unlocked.has(key)) issue('level_freischaltung', key);
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
    const occupied = plan.onIslandGrid ? onIsland : new Set<string>();
    for (const field of plan.fields) {
      if (!Number.isInteger(field.x) || !Number.isInteger(field.y)) issue('feld_koordinate', fieldKey(plan.area, field));
      const position = `${field.x}:${field.y}`;
      if (occupied.has(position)) issue('feld_doppelt', plan.onIslandGrid ? position : fieldKey(plan.area, field));
      occupied.add(position);
    }
    const quota = quotaOf(plan);
    const count = (side: FieldSide, kind: OwnedFieldKind) =>
      plan.fields.filter((field) => field.kind === kind && 'side' in field && field.side === side).length;
    if (sides.some((side) => count(side, 'ecke') !== quota.ecke || count(side, 'rollenbereich') !== quota.rollenbereich)) {
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
    if (entry.origin === 'jahreszeit' && !isWholeNumber(entry.yearIndex, 1)) issue('jahreszeit', entry.key);
  }
  // Besucher bringen Besucher-Baupläne und, wenn keiner mehr übrig ist, Deko aus ihrem Pool (#202).
  for (const visitor of catalog.visitorTemplates) {
    const foreign = [
      ...visitor.rewards.blueprints.filter((key) => checkReference(blueprints, key) && blueprints.get(key)!.origin !== 'besucher'),
      ...visitor.rewards.deko.filter((key) => checkReference(deko, key) && deko.get(key)!.origin !== 'besucher'),
    ];
    if (foreign.length > 0 || visitor.rewards.deko.length === 0) issue('besucher', visitor.key);
  }
  // Challenge-Vorlagen belohnen mit Challenge-Deko und verlangen je Person einen erreichbaren Anteil (#210).
  for (const challenge of catalog.challengeTemplates) {
    const ownDeko = checkReference(deko, challenge.deko) && deko.get(challenge.deko)!.origin === 'challenge';
    if (!ownDeko || !measureFits(challenge.measure)) issue('challenge', challenge.key);
  }
  const plaza = new Set(catalog.baseIsland.fields.filter((f) => f.kind === 'gemeinschaftsplatz').map((f) => fieldKey(baseIslandKey, f)));
  const sites = new Set<string>();
  for (const project of catalog.projects) {
    if (!plaza.has(project.site) || sites.has(project.site)) issue('bauplatz', project.key);
    sites.add(project.site);
  }

  return issues;
}

/**
 * Ein Maß ist erreichbar: eine feste Zahl von 1 bis 21 Tageszielen (drei je Tag) bzw. ein Bruchteil der
 * geplanten Tage zwischen 0 und 1, sodass jeder geplante Tag zählt und nie mehr als geplant verlangt wird.
 */
function measureFits(measure: ChallengeMeasure): boolean {
  if (measure.type === 'tagesziele') return isWholeNumber(measure.required, 1) && measure.required <= 21;
  return isWholeNumber(measure.numerator, 1) && isWholeNumber(measure.denominator, 1) && measure.numerator <= measure.denominator;
}
