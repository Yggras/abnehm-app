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

const minuteMs = 60_000;
/** Offsets liegen zwischen UTC−12 und UTC+14; 15 Stunden um UTC-Mitternacht schließen jeden Tagesbeginn ein. */
const searchWindowMinutes = 15 * 60;

/**
 * Erster Zeitpunkt eines lokalen Tags in einer Zone, etwa für `dayEndsAt` als Beginn des Folgetags
 * (#131). Fällt Mitternacht durch eine Umstellung aus, beginnt der Tag mit der ersten Minute, die ihn
 * abliest. Gesucht wird minutengenau, weil Zonen nur auf ganzen Minuten umstellen. Liest keine Uhr.
 */
export function startOfLocalDate(localDate: LocalDate, timeZone: TimeZone): Instant {
  const target = LocalDate.parse(localDate);
  const [year, month, day] = target.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(year, month - 1, day) / minuteMs;
  // Kleinste Minute, deren Ablesung den Tag erreicht hat; lokale Tage ordnen sich als Zeichenfolgen.
  let low = utcMidnight - searchWindowMinutes;
  let high = utcMidnight + searchWindowMinutes;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (readingAt(middle * minuteMs, timeZone).localDate >= target) high = middle;
    else low = middle + 1;
  }
  return Instant.parse(new Date(low * minuteMs).toISOString());
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
