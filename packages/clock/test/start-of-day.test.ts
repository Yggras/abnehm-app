import { describe, expect, it } from 'vitest';

import { LocalDate, TimeZone } from '@abnehm/contracts/base';

import { readingOf, startOfLocalDate } from '../src/clock.ts';

// `startOfLocalDate` liefert den ersten Zeitpunkt eines lokalen Tags in einer Zone. Daraus entsteht
// `dayEndsAt` der Tagesziele als Beginn des Folgetags (Spezifikation 1, Abschnitt 5; #131), sodass
// Umstellungstage 23 bzw. 25 Stunden haben.

const zone = (value: string) => TimeZone.parse(value);
const day = (value: string) => LocalDate.parse(value);
const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;

describe('startOfLocalDate', () => {
  it('beginnt einen gewöhnlichen Tag um lokale Mitternacht', () => {
    expect(startOfLocalDate(day('2026-10-14'), zone('Europe/Berlin'))).toBe('2026-10-13T22:00:00.000Z');
    expect(startOfLocalDate(day('2026-12-01'), zone('Europe/Berlin'))).toBe('2026-11-30T23:00:00.000Z');
  });

  it('gibt dem Ende der Sommerzeit am 25.10.2026 in Berlin 25 Stunden', () => {
    const start = startOfLocalDate(day('2026-10-25'), zone('Europe/Berlin'));
    const end = startOfLocalDate(day('2026-10-26'), zone('Europe/Berlin'));
    expect([start, end]).toEqual(['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z']);
    expect(hours(start, end)).toBe(25);
  });

  it('gibt dem Beginn der Sommerzeit am 28.03.2027 in Berlin 23 Stunden', () => {
    const start = startOfLocalDate(day('2027-03-28'), zone('Europe/Berlin'));
    const end = startOfLocalDate(day('2027-03-29'), zone('Europe/Berlin'));
    expect([start, end]).toEqual(['2027-03-27T23:00:00.000Z', '2027-03-28T22:00:00.000Z']);
    expect(hours(start, end)).toBe(23);
  });

  it('beginnt den Tag um 01:00, wenn Mitternacht durch die Umstellung ausfällt', () => {
    // In Santiago springt die Uhr am 06.09.2026 von 24:00 auf 01:00 (siehe Konformitäts-Testkit der Uhr).
    expect(startOfLocalDate(day('2026-09-06'), zone('America/Santiago'))).toBe('2026-09-06T04:00:00.000Z');
  });

  it('rechnet Zonen mit halb- und dreiviertelstündigem Versatz', () => {
    expect(startOfLocalDate(day('2026-10-15'), zone('Asia/Kolkata'))).toBe('2026-10-14T18:30:00.000Z');
    expect(startOfLocalDate(day('2026-10-15'), zone('Asia/Kathmandu'))).toBe('2026-10-14T18:15:00.000Z');
  });

  it('liefert für jeden Tag genau den ersten Zeitpunkt, der diesen Tag abliest', () => {
    for (const [value, timeZone] of [
      ['2026-10-14', 'Pacific/Kiritimati'],
      ['2026-10-14', 'Pacific/Pago_Pago'],
      ['2026-10-14', 'America/New_York'],
      ['2027-03-14', 'America/New_York'],
    ] as const) {
      const start = startOfLocalDate(day(value), zone(timeZone));
      expect(readingOf(start, zone(timeZone)).localDate).toBe(value);
      expect(readingOf(new Date(Date.parse(start) - 1).toISOString() as never, zone(timeZone)).localDate < value).toBe(true);
    }
  });
});
