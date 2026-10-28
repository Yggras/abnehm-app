// Tracker-Regeln für Wasser, Sport und Gewicht (Spezifikation 3, Abschnitte 2 und 3). Reines
// TypeScript ohne Ein- und Ausgabe und ohne Bibliotheks- oder Plattformtypen: App und Server
// importieren dasselbe Modul und rechnen dadurch garantiert gleich. Deshalb hat die Datei keine
// Importe; lokale Tage und Zeitpunkte sind hier schlichte Zeichenfolgen.

/** Gültige Menge eines Wassereintrags in ml (Designwert aus Spezifikation 3, Abschnitt 3). */
export const waterAmountMl = { min: 1, max: 3000 } as const;

/** Wasser wird nie importiert; die Herkunft ist in V1 immer `manuell`. */
export const waterOrigin = 'manuell';

/** Was die Zählregel von einem Wassereintrag braucht. */
export type WaterEntryFacts = Readonly<{ amountMl: number; localDate: string; deletedAt: string | null }>;

/** Ob eine Menge als Wassereintrag gültig ist: ganze ml im Bereich 1–3000. */
export function isValidWaterAmount(ml: number): boolean {
  return Number.isInteger(ml) && ml >= waterAmountMl.min && ml <= waterAmountMl.max;
}

/**
 * Wasser-Zählregel: Alle nicht gelöschten Einträge eines lokalen Tags zählen 1:1, ohne Getränkearten
 * und ohne Gewichtung. Kalorienhaltige Getränke aus der Ernährung sind keine Wassereinträge und
 * zählen deshalb nicht (Spezifikation 3, Abschnitt 3; #38).
 */
export function countedWaterMl(entries: readonly WaterEntryFacts[], localDate: string): number {
  let sum = 0;
  for (const entry of entries) if (entry.deletedAt === null && entry.localDate === localDate) sum += entry.amountMl;
  return sum;
}

/** Neutraler Status eines Mini-Trackers auf „Heute“; nie `problem` (Spezifikation 3, Abschnitt 7). */
export type TrackerStatus = 'leer' | 'teil' | 'erreicht' | 'ueber_ziel';

/**
 * Status aus Wert und Ziel. Die Spezifikation nennt nur die vier Werte; die Grenzen sind eine
 * Festlegung von #171: `erreicht` genau auf dem Ziel, `ueber_ziel` darüber.
 */
export function trackerStatus(value: number, target: number): TrackerStatus {
  if (value <= 0) return 'leer';
  if (value < target) return 'teil';
  return value === target ? 'erreicht' : 'ueber_ziel';
}
