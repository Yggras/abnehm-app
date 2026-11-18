import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

import { readingAt } from './reading.ts';

/** Eine Ablesung der Uhr: Zeitpunkt, Zone, lokaler Tag und Offset gehören zum selben Moment. */
export type ClockReading = Readonly<{
  instant: Instant;
  timeZone: TimeZone;
  localDate: LocalDate;
  /** Offset der Zone zu UTC in Minuten zu diesem Zeitpunkt, etwa 120 für Berlin im Sommer. */
  utcOffsetMinutes: number;
}>;

const minutesPerDay = 24 * 60;

/** Lokale Uhrzeit einer Ablesung als Minute des Tages (0–1439), aus Zeitpunkt und Offset derselben Ablesung. */
export function minutesOfDay(reading: ClockReading): number {
  const utcMinutes = Math.floor(Date.parse(reading.instant) / 60_000);
  return (((utcMinutes + reading.utcOffsetMinutes) % minutesPerDay) + minutesPerDay) % minutesPerDay;
}

/**
 * Einzige Quelle für „jetzt“ und „heute“ im Bereichscode.
 *
 * Ohne Argument liest die Uhr in ihrer eigenen Zone (in der App die Gerätezone),
 * mit Argument in der angegebenen Zone (im Backend die `time_zone` der Person).
 * Zeitpunkt und lokaler Tag stammen immer aus einer einzigen Ablesung, damit sie
 * auch um Mitternacht zusammenpassen.
 */
export interface Clock {
  read(timeZone?: TimeZone): ClockReading;
}

/**
 * Liest einen gegebenen Zeitpunkt in einer Zone ab, etwa einen nachgetragenen Messzeitpunkt (#175):
 * lokaler Tag und Offset gehören zu genau diesem Zeitpunkt. Liest keine Uhr; „jetzt“ kommt nur aus
 * `Clock.read`, die Zone in der Regel aus derselben Ablesung.
 */
export function readingOf(instant: Instant, timeZone: TimeZone): ClockReading {
  return readingAt(Date.parse(Instant.parse(instant)), timeZone);
}

/**
 * Lokaler Tag eines gegebenen Zeitpunkts bei einem festen Offset zu UTC, etwa dem Offset, den ein
 * Health-Datensatz mitliefert (Spezifikation 3, Abschnitt 6; #183). Liest keine Uhr und keine Zone.
 */
export function localDateAtOffset(instant: Instant, utcOffsetMinutes: number): LocalDate {
  return LocalDate.parse(new Date(Date.parse(Instant.parse(instant)) + utcOffsetMinutes * 60_000).toISOString().slice(0, 10));
}

/**
 * Erster Zeitpunkt eines lokalen Tags in einer Zone, etwa der Beginn des Verbindungstags des
 * Health-Imports (#183): Mitternacht der Wanduhr, zurückgerechnet mit dem Offset der Zone. Der zweite
 * Schritt nimmt den Offset zum gefundenen Zeitpunkt, falls er sich zwischen UTC-Mitternacht und lokaler
 * Mitternacht ändert. Fällt Mitternacht durch eine Umstellung aus, ist es der erste Zeitpunkt danach.
 */
export function startOfLocalDay(localDate: LocalDate, timeZone: TimeZone): Instant {
  const wallMidnight = Date.parse(`${LocalDate.parse(localDate)}T00:00:00.000Z`);
  const first = wallMidnight - readingAt(wallMidnight, timeZone).utcOffsetMinutes * 60_000;
  const start = wallMidnight - readingAt(first, timeZone).utcOffsetMinutes * 60_000;
  // Ausgefallene Mitternacht: Der Zeitpunkt liegt noch im Vortag; der Tag beginnt mit der Umstellung danach.
  return readingAt(start, timeZone).localDate === localDate ? Instant.parse(new Date(start).toISOString()) : Instant.parse(new Date(first).toISOString());
}

/**
 * Produktionsuhr: Systemzeit plus eine Zonenquelle. Die Quelle wird bei jedem
 * Ablesen neu gefragt, damit ein Zonenwechsel (Reise) sofort wirkt.
 */
export function createSystemClock(source: { timeZone: () => string }): Clock {
  return {
    read: (timeZone) => readingAt(Date.now(), timeZone ?? TimeZone.parse(source.timeZone())),
  };
}
