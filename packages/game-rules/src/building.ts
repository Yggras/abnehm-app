import type { IslandRole } from '@abnehm/contracts/island';
import type { IslandObjectOrigin } from '@abnehm/contracts/island-records';

import type { CatalogIndex, Stage } from './catalog.ts';
import { placement, type PlacementDecision, type PlacementRequest } from './fields.ts';
import { basePrice, upgradePrice } from './prices.ts';
import { spend, type Checker, type SpendingRefusal } from './spending.ts';

// Bauen, Aufwerten und Platzieren prüfen (Spezifikation 4, Abschnitte 3, 4, 7 und 11): dieselbe
// Entscheidung auf Gerät und Server. Geprüft werden Katalogschlüssel, Freischaltung des Bauplans,
// Stufe, Platzierungsregeln und der Bestand (`spending.ts`). Ob das Feld frei ist, prüfen diese Regeln nicht; das Gerät baut und platziert nur auf freie
// Felder, und der Server verdrängt bei einem Konflikt ins Lager. Platzieren ist kostenlos (#194).

export { serverDebtLimit } from './spending.ts';

/** Feldschlüssel und Besitzer eines materialisierten Inselfelds. */
type FieldRef = Readonly<{ key: string; ownerPersonId: string | null }>;

/** Die handelnde Person mit ihrer aktuellen Rolle. */
type Person = Readonly<{ personId: string; role: IslandRole }>;

export type BuildRequest = Readonly<{
  blueprintKey: string;
  field: FieldRef;
  /** Die bauende Person mit ihrer aktuellen Rolle. */
  person: Person;
  /** Schlüssel der Baupläne, die die Insel freigeschaltet hat. */
  unlockedBlueprints: ReadonlySet<string>;
  /** Energiebestand der Person vor dem Bau: Summe aller Buchungen, auch negativ. */
  balance: number;
  checkedBy: Checker;
}>;

type PlacementRefusal = Readonly<{ type: 'verboten'; reason: Extract<PlacementDecision, { type: 'verboten' }>['reason'] }>;

export type BuildRefusal =
  | Readonly<{ type: 'verboten'; reason: 'unbekannter_schluessel' | 'nicht_freigeschaltet' }>
  | PlacementRefusal
  | SpendingRefusal;

export type BuildDecision = Readonly<{ type: 'erlaubt'; price: number }> | BuildRefusal;

export function decideBuild(catalog: CatalogIndex, { blueprintKey, field, person, unlockedBlueprints, balance, checkedBy }: BuildRequest): BuildDecision {
  const blueprint = catalog.find('bauplan', blueprintKey);
  const kind = fieldKind(catalog, field);
  if (blueprint.type !== 'found' || kind === null) return { type: 'verboten', reason: 'unbekannter_schluessel' };
  if (!unlockedBlueprints.has(blueprint.entry.key)) return { type: 'verboten', reason: 'nicht_freigeschaltet' };
  const placed = placement({ field: kind, person, object: { type: 'bauplan', role: blueprint.entry.role } });
  if (placed.type === 'verboten') return placed;
  return spend(basePrice(blueprint.entry), balance, checkedBy);
}

/** Die Stufe nach `level`, auf die sich aufwerten lässt; `null` ab Stufe 3. */
export function nextStage(level: number): Exclude<Stage, 1> | null {
  return level === 1 ? 2 : level === 2 ? 3 : null;
}

/** Ein Inselobjekt, wie Gerät und Server es führen: Katalogschlüssel und Herkunft, beim Aufwerten mit Stufe. */
type ObjectRef = Readonly<{ catalogKey: string; origin: IslandObjectOrigin }>;

export type UpgradeRequest = Readonly<{
  object: ObjectRef & Readonly<{ level: number }>;
  /** Zielstufe; aufgewertet wird genau eine Stufe weiter. */
  toLevel: Exclude<Stage, 1>;
  /** Energiebestand der Person vor dem Aufwerten: Summe aller Buchungen, auch negativ. */
  balance: number;
  checkedBy: Checker;
}>;

export type UpgradeRefusal =
  /** Deko hat keine Stufen; aufwerten lässt sich nur mit Energie Gebautes. */
  | Readonly<{ type: 'verboten'; reason: 'unbekannter_schluessel' | 'nicht_aufwertbar' | 'falsche_stufe' }>
  | SpendingRefusal;

export type UpgradeDecision = Readonly<{ type: 'erlaubt'; price: number }> | UpgradeRefusal;

/**
 * Aufwerten (Spezifikation 4, Abschnitt 3): ein gebautes Objekt genau eine Stufe weiter, höchstens auf
 * Stufe 3, zum 2- bzw. 3-Fachen des Grundpreises. Steht das Objekt schon auf der Zielstufe, etwa weil ein
 * anderes eigenes Gerät offline dasselbe aufgewertet hat, ist das `falsche_stufe`: So zahlt niemand zweimal.
 */
export function decideUpgrade(catalog: CatalogIndex, { object, toLevel, balance, checkedBy }: UpgradeRequest): UpgradeDecision {
  if (object.origin !== 'gebaut') return { type: 'verboten', reason: 'nicht_aufwertbar' };
  const blueprint = catalog.find('bauplan', object.catalogKey);
  if (blueprint.type !== 'found') return { type: 'verboten', reason: 'unbekannter_schluessel' };
  if (nextStage(object.level) !== toLevel) return { type: 'verboten', reason: 'falsche_stufe' };
  return spend(upgradePrice(blueprint.entry, toLevel), balance, checkedBy);
}

export type PlaceRequest = Readonly<{
  object: ObjectRef;
  field: FieldRef;
  /** Die platzierende Person mit ihrer aktuellen Rolle. */
  person: Person;
}>;

export type PlaceDecision = Readonly<{ type: 'erlaubt' }> | Readonly<{ type: 'verboten'; reason: 'unbekannter_schluessel' }> | PlacementRefusal;

/**
 * Platzieren auf ein Feld (Spezifikation 4, Abschnitte 3 und 7): dieselben Platzierungsregeln wie beim
 * Bauen, für Gebautes mit der Rolle seines Bauplans und der aktuellen eigenen Rolle, für Deko überall auf
 * eigenen Feldern. Einlagern ist immer erlaubt und braucht diese Regel nicht.
 */
export function decidePlacement(catalog: CatalogIndex, { object, field, person }: PlaceRequest): PlaceDecision {
  const kind = fieldKind(catalog, field);
  const placed = placedAs(catalog, object);
  if (kind === null || placed === null) return { type: 'verboten', reason: 'unbekannter_schluessel' };
  return placement({ field: kind, person, object: placed });
}

/** Feldart aus dem Katalog samt Besitzer; `null` bei einem unbekannten Feldschlüssel. */
function fieldKind(catalog: CatalogIndex, field: FieldRef): PlacementRequest['field'] | null {
  const found = catalog.find('feld', field.key);
  return found.type === 'found' ? { kind: found.entry.kind, ownerPersonId: field.ownerPersonId } : null;
}

/** Wie die Platzierungsregeln ein Objekt sehen: Gebautes mit der Rolle seines Bauplans, sonst Deko. */
function placedAs(catalog: CatalogIndex, object: ObjectRef): PlacementRequest['object'] | null {
  if (object.origin === 'gebaut') {
    const blueprint = catalog.find('bauplan', object.catalogKey);
    return blueprint.type === 'found' ? { type: 'bauplan', role: blueprint.entry.role } : null;
  }
  return catalog.find('deko', object.catalogKey).type === 'found' ? { type: 'deko' } : null;
}
