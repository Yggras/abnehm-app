import type { IslandRole } from '@abnehm/contracts/island';

import { sharedFieldKinds, type FieldKind } from './catalog.ts';
import { assertWholeNumber } from './whole-number.ts';

// Feldkontingente und Platzierungsregeln (Spezifikation 4, Abschnitt 3; Feldaufteilung neu
// festgelegt, nicht belegt). Ein Objekt belegt genau ein Feld; ob das Feld frei ist, entscheidet
// das Gerät, und der Server verdrängt bei einem Konflikt ins Lager (Spezifikation 0, Abschnitt 10).

export type FieldQuota = Readonly<{ ecke: number; rollenbereich: number }>;

/** Felder je Person: zum Schlüpfen 20 Ecke und 40 Rollenbereich, je freigeschaltetem Gebiet +10 und +30. */
export function fieldQuota(unlockedAreas: number): FieldQuota {
  const areas = assertWholeNumber(unlockedAreas, 0, 'Zahl der Gebiete');
  return { ecke: 20 + 10 * areas, rollenbereich: 40 + 30 * areas };
}

export type PlacementRequest = Readonly<{
  /** Feldart aus dem Katalog und Besitzer des materialisierten Inselfelds. */
  field: Readonly<{ kind: FieldKind; ownerPersonId: string | null }>;
  /** Die platzierende Person mit ihrer aktuellen Rolle. */
  person: Readonly<{ personId: string; role: IslandRole }>;
  object: Readonly<{ type: 'bauplan'; role: IslandRole } | { type: 'deko' }>;
}>;

export type PlacementDecision =
  | Readonly<{ type: 'erlaubt' }>
  | Readonly<{ type: 'verboten'; reason: 'gemeinsamer_bereich' | 'fremdes_feld' | 'falsche_rolle' }>;

const shared: ReadonlySet<FieldKind> = new Set(sharedFieldKinds);

/**
 * Darf das Objekt auf das Feld? Eigene Ecke: alle Baupläne und Deko. Rollenbereich: Baupläne der
 * aktuellen eigenen Rolle und Deko. Strand, Lichtung, Gemeinschaftsplatz und Felder des Partners:
 * nichts. Ein Gebiet bringt je Person 10 Felder Ecke und 30 Felder Rollenbereich; seine „eigenen
 * Gebietsfelder“ im Sinne von Abschnitt 3 sind die Rollenbereich-Felder (Auslegung aus #179).
 */
export function placement({ field, person, object }: PlacementRequest): PlacementDecision {
  if (shared.has(field.kind)) return { type: 'verboten', reason: 'gemeinsamer_bereich' };
  if (field.ownerPersonId !== person.personId) return { type: 'verboten', reason: 'fremdes_feld' };
  if (field.kind === 'rollenbereich' && object.type === 'bauplan' && object.role !== person.role) {
    return { type: 'verboten', reason: 'falsche_rolle' };
  }
  return { type: 'erlaubt' };
}
