import { minutesOfDay, readingOf } from '@abnehm/clock';
import { localDateAfter, weekdayOf, type Instant, type LocalDate, type TimeZone } from '@abnehm/contracts/base';
import type { ImportOrigin } from '@abnehm/contracts/tracker-rules';

// Gemeinsame Texte der Eintragslisten des Tracker-Bereichs (Spezifikation 3, Abschnitt 5): Tag, Uhrzeit und
// Herkunft eines Eintrags, etwa in der Messliste des Gewichts und der Wochenübersicht des Sports.

const weekdaysShort = { montag: 'Mo', dienstag: 'Di', mittwoch: 'Mi', donnerstag: 'Do', freitag: 'Fr', samstag: 'Sa', sonntag: 'So' } as const;

/** „heute“, „gestern“ oder Wochentag und Datum, etwa „Mo, 12.10.“. */
export function dayText(localDate: LocalDate, today: LocalDate): string {
  if (localDate === today) return 'heute';
  if (localDateAfter(localDate, 1) === today) return 'gestern';
  const [, month, day] = localDate.split('-');
  return `${weekdaysShort[weekdayOf(localDate)]}, ${day}.${month}.`;
}

/** Datum ohne Wochentag, etwa „12.10.“. */
export function shortDate(localDate: LocalDate): string {
  const [, month, day] = localDate.split('-');
  return `${day}.${month}.`;
}

/** Kurz für die Messliste: „heute“, „gestern“ oder nur das Datum, etwa „12.10.“, damit die Zeile auf dem iPhone SE einzeilig bleibt. */
export function shortDayText(localDate: LocalDate, today: LocalDate): string {
  if (localDate === today || localDateAfter(localDate, 1) === today) return dayText(localDate, today);
  return shortDate(localDate);
}

/** Uhrzeit eines Zeitpunkts in einer Zone, etwa „07:30“. */
export function timeText(instant: Instant, timeZone: TimeZone): string {
  const minutes = minutesOfDay(readingOf(instant, timeZone));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * Anzeigenamen bekannter Quell-Apps nach ihrer Kennung (Spezifikation 3, Abschnitt 6): Google Health schreibt
 * auf dem iPhone unter `com.fitbit.FitbitMobile` mit dem Namen „Google Health“
 * (`spikes/health-hintergrund/RESULTS.md`, „Quellen erkennen“). Der feste Name nennt zusätzlich Fitbit, weil
 * die Person ihre Uhr unter diesem Namen kennt; das ist ein Designwert, nicht belegt.
 */
const knownSourceApps: Readonly<Record<string, string>> = { 'com.fitbit.FitbitMobile': 'Google Health (Fitbit)' };

/** Quell-App eines Imports: bekannter Anzeigename, sonst der gelieferte, sonst die Kennung; ohne beides `null`. */
export function sourceAppText(id: string | null, name: string | null): string | null {
  return (id === null ? undefined : knownSourceApps[id]) ?? name ?? id;
}

/** Herkunft eines Eintrags für die Liste (`CONTEXT.md`: manuell, Apple Health oder Health Connect). */
export const originNames: Readonly<Record<'manuell' | ImportOrigin, string>> = {
  manuell: 'Manuell',
  apple_health: 'Apple Health',
  health_connect: 'Health Connect',
};

