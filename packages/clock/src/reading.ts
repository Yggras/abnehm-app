import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

import type { ClockReading } from './clock.ts';

// Interner Kern aller Uhr-Adapter. Nicht über `exports` veröffentlicht.
export function readingAt(epochMilliseconds: number, timeZone: TimeZone): ClockReading {
  const zone = TimeZone.parse(timeZone);
  return {
    instant: Instant.parse(new Date(epochMilliseconds).toISOString()),
    timeZone: zone,
    localDate: LocalDate.parse(formatLocalDate(epochMilliseconds, zone)),
  };
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function formatLocalDate(epochMilliseconds: number, timeZone: TimeZone): string {
  let formatter = dateFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(epochMilliseconds);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
