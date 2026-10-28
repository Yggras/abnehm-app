// Kalenderrechnung auf lokalen Tagen (`YYYY-MM-DD`) ohne Zeitzone: Ein lokaler Tag ist ein Datum,
// kein Zeitpunkt. Intern zählt UTC nur als zonenfreier Kalender. Nicht als Teilpfad exportiert.

const MS_PER_DAY = 86_400_000;

function dayNumber(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** Tage von `from` bis `to`; negativ, wenn `to` früher liegt. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(localDate: string, days: number): string {
  return new Date((dayNumber(localDate) + days) * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Volle Jahre von `from` bis `to`: Der Jahrestag selbst zählt schon. Ein 29. Februar wird in
 * Nichtschaltjahren erst am 1. März voll (Designwert für das Alter in Spezifikation 1).
 */
export function fullYearsBetween(from: string, to: string): number {
  const years = Number(to.slice(0, 4)) - Number(from.slice(0, 4));
  return to.slice(5) < from.slice(5) ? years - 1 : years;
}

/** Jahr und Monat (1–12) eines lokalen Tags. */
export function yearAndMonth(localDate: string): { year: number; month: number } {
  return { year: Number(localDate.slice(0, 4)), month: Number(localDate.slice(5, 7)) };
}

/** Wochentag nach ISO 8601: 0 = Montag … 6 = Sonntag. */
export function isoWeekdayIndex(localDate: string): number {
  return (new Date(dayNumber(localDate) * MS_PER_DAY).getUTCDay() + 6) % 7;
}
