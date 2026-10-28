import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

import type { ClockReading } from './clock.ts';

// Interner Kern aller Uhr-Adapter. Nicht über `exports` veröffentlicht.
export function readingAt(epochMilliseconds: number, timeZone: TimeZone): ClockReading {
  const zone = TimeZone.parse(timeZone);
  const local = localFields(epochMilliseconds, zone);
  return {
    instant: Instant.parse(new Date(epochMilliseconds).toISOString()),
    timeZone: zone,
    localDate: LocalDate.parse(`${String(local.year).padStart(4, '0')}-${pad(local.month)}-${pad(local.day)}`),
    utcOffsetMinutes: utcOffsetMinutes(epochMilliseconds, local),
  };
}

type LocalFields = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Wanduhrzeit in der Zone; nur Felder, die `formatToParts` überall liefert. */
function localFields(epochMilliseconds: number, timeZone: TimeZone): LocalFields {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(epochMilliseconds);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);
  return {
    year: part('year'),
    month: part('month'),
    day: part('day'),
    // Manche Engines schreiben Mitternacht trotz `h23` als 24.
    hour: part('hour') % 24,
    minute: part('minute'),
    second: part('second'),
  };
}

/**
 * Offset der Zone zum Zeitpunkt in Minuten: Wanduhrzeit als UTC gelesen minus Zeitpunkt. Sekunden
 * und Millisekunden fallen weg, weil heutige Offsets ganze Minuten sind.
 */
function utcOffsetMinutes(epochMilliseconds: number, local: LocalFields): number {
  const wallClock = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const instant = Math.floor(epochMilliseconds / 1000) * 1000;
  return Math.round((wallClock - instant) / 60_000);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
