import { shownEnergy } from '@abnehm/contracts/energy';
import type { IslandRole } from '@abnehm/contracts/island';

import type { CatalogIndex } from './catalog.ts';
import { placement, type PlacementDecision } from './fields.ts';
import { basePrice } from './prices.ts';

// Bauen prüfen (Spezifikation 4, Abschnitte 3, 4 und 11): dieselbe Entscheidung auf Gerät und Server.
// Geprüft werden Katalogschlüssel, Freischaltung des Bauplans, Platzierungsregeln und der Bestand. Das
// Gerät erlaubt eine Ausgabe nur bei ausreichendem lokalem Bestand. Der Server lehnt erst ab, wenn der
// Bestand danach unter der Schutzgrenze läge: Zwei eigene Offline-Geräte dürfen sich überschneiden
// (#35), ein manipulierter Client kann sich aber nicht beliebig verschulden. Ob das Feld frei ist,
// prüft diese Regel nicht; das Gerät baut nur auf freie Felder, und der Server verdrängt bei einem
// Konflikt ins Lager.

/** Schutzgrenze des Servers (neu festgelegt in #83, Abschnitt 3; nicht belegt). */
export const serverDebtLimit = -30;

export type BuildRequest = Readonly<{
  blueprintKey: string;
  /** Feldschlüssel und Besitzer des materialisierten Inselfelds. */
  field: Readonly<{ key: string; ownerPersonId: string | null }>;
  /** Die bauende Person mit ihrer aktuellen Rolle. */
  person: Readonly<{ personId: string; role: IslandRole }>;
  /** Schlüssel der Baupläne, die die Insel freigeschaltet hat. */
  unlockedBlueprints: ReadonlySet<string>;
  /** Energiebestand der Person vor dem Bau: Summe aller Buchungen, auch negativ. */
  balance: number;
  /** `geraet`: nur bei ausreichendem Bestand; `server`: nur bis zur Schutzgrenze. */
  checkedBy: 'geraet' | 'server';
}>;

export type BuildRefusal =
  | Readonly<{ type: 'verboten'; reason: 'unbekannter_schluessel' | 'nicht_freigeschaltet' | 'schutzgrenze' }>
  | Readonly<{ type: 'verboten'; reason: Extract<PlacementDecision, { type: 'verboten' }>['reason'] }>
  /** Wie viel Energie zum Preis fehlt; die Oberfläche zeigt neutral „Noch ‹n› Energie“. */
  | Readonly<{ type: 'verboten'; reason: 'zu_wenig_energie'; missing: number }>;

export type BuildDecision = Readonly<{ type: 'erlaubt'; price: number }> | BuildRefusal;

export function decideBuild(catalog: CatalogIndex, { blueprintKey, field, person, unlockedBlueprints, balance, checkedBy }: BuildRequest): BuildDecision {
  const blueprint = catalog.find('bauplan', blueprintKey);
  const catalogField = catalog.find('feld', field.key);
  if (blueprint.type !== 'found' || catalogField.type !== 'found') return { type: 'verboten', reason: 'unbekannter_schluessel' };
  if (!unlockedBlueprints.has(blueprint.entry.key)) return { type: 'verboten', reason: 'nicht_freigeschaltet' };
  const placed = placement({
    field: { kind: catalogField.entry.kind, ownerPersonId: field.ownerPersonId },
    person,
    object: { type: 'bauplan', role: blueprint.entry.role },
  });
  if (placed.type === 'verboten') return placed;
  const price = basePrice(blueprint.entry);
  if (checkedBy === 'server') return balance - price < serverDebtLimit ? { type: 'verboten', reason: 'schutzgrenze' } : { type: 'erlaubt', price };
  // Ein negativer Zwischenstand zählt wie angezeigt als 0 (Spezifikation 0, Abschnitt 4).
  const available = shownEnergy(balance);
  return available < price ? { type: 'verboten', reason: 'zu_wenig_energie', missing: price - available } : { type: 'erlaubt', price };
}
