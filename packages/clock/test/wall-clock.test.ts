import { describe, expect, it } from 'vitest';

import { LocalDate, TimeZone } from '@abnehm/contracts/base';

import { instantAtWallClock, minutesOfDay, readingOf } from '../src/clock.ts';

// Nachweis für #132: Zeitpunkt einer Wanduhrzeit an einem lokalen Tag, etwa „19:00“ für den Uhrzeit-Picker
// der Benachrichtigungen (Spezifikation 5, Abschnitt 6) und später die Zeitpunkte der Tages-Check-ins
// (Abschnitt 7: „Zeitpunkte entstehen aus der Wanduhrzeit in der aktuellen IANA-Zeitzone des Geräts“).

const berlin = TimeZone.parse('Europe/Berlin');
const day = (value: string) => LocalDate.parse(value);

describe('instantAtWallClock', () => {
  it('ist die Wanduhrzeit des Tags in der Zone', () => {
    expect(instantAtWallClock(day('2026-10-14'), 19 * 60, berlin)).toBe('2026-10-14T17:00:00.000Z');
    expect(instantAtWallClock(day('2026-12-01'), 13 * 60, berlin)).toBe('2026-12-01T12:00:00.000Z');
    expect(instantAtWallClock(day('2026-10-14'), 0, berlin)).toBe('2026-10-13T22:00:00.000Z');
    expect(instantAtWallClock(day('2026-10-14'), 23 * 60 + 59, TimeZone.parse('Asia/Kathmandu'))).toBe('2026-10-14T18:14:00.000Z');
  });

  it('trifft die Ortszeit auch an Tagen der Zeitumstellung', () => {
    // Ende der Sommerzeit am 25.10.2026, Beginn am 29.03.2026: 19:00 bleibt 19:00.
    expect(instantAtWallClock(day('2026-10-25'), 19 * 60, berlin)).toBe('2026-10-25T18:00:00.000Z');
    expect(instantAtWallClock(day('2026-03-29'), 19 * 60, berlin)).toBe('2026-03-29T17:00:00.000Z');
  });

  it('nimmt bei doppelter Stunde das erste Vorkommen und bei ausgefallener Stunde die erste Minute danach', () => {
    expect(instantAtWallClock(day('2026-10-25'), 2 * 60 + 30, berlin)).toBe('2026-10-25T00:30:00.000Z');
    expect(instantAtWallClock(day('2026-03-29'), 2 * 60 + 30, berlin)).toBe('2026-03-29T01:00:00.000Z');
  });

  // Eigenschaft: An jedem Tag 2026 liest der Zeitpunkt genau diese Wanduhrzeit und diesen Tag ab, sofern es sie gibt.
  it.each(['Europe/Berlin', 'America/Havana', 'America/Santiago', 'Asia/Kathmandu', 'Pacific/Kiritimati'])('liest in %s an jedem Tag 2026 13:00 und 19:00 ab', (zone) => {
    const timeZone = TimeZone.parse(zone);
    for (let offset = 0; offset < 365; offset += 1) {
      const localDate = LocalDate.parse(new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10));
      for (const minutes of [13 * 60, 19 * 60]) {
        const reading = readingOf(instantAtWallClock(localDate, minutes, timeZone), timeZone);
        expect([reading.localDate, minutesOfDay(reading)], `${zone} ${localDate}`).toEqual([localDate, minutes]);
      }
    }
  });

  it('lehnt Minuten außerhalb des Tags ab', () => {
    expect(() => instantAtWallClock(day('2026-10-14'), 24 * 60, berlin)).toThrow();
    expect(() => instantAtWallClock(day('2026-10-14'), -1, berlin)).toThrow();
  });
});
