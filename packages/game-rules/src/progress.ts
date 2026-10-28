import { summarizeEnergy, type EnergyBooking } from '@abnehm/contracts/energy';

import { assertLevel, assertWholeNumber } from './whole-number.ts';

// Verbaute Energie, Levelkurve und Hälften (Spezifikation 4, Abschnitt 3; Werte aus #18, nicht belegt).
// Eingabe sind die Buchungen je Person, Ausgabe Level und Hälften für `IslandProgress`. Bestand und
// Anzeige `max(0, Summe)` liefert das Fundament (`summarizeEnergy`, `shownEnergy`).

/** Was zu einer Insel gehört: ihre Objekte und Gemeinschaftsprojekte. */
export type IslandHoldings = Readonly<{ objectIds: ReadonlySet<string>; projectIds: ReadonlySet<string> }>;

/**
 * `S_p(I)`: Beträge aller Ausgaben einer Person (`build_debit`, `upgrade_debit`,
 * `project_contribution_debit`) für Objekte und Projekte der Insel, Gegenbuchungen mit Gegenzeichen.
 * Mit einer neuen Insel beginnt `S_p` daher bei 0, die Energie bleibt.
 */
export function spentOnIsland(bookings: readonly EnergyBooking[], island: IslandHoldings): number {
  if (new Set(bookings.map((booking) => booking.personId)).size > 1) throw new Error('Verbaute Energie gilt je Insel und einer Person');
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));
  const onIsland = (booking: EnergyBooking): boolean => {
    switch (booking.type) {
      case 'build_debit':
      case 'upgrade_debit':
        return island.objectIds.has(booking.trigger.islandObjectId);
      case 'project_contribution_debit':
        return island.projectIds.has(booking.trigger.projectId);
      case 'counter_booking': {
        const original = byId.get(booking.trigger.originalBookingId);
        if (original === undefined) throw new Error(`Gegenbuchung ${booking.id} ohne ursprüngliche Buchung`);
        return onIsland(original);
      }
      default:
        return false;
    }
  };
  return summarizeEnergy(bookings.filter(onIsland)).levelHalf;
}

/** Ab diesem Level ist der Bedarf je Hälfte gedeckelt. */
const cappedFrom = 20;
const cappedNeed = 30;
/** Schwelle(20) = Σ (10 + k) für k = 1 … 19. */
const cappedThreshold = 380;

/**
 * Hälfte einer Person am Levelbalken, mit den Feldnamen von `IslandProgress`: `halfPercent` ist
 * abgerundet und nur bei voller Hälfte 100.
 */
export type MemberHalf = Readonly<{ halfPercent: number; halfFull: boolean }>;

/** Die berechneten Werte von `IslandProgress`; Personen, Projekt und Versionen ergänzt der Projector. */
export type LevelProgress = Readonly<{
  level: number;
  /** Bedarf je Hälfte im aktuellen Level. */
  levelNeed: number;
  /** In der Reihenfolge der übergebenen Stände. */
  halves: readonly [MemberHalf, MemberHalf];
}>;

/** Bedarf(L) = min(10 + L, 30): verbaute Energie, die jede Hälfte in Level L braucht. */
export function levelNeed(level: number): number {
  assertLevel(level);
  return Math.min(10 + level, cappedNeed);
}

/** Schwelle(L) = Σ Bedarf(k) für k < L: verbaute Energie, ab der eine Person Level L erreicht hat. */
export function levelThreshold(level: number): number {
  assertLevel(level);
  if (level >= cappedFrom) return cappedThreshold + cappedNeed * (level - cappedFrom);
  const below = level - 1;
  return 10 * below + (below * level) / 2;
}

/**
 * Level, Bedarf und beide Hälften aus der verbauten Energie beider Personen (`S_A`, `S_B`). Das Level
 * ist das größte L, bei dem beide die Schwelle erreichen; Überschuss bleibt in der Hälfte erhalten.
 */
export function islandProgress(spent: readonly [number, number]): LevelProgress {
  const [a, b] = spent;
  const level = levelReachedBy(Math.min(assertSpent(a), assertSpent(b)));
  return { level, levelNeed: levelNeed(level), halves: [memberHalf(a, level), memberHalf(b, level)] };
}

/**
 * Hälfte einer Person auf einem Level: `min(S − Schwelle(L), Bedarf(L)) / Bedarf(L)`. Auf dem Gerät
 * kommt das Level aus der Projektion; liegt der lokale Stand darunter, ist die Hälfte leer.
 */
export function memberHalf(spent: number, level: number): MemberHalf {
  const need = levelNeed(level);
  const filled = Math.min(Math.max(assertSpent(spent) - levelThreshold(level), 0), need);
  return { halfPercent: Math.floor((100 * filled) / need), halfFull: filled === need };
}

/** Größtes L mit S ≥ Schwelle(L); oberhalb des Deckels direkt berechnet. */
function levelReachedBy(spent: number): number {
  if (spent >= cappedThreshold) return cappedFrom + Math.floor((spent - cappedThreshold) / cappedNeed);
  let level = 1;
  while (levelThreshold(level + 1) <= spent) level += 1;
  return level;
}

const assertSpent = (spent: number) => assertWholeNumber(spent, 0, 'Verbaute Energie');
