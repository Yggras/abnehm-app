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
  return readingAt(low * minuteMs, timeZone).instant;
}

/**
 * Zeitpunkt einer Wanduhrzeit (Minute des Tages, 0–1439) an einem lokalen Tag in einer Zone, etwa
 * „19:00“ eines Tages-Check-ins (Spezifikation 5, Abschnitt 7; #132). An Tagen der Zeitumstellung bleibt
 * die Ortszeit gleich. Gibt es die Wanduhrzeit zweimal, gilt das erste Vorkommen; fällt sie aus, die
 * erste Minute danach. Liest keine Uhr.
 */
export function instantAtWallClock(localDate: LocalDate, minutes: number, timeZone: TimeZone): Instant {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= minutesPerDay) throw new RangeError(`Keine Minute des Tages: ${minutes}`);
  const target = LocalDate.parse(localDate);
  /** Wanduhrzeit einer Minute seit lokaler Mitternacht des Zieltags; Nachbartage zählen über ±1440 weiter. */
  const wall = (minute: number) => {
    const reading = readingAt(minute * minuteMs, timeZone);
    const shift = reading.localDate === target ? 0 : reading.localDate > target ? minutesPerDay : -minutesPerDay;
    return minutesOfDay(reading) + shift;
  };
  // So viele Minuten nach dem Tagesbeginn, wie verlangt, und dann um die Abweichung der Wanduhr verschoben.
  const elapsed = Date.parse(startOfLocalDate(target, timeZone)) / minuteMs + minutes;
  const corrected = elapsed - (wall(elapsed) - minutes);
  if (wall(corrected) === minutes) return readingAt(corrected * minuteMs, timeZone).instant;
  // Ausgefallene Wanduhrzeit: zwischen beiden Kandidaten springt die Uhr vor; gesucht ist die erste Minute danach.
  let low = Math.min(corrected, elapsed);
  let high = Math.max(corrected, elapsed);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (wall(middle) >= minutes) high = middle;
    else low = middle + 1;
  }
  return readingAt(low * minuteMs, timeZone).instant;
}

/**
 * Lokaler Tag eines gegebenen Zeitpunkts bei einem festen Offset zu UTC, etwa dem Offset, den ein
 * Health-Datensatz mitliefert (Spezifikation 3, Abschnitt 6; #183). Liest keine Uhr und keine Zone.
 */
export function localDateAtOffset(instant: Instant, utcOffsetMinutes: number): LocalDate {
  return LocalDate.parse(new Date(Date.parse(Instant.parse(instant)) + utcOffsetMinutes * 60_000).toISOString().slice(0, 10));
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
