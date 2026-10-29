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

/**
 * Gültige manuelle Gewichtseingabe in g: 20,0–350,0 kg mit einer Nachkommastelle, gespeichert in
 * 100-g-Schritten (Designwert aus Spezifikation 3, Abschnitt 3). Importe behalten ihre genauen Gramm.
 */
export const manualWeightG = { min: 20_000, max: 350_000, step: 100 } as const;

/** Ob ein Gewicht als manuelle Eingabe gültig ist: ganze 100 g im Bereich 20,0–350,0 kg. */
export function isValidManualWeight(weightG: number): boolean {
  return Number.isInteger(weightG) && weightG % manualWeightG.step === 0 && weightG >= manualWeightG.min && weightG <= manualWeightG.max;
}

/** Was die Gewichtsregeln von einem Gewichtseintrag brauchen. */
export type WeightEntryFacts = Readonly<{
  weightG: number;
  measuredAt: string;
  localDate: string;
  deletedAt: string | null;
  hiddenAt: string | null;
}>;

/** Zählender Gewichtseintrag: nicht gelöscht und nicht ausgeblendet (Spezifikation 3, Abschnitt 3). */
export function isCountingWeightEntry(entry: WeightEntryFacts): boolean {
  return entry.deletedAt === null && entry.hiddenAt === null;
}

/** Tagesgewicht eines lokalen Tags. */
export type DayWeight = Readonly<{ localDate: string; weightG: number }>;

/**
 * Tagesgewichte aufsteigend nach lokalem Tag: je Tag die früheste zählende Messung. Weitere Messungen
 * desselben Tags bleiben gespeichert, zählen aber nicht als Tagesgewicht (#38). Maßgeblich ist der
 * gespeicherte lokale Tag des Eintrags, nicht das UTC-Datum seines Zeitpunkts.
 */
export function dayWeights(entries: readonly WeightEntryFacts[]): DayWeight[] {
  const earliest = new Map<string, WeightEntryFacts>();
  for (const entry of entries) {
    if (!isCountingWeightEntry(entry)) continue;
    const known = earliest.get(entry.localDate);
    if (known === undefined || Date.parse(entry.measuredAt) < Date.parse(known.measuredAt)) earliest.set(entry.localDate, entry);
  }
  return [...earliest.values()]
    .sort((a, b) => (a.localDate < b.localDate ? -1 : 1))
    .map(({ localDate, weightG }) => ({ localDate, weightG }));
}

/** Wiegetag: ein Wochenplantag mit dem Baustein Gewogen, gleich auf welchem Platz (`CONTEXT.md`). */
export function isWeighDay(bausteine: readonly string[]): boolean {
  return bausteine.includes('gewogen');
}

/** Plausibilitätsgrenze in g (Designwert aus #38): Ab mehr als 2 kg Abweichung fragt das Formular. */
export const typoLimitG = 2000;

/**
 * Ob das Formular vor dem Speichern „Tippfehler?“ fragt: Die Eingabe weicht um mehr als 2 kg vom
 * letzten Tagesgewicht ab. Genau 2,0 kg fragt nicht; ohne Tagesgewicht gibt es keinen Vergleich.
 */
export function asksForTypo(weightG: number, lastDayWeightG: number | null): boolean {
  return lastDayWeightG !== null && Math.abs(weightG - lastDayWeightG) > typoLimitG;
}

/** Neutrale Status eines Mini-Trackers auf „Heute“; nie `problem` (Spezifikation 3, Abschnitt 7). */
export const trackerStatuses = ['leer', 'teil', 'erreicht', 'ueber_ziel'] as const;
export type TrackerStatus = (typeof trackerStatuses)[number];

/**
 * Status aus Wert und Ziel. Spezifikation 3 nennt nur die vier Werte, keine Grenzen. #171 legt
 * fest: `erreicht` genau auf dem Ziel, `ueber_ziel` darüber. Gälte `erreicht` ab dem Ziel, wäre
 * `ueber_ziel` nie erreichbar; jede andere Grenze über dem Ziel wäre ein frei erfundener Wert.
 */
export function trackerStatus(value: number, target: number): TrackerStatus {
  if (value <= 0) return 'leer';
  if (value < target) return 'teil';
  return value === target ? 'erreicht' : 'ueber_ziel';
}
