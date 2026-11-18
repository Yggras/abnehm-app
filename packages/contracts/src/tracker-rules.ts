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

/** Herkunft eines importierten Eintrags (Spezifikation 3, Abschnitt 6). */
export const importOrigins = ['apple_health', 'health_connect'] as const;
export type ImportOrigin = (typeof importOrigins)[number];

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

/**
 * Dauer eines importierten Trainings in ganzen Minuten oder `null`, wenn es nicht übernommen wird
 * (Spezifikation 3, Abschnitt 3; #183). Unter 60 Sekunden wird nicht importiert, weil der Spike ein
 * übertragenes Training mit 0 Minuten gezeigt hat. Darüber wird auf ganze Minuten gerundet, halbe Minuten
 * aufwärts (89 s → 1 min, 90 s → 2 min). Liegt das Ergebnis außerhalb der Schemagrenzen von 1–1440
 * Minuten, wird das Training nicht übernommen.
 */
export function importedSportMinutes(durationSeconds: number): number | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds < 60) return null;
  const minutes = Math.floor(durationSeconds / 60 + 0.5);
  return minutes >= sportEntryMinutes.min && minutes <= sportEntryMinutes.max ? minutes : null;
}

/** Gültiges importiertes Gewicht in g: 20–350 kg wie bei der manuellen Eingabe, aber in genauen Gramm. */
export const importedWeightG = { min: manualWeightG.min, max: manualWeightG.max } as const;

/** Ob ein importiertes Gewicht übernommen wird: ganze g im Bereich 20–350 kg; die genauen Gramm bleiben. */
export function isValidImportedWeight(weightG: number): boolean {
  return Number.isInteger(weightG) && weightG >= importedWeightG.min && weightG <= importedWeightG.max;
}

/**
 * Version der Abbildungstabelle der Plattform-Aktivitätsarten. Die Tabelle ist reine Darstellung und
 * beeinflusst keine Zählung (Spezifikation 3, Abschnitt 3); eine geänderte Zuordnung erhöht die Version.
 */
export const activityMappingVersion = 1;

type ActivityTypeKey = (typeof activityTypes)[number];

/**
 * Abbildung, Version 1. Codes je Herkunft:
 * - `apple_health`: Rohwerte von `HKWorkoutActivityType` laut `HKWorkoutActivityType.h` des iOS SDK
 *   (https://developer.apple.com/documentation/healthkit/hkworkoutactivitytype). Die Werte ab 58 stehen dort
 *   ohne ausdrückliche Zahl und folgen fortlaufend auf `HKWorkoutActivityTypeYoga = 57`.
 * - `health_connect`: Konstanten `EXERCISE_TYPE_*` von `ExerciseSessionRecord`
 *   (https://developer.android.com/reference/kotlin/androidx/health/connect/client/records/ExerciseSessionRecord).
 *
 * Nicht genannte Codes werden `sonstiges`. Die Zuordnung selbst ist eine Designentscheidung von #183.
 */
const platformActivityTypes: Readonly<Record<ImportOrigin, Readonly<Partial<Record<ActivityTypeKey, readonly number[]>>>>> = {
  apple_health: {
    // walking, hiking, wheelchairWalkPace
    gehen: [52, 24, 70],
    // running, wheelchairRunPace
    laufen: [37, 71],
    // cycling, handCycling
    radfahren: [13, 74],
    // swimming
    schwimmen: [46],
    // traditionalStrengthTraining, functionalStrengthTraining, coreTraining
    krafttraining: [50, 20, 59],
    // yoga, mindAndBody, flexibility, pilates, taiChi
    yoga_dehnen: [57, 29, 62, 66, 72],
    // americanFootball, australianFootball, baseball, basketball, cricket, handball, hockey, lacrosse, rugby,
    // soccer, softball, volleyball, waterPolo
    mannschaftssport: [1, 3, 5, 6, 10, 23, 25, 27, 36, 41, 42, 51, 54],
  },
  health_connect: {
    // WALKING, HIKING, WHEELCHAIR
    gehen: [79, 37, 82],
    // RUNNING, RUNNING_TREADMILL
    laufen: [56, 57],
    // BIKING, BIKING_STATIONARY
    radfahren: [8, 9],
    // SWIMMING_OPEN_WATER, SWIMMING_POOL
    schwimmen: [73, 74],
    // STRENGTH_TRAINING, WEIGHTLIFTING, CALISTHENICS
    krafttraining: [70, 81, 13],
    // YOGA, STRETCHING, PILATES
    yoga_dehnen: [83, 71, 48],
    // BASEBALL, BASKETBALL, CRICKET, FOOTBALL_AMERICAN, FOOTBALL_AUSTRALIAN, HANDBALL, ICE_HOCKEY,
    // ROLLER_HOCKEY, RUGBY, SOCCER, SOFTBALL, VOLLEYBALL, WATER_POLO
    mannschaftssport: [4, 5, 14, 28, 29, 35, 38, 52, 55, 64, 65, 78, 80],
  },
};

