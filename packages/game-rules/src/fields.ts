import type { IslandRole } from '@abnehm/contracts/island';

import type { FieldKind, FieldSide } from './catalog.ts';

// Feldkontingente und Platzierungsregeln (Spezifikation 4, Abschnitt 3; Feldaufteilung neu
// festgelegt, nicht belegt). Ein Objekt belegt genau ein Feld; ob das Feld frei ist, entscheidet
// das Gerät, und der Server verdrängt bei einem Konflikt ins Lager (Spezifikation 0, Abschnitt 10).

export type FieldQuota = Readonly<{ ecke: number; rollenbereich: number }>;

/** Felder je Person: zum Schlüpfen 20 Ecke und 40 Rollenbereich, je freigeschaltetem Gebiet +10 und +30. */
export function fieldQuota(unlockedAreas: number): FieldQuota {
  if (!Number.isInteger(unlockedAreas) || unlockedAreas < 0) {
    throw new RangeError(`Zahl der Gebiete muss eine ganze Zahl ab 0 sein: ${unlockedAreas}`);
  }
  return { ecke: 20 + 10 * unlockedAreas, rollenbereich: 40 + 30 * unlockedAreas };
}

/**
 * Seite, deren Felder eine Person beim Schlüpfen bekommt (beim Schneiden von #179 festgelegt, nicht
 * belegt). Neue Gebietsfelder einer Seite gehören derselben Person, auch nach einem Rollentausch.
 */
export function hatchingSide(role: IslandRole): FieldSide {
  return role === 'bauen' ? 'a' : 'b';
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

/**
 * Darf das Objekt auf das Feld? Eigene Ecke: alle Baupläne und Deko. Rollenbereich und eigene
 * Gebietsfelder: Baupläne der aktuellen eigenen Rolle und Deko. Strand, Lichtung, Gemeinschaftsplatz
 * und Felder des Partners: nichts.
 */
export function placement({ field, person, object }: PlacementRequest): PlacementDecision {
  if (field.kind === 'strand' || field.kind === 'lichtung' || field.kind === 'gemeinschaftsplatz') {
    return { type: 'verboten', reason: 'gemeinsamer_bereich' };
  }
  if (field.ownerPersonId !== person.personId) return { type: 'verboten', reason: 'fremdes_feld' };
  if (field.kind === 'rollenbereich' && object.type === 'bauplan' && object.role !== person.role) {
    return { type: 'verboten', reason: 'falsche_rolle' };
  }
  return { type: 'erlaubt' };
}
