import { describe, expect, it } from 'vitest';

import { Instant, TimeZone } from '@abnehm/contracts/base';

import { readingOf } from '../src/clock.ts';

// `readingOf` liest einen gegebenen Zeitpunkt in einer Zone ab, etwa einen nachgetragenen
// Messzeitpunkt (#175): lokaler Tag und Offset gehören zu genau diesem Zeitpunkt, nicht zu „jetzt“.

const berlin = TimeZone.parse('Europe/Berlin');

describe('readingOf', () => {
  it('liefert lokalen Tag und Offset eines Zeitpunkts in der Sommerzeit', () => {
    // 23:30 UTC am 13.10. ist in Berlin 01:30 Uhr am 14.10. (UTC+2).
    expect(readingOf(Instant.parse('2026-10-13T23:30:00.000Z'), berlin)).toEqual({
      instant: '2026-10-13T23:30:00.000Z',
      timeZone: 'Europe/Berlin',
      localDate: '2026-10-14',
      utcOffsetMinutes: 120,
    });
  });

  it('nimmt den Offset zum Zeitpunkt selbst, auch nach der Zeitumstellung', () => {
    // Am 25.10.2026 endet in Berlin die Sommerzeit; danach gilt UTC+1.
    expect(readingOf(Instant.parse('2026-10-26T06:00:00.000Z'), berlin)).toMatchObject({ localDate: '2026-10-26', utcOffsetMinutes: 60 });
  });

  it('rechnet Dreiviertelstundenzonen', () => {
    expect(readingOf(Instant.parse('2026-10-14T18:30:00.000Z'), TimeZone.parse('Asia/Kathmandu'))).toMatchObject({
      localDate: '2026-10-15',
      utcOffsetMinutes: 345,
    });
  });
});
