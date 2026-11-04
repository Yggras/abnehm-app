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

/** Herkunft eines von Hand erfassten Sport- oder Gewichtseintrags; Importe kommen aus Apple Health bzw. Health Connect. */
export const manualOrigin = 'manuell';

/**
 * Ob ein Zeitpunkt nach „jetzt“ liegt; Zeitpunkte in der Zukunft sind nicht erlaubt (Spezifikation 3,
 * Abschnitt 4). Verglichen werden Zeitpunkte, nicht Zeichenfolgen; „jetzt“ gibt der Aufrufer aus seiner Uhr.
 */
export function isInFuture(instant: string, now: string): boolean {
  return Date.parse(instant) > Date.parse(now);
}

/**
 * Aktivitätsarten aus #38, jeweils mit Symbol in der Oberfläche. Plattformarten bildet der Health-Import
 * auf diese Liste ab; Unbekanntes wird `sonstiges`. Es gibt keine Intensität: Jede Minute zählt 1:1, eine
 * bewusste Vereinfachung gegenüber der WHO-Äquivalenz (Spezifikation 3, Abschnitt 3).
 */
export const activityTypes = ['gehen', 'laufen', 'radfahren', 'schwimmen', 'krafttraining', 'yoga_dehnen', 'mannschaftssport', 'sonstiges'] as const;
export type ActivityType = (typeof activityTypes)[number];

/** Herkunft eines importierten Eintrags (Spezifikation 3, Abschnitt 6). */
export const importOrigins = ['apple_health', 'health_connect'] as const;

/** Dauer eines Sporteintrags laut Schema in ganzen Minuten; Importe außerhalb werden nicht übernommen. */
export const sportEntryMinutes = { min: 1, max: 1440 } as const;

/** Gültige manuelle Dauer in ganzen Minuten (Designwert aus Spezifikation 3, Abschnitt 3). */
export const manualSportMinutes = { min: 1, max: 600 } as const;

/** Gültige optionale Kalorien einer manuellen Einheit: 0–5000 kcal in `milli_kcal` (Designwert). */
export const manualSportMilliKcal = { min: 0, max: 5_000_000 } as const;

/** Ob eine Dauer als manuelle Einheit gültig ist: ganze Minuten im Bereich 1–600. */
export function isValidManualSportMinutes(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= manualSportMinutes.min && minutes <= manualSportMinutes.max;
}

/** Ob optionale Kalorien gültig sind: keine Angabe oder ganze `milli_kcal` im Bereich 0–5000 kcal. */
export function isValidManualSportMilliKcal(milliKcal: number | null): boolean {
  return milliKcal === null || (Number.isInteger(milliKcal) && milliKcal >= manualSportMilliKcal.min && milliKcal <= manualSportMilliKcal.max);
}

/** Was die Sport-Zählregel von einem Sporteintrag braucht. */
export type SportEntryFacts = Readonly<{
  id: string;
  origin: string;
  durationMinutes: number;
  localDate: string;
  deletedAt: string | null;
  /** Nur bei Importen. */
  hiddenAt: string | null;
  /** Nur bei manuellen Einträgen: der ersetzende Import. */
  replacedByEntryId: string | null;
  /** Nur bei manuellen Einträgen. */
  reactivatedAt: string | null;
}>;

/**
 * Zählende Sporteinträge (Spezifikation 3, Abschnitt 3), in der gegebenen Reihenfolge:
 * - Ein importierter Eintrag zählt, wenn er weder gelöscht noch ausgeblendet ist.
 * - Ein manueller Eintrag zählt, wenn er nicht gelöscht ist und keinen „ersetzt durch“-Verweis hat, reaktiviert
 *   ist oder sein ersetzender Import nicht mehr zählt.
 *
 * Die letzte Bedingung wird hier berechnet und nie gespeichert; so bleibt sie bei Mehrgeräte-Sync
 * widerspruchsfrei. Der ersetzende Import muss deshalb unter `entries` sein. Fehlt er, zählt der manuelle
 * Eintrag, damit kein Training verschwindet.
 */
export function countingSportEntries<T extends SportEntryFacts>(entries: readonly T[]): T[] {
  const countingImports = new Set(entries.filter((entry) => entry.origin !== manualOrigin && isCountingImport(entry)).map((entry) => entry.id));
  return entries.filter((entry) => {
    if (entry.origin !== manualOrigin) return countingImports.has(entry.id);
    if (entry.deletedAt !== null) return false;
    return entry.replacedByEntryId === null || entry.reactivatedAt !== null || !countingImports.has(entry.replacedByEntryId);
  });
}

function isCountingImport(entry: SportEntryFacts): boolean {
  return entry.deletedAt === null && entry.hiddenAt === null;
}

/** Montag und Sonntag der Woche eines lokalen Tags (Spezifikation 3, Abschnitt 3: Montag bis Sonntag). */
export function weekOf(localDate: string): Readonly<{ monday: string; sunday: string }> {
  const day = calendarDay(localDate);
  // `getUTCDay` zählt ab Sonntag (0); die Woche beginnt am Montag.
  const monday = day - ((new Date(day * msPerDay).getUTCDay() + 6) % 7);
  return { monday: localDateOf(monday), sunday: localDateOf(monday + 6) };
}

/**
 * Wochenminuten: die Summe der zählenden Einträge, deren gespeicherter lokaler Tag in der Woche (Montag bis
 * Sonntag) von `localDate` liegt; jede Minute zählt 1:1. Maßgeblich ist der lokale Tag des Eintrags, nicht
 * die Stundenzahl der Woche, deshalb ändert ein Sommerzeitwechsel nichts.
 */
export function weekMinutes(entries: readonly SportEntryFacts[], localDate: string): number {
  const { monday, sunday } = weekOf(localDate);
  let sum = 0;
  for (const entry of countingSportEntries(entries)) if (entry.localDate >= monday && entry.localDate <= sunday) sum += entry.durationMinutes;
  return sum;
}

// Kalenderrechnung auf lokalen Tagen (`YYYY-MM-DD`): Ein lokaler Tag ist ein Datum, kein Zeitpunkt. UTC dient
// nur als zonenfreier Kalender; das Modul hat bewusst keine Importe.
const msPerDay = 86_400_000;

function calendarDay(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / msPerDay;
}

function localDateOf(day: number): string {
  return new Date(day * msPerDay).toISOString().slice(0, 10);
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

/**
 * Das letzte Gewicht: die zuletzt gemessene zählende Messung, auch nach dem Tagesgewicht desselben Tags.
 * Das Formular füllt es vor, damit die Person nur die Änderung tippt (#38); ohne Messung `null`.
 */
export function lastWeightG(entries: readonly WeightEntryFacts[]): number | null {
  let last: WeightEntryFacts | null = null;
  for (const entry of entries) {
    if (isCountingWeightEntry(entry) && (last === null || Date.parse(entry.measuredAt) > Date.parse(last.measuredAt))) last = entry;
  }
  return last?.weightG ?? null;
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
