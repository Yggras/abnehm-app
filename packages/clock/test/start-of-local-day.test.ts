import { describe, expect, it } from 'vitest';

import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

import { localDateAtOffset, readingOf, startOfLocalDay } from '../src/clock.ts';

// Nachweis für #183: Beginn eines lokalen Tags und lokaler Tag zu einem festen Offset, wie sie der
// Health-Import für den Verbindungstag bzw. mitgelieferte Offsets braucht.

const berlin = TimeZone.parse('Europe/Berlin');

describe('startOfLocalDay', () => {
  it('ist Mitternacht der Zone, auch an Tagen der Zeitumstellung', () => {
    expect(startOfLocalDay(LocalDate.parse('2026-10-14'), berlin)).toBe('2026-10-13T22:00:00.000Z');
    expect(startOfLocalDay(LocalDate.parse('2026-10-25'), berlin)).toBe('2026-10-24T22:00:00.000Z');
    expect(startOfLocalDay(LocalDate.parse('2026-10-26'), berlin)).toBe('2026-10-25T23:00:00.000Z');
    expect(startOfLocalDay(LocalDate.parse('2026-03-29'), berlin)).toBe('2026-03-28T23:00:00.000Z');
    expect(startOfLocalDay(LocalDate.parse('2026-10-14'), TimeZone.parse('Asia/Kathmandu'))).toBe('2026-10-13T18:15:00.000Z');
  });

  // Eigenschaft statt erratener Umstellungsdaten: Der Zeitpunkt gehört zum Tag, eine Minute davor nicht.
  // Havanna und Santiago stellen nach der IANA-Datenbank um Mitternacht um.
  it.each(['Europe/Berlin', 'America/Havana', 'America/Santiago', 'Asia/Kathmandu', 'Pacific/Kiritimati'])('ist an jedem Tag 2026 der erste Zeitpunkt des Tags in %s', (zone) => {
    const timeZone = TimeZone.parse(zone);
    for (let day = 0; day < 365; day += 1) {
      const localDate = LocalDate.parse(new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10));
      const start = startOfLocalDay(localDate, timeZone);
      expect(readingOf(start, timeZone).localDate, `${zone} ${localDate}`).toBe(localDate);
      const before = Instant.parse(new Date(Date.parse(start) - 60_000).toISOString());
      expect(readingOf(before, timeZone).localDate, `${zone} ${localDate}`).not.toBe(localDate);
    }
  });
});

describe('localDateAtOffset', () => {
  it('ist der Kalendertag der Wanduhrzeit im Offset', () => {
    expect(localDateAtOffset(Instant.parse('2026-10-14T22:30:00.000Z'), 120)).toBe('2026-10-15');
    expect(localDateAtOffset(Instant.parse('2026-10-14T22:30:00.000Z'), 0)).toBe('2026-10-14');
    expect(localDateAtOffset(Instant.parse('2026-10-14T03:00:00.000Z'), -300)).toBe('2026-10-13');
    expect(localDateAtOffset(Instant.parse('2026-12-31T23:59:59.999Z'), 1)).toBe('2027-01-01');
  });
});
