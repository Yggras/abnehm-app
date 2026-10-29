import { describe, expect, it } from 'vitest';

import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

import { minutesOfDay } from '../src/clock.ts';
import { createTestClock } from '../src/testing.ts';

// Lokale Uhrzeit einer Ablesung als Minute des Tages (#182: Abend auf der Insel von 20 bis 6 Uhr).

const reading = (instant: string, localDate: string, utcOffsetMinutes: number) => ({
  instant: Instant.parse(instant),
  timeZone: TimeZone.parse('Europe/Berlin'),
  localDate: LocalDate.parse(localDate),
  utcOffsetMinutes,
});

describe('minutesOfDay', () => {
  it.each([
    ['2026-10-14T18:30:00.000Z', '2026-10-14', 120, 20 * 60 + 30],
    ['2026-10-14T23:30:00.000Z', '2026-10-15', 120, 90],
    ['2026-10-14T02:00:00.000Z', '2026-10-13', -300, 21 * 60],
    ['2026-10-14T00:00:00.000Z', '2026-10-14', 0, 0],
  ])('%s am lokalen Tag %s mit Offset %i ist Minute %i', (instant, localDate, offset, minute) => {
    expect(minutesOfDay(reading(instant, localDate, offset))).toBe(minute);
  });

  it('folgt der Zone der Ablesung, auch bei Halbstundenzonen', () => {
    const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Asia/Kolkata') });

    // 12:00 UTC sind in Kalkutta 17:30, in Berlin (Sommerzeit) 14:00.
    expect(minutesOfDay(clock.read())).toBe(17 * 60 + 30);
    expect(minutesOfDay(clock.read(TimeZone.parse('Europe/Berlin')))).toBe(14 * 60);
  });
});