/** Aktivitätsart zum Plattformcode einer Herkunft; Unbekanntes und fehlende Arten werden `sonstiges`. */
export function activityTypeOfPlatform(origin: ImportOrigin, code: number | null): ActivityTypeKey {
  if (code === null) return 'sonstiges';
  for (const type of activityTypes) if (platformActivityTypes[origin][type]?.includes(code)) return type;
  return 'sonstiges';
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
 * Die Messungen, die Tagesgewicht ihres Tags sind, aufsteigend nach lokalem Tag: je Tag die früheste
 * zählende Messung. Weitere Messungen desselben Tags bleiben gespeichert, zählen aber nicht als
 * Tagesgewicht (#38). Maßgeblich ist der gespeicherte lokale Tag des Eintrags, nicht das UTC-Datum seines
 * Zeitpunkts. Bei gleichem Zeitpunkt gewinnt die zuerst übergebene Messung.
 */
export function dayWeightEntries<T extends WeightEntryFacts>(entries: readonly T[]): T[] {
  const earliest = new Map<string, T>();
  for (const entry of entries) {
    if (!isCountingWeightEntry(entry)) continue;
    const known = earliest.get(entry.localDate);
    if (known === undefined || Date.parse(entry.measuredAt) < Date.parse(known.measuredAt)) earliest.set(entry.localDate, entry);
  }
  return [...earliest.values()].sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
}

/** Tagesgewichte aufsteigend nach lokalem Tag, nach `dayWeightEntries`. */
export function dayWeights(entries: readonly WeightEntryFacts[]): DayWeight[] {
  return dayWeightEntries(entries).map(({ localDate, weightG }) => ({ localDate, weightG }));
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

/** Glättungskonstante des Gewichtstrends wie in *The Hacker's Diet* (Spezifikation 3, Abschnitt 3). */
const trendSmoothing = 0.9;

/** Ab so vielen Tagesgewichten wird der Trend angezeigt (Designwert aus Spezifikation 3, Abschnitt 3). */
export const trendMinDayWeights = 3;

/** Ein Tag mit Tagesgewicht und dem Gewichtstrend danach, beide in ganzen g. */
export type TrendPoint = Readonly<{ localDate: string; dayWeightG: number; trendG: number }>;

/**
 * Gewichtstrend nach jedem Tagesgewicht, aufsteigend (Spezifikation 3, Abschnitt 3): Die Tagesgewichte
 * werden zeitgewichtet exponentiell geglättet, `Trend += (1 − 0,9^Δt) × (Tagesgewicht − Trend)` mit Δt in
 * Kalendertagen seit dem letzten Tagesgewicht; Startwert ist das erste Tagesgewicht. Bei täglichem Wiegen
 * ist das die Glättung aus *The Hacker's Diet* (https://www.fourmilab.ch/hackdiet/e4/signalnoise.html); die
 * Anpassung an Lücken ist eine eigene Ableitung der Spezifikation und nicht belegt. Gerechnet wird mit
 * Gleitkomma in g, nach außen auf ganze g gerundet. Die Eingabe ist aufsteigend wie aus `dayWeights`.
 */
export function weightTrend(days: readonly DayWeight[]): TrendPoint[] {
  let trend = 0;
  let previous: number | null = null;
  return days.map(({ localDate, weightG }) => {
    const current = calendarDay(localDate);
    trend = previous === null ? weightG : trend + (1 - trendSmoothing ** (current - previous)) * (weightG - trend);
    previous = current;
    return { localDate, dayWeightG: weightG, trendG: Math.round(trend) };
  });
}

/** Ob der Trend angezeigt wird: ab drei Tagesgewichten, vorher erscheinen nur Punkte. */
export function showsTrend(dayWeightCount: number): boolean {
  return dayWeightCount >= trendMinDayWeights;
}

/** Trendwert eines Tages: der Trend nach dem letzten Tagesgewicht an oder vor diesem Tag; davor `null`. */
export function trendValueOn(points: readonly TrendPoint[], localDate: string): number | null {
  return pointsUntil(points, localDate).at(-1)?.trendG ?? null;
}

/** Trendwert nach dem letzten Tagesgewicht, sofern der Trend angezeigt wird (ab drei Tagesgewichten); sonst `null`. */
export function currentTrendG(points: readonly TrendPoint[]): number | null {
  const last = points.at(-1);
  return last !== undefined && showsTrend(points.length) ? last.trendG : null;
}

/**
 * Eine Gewichtsveränderung in g als kg mit einer Nachkommastelle, halbe Zehntel vom Nullpunkt weg. Die
 * Spezifikation legt die Richtung der Halbrundung nicht fest; so rundet ein Abnehmen wie ein Zunehmen
 * gleicher Größe. Was auf 0,0 kg rundet, ist 0, nie −0.
 */
export function changeInTenthKg(changeG: number): number {
  return (Math.sign(changeG) * Math.round(Math.abs(changeG) / 100)) / 10 || 0;
}

/** Veränderung über 14 Tage in kg mit einer Nachkommastelle und ihre Richtung nach der Rundung. */
export type WeightChange =
  | Readonly<{ changeKg: number; direction: 'sinkend' | 'stabil' | 'steigend' }>
  | Readonly<{ changeKg: null; direction: 'noch_nicht_verfuegbar' }>;

/** Zeitraum von `changeKg` in Tagen (Spezifikation 0, Abschnitt 5). */
const changeDays = 14;

/**
 * `changeKg` am Tag D (Spezifikation 0, Abschnitt 5; Spezifikation 3, Abschnitt 3): Trendwert am Tag D
 * minus Trendwert am Tag D − 14; liegt das erste Tagesgewicht nach D − 14, ist es der Bezug. Nicht
 * verfügbar unter drei Tagesgewichten bis D oder ohne Tagesgewicht zwischen D − 13 und D.
 *
 * Grundlage sind die nach außen gerundeten Trendwerte in g. So liefert eine Reihe des
 * `WeightTrendReader` dieselbe Zahl wie das Tracker-Modul, und Gleitkommareste kippen keine Rundung.
 * Gerundet wird mit `changeInTenthKg` auf 0,1 kg.
 */
export function weightChange(points: readonly TrendPoint[], localDate: string): WeightChange {
  const known = pointsUntil(points, localDate);
  const first = known[0];
  const last = known.at(-1);
  const windowStart = localDateOf(calendarDay(localDate) - (changeDays - 1));
  if (!showsTrend(known.length) || first === undefined || last === undefined || last.localDate < windowStart) {
    return { changeKg: null, direction: 'noch_nicht_verfuegbar' };
  }
  const reference = trendValueOn(known, localDateOf(calendarDay(localDate) - changeDays)) ?? first.dayWeightG;
  const changeKg = changeInTenthKg(last.trendG - reference);
  return { changeKg, direction: changeKg < 0 ? 'sinkend' : changeKg > 0 ? 'steigend' : 'stabil' };
}

/**
 * „Seit Start“ in g: Trendwert am Tag minus erstes Tagesgewicht der Person; nur solange der Trend
 * angezeigt wird, sonst `null` (Spezifikation 3, Abschnitt 3).
 */
export function sinceStartG(points: readonly TrendPoint[], localDate: string): number | null {
  const known = pointsUntil(points, localDate);
  const first = known[0];
  const last = known.at(-1);
  if (!showsTrend(known.length) || first === undefined || last === undefined) return null;
  return last.trendG - first.dayWeightG;
}

/** Tempo des Plans; im Haltemodus gibt es keines (`PlanReader`, Spezifikation 1). */
export type ForecastPace = 'entspannt' | 'zuegiger';

/** Abnahme je Woche und Tempo in g für die Prognose: 0,5 bzw. 0,75 kg (#14; Spezifikation 3, Abschnitt 3). */
const forecastWeeklyLossG: Readonly<Record<ForecastPace, number>> = { entspannt: 500, zuegiger: 750 };

/**
 * Prognose, wann das Zielgewicht erreicht ist (Spezifikation 3, Abschnitt 3): heute + aufgerundet
 * `(Trendwert − Zielgewicht) ÷ Rate × 7` Tage. Sie entfällt (`null`) im Haltemodus (`pace` ist `null`),
 * ohne angezeigten Trend (`trendG` ist `null`) und sobald der Trendwert das Zielgewicht erreicht oder
 * unterschritten hat. Angezeigt wird sie immer als „Schätzung“.
 */
export function weightForecast({
  today,
  trendG,
  goalWeightG,
  pace,
}: Readonly<{ today: string; trendG: number | null; goalWeightG: number; pace: ForecastPace | null }>): string | null {
  if (pace === null || trendG === null || trendG <= goalWeightG) return null;
  return localDateOf(calendarDay(today) + Math.ceil(((trendG - goalWeightG) * 7) / forecastWeeklyLossG[pace]));
}

/** Die Punkte an oder vor dem Tag; die Punkte sind aufsteigend. */
function pointsUntil(points: readonly TrendPoint[], localDate: string): readonly TrendPoint[] {
  const end = points.findIndex((point) => point.localDate > localDate);
  return end === -1 ? points : points.slice(0, end);
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
