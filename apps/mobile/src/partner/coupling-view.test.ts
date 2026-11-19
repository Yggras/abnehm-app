import { readingOf } from '@abnehm/clock';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { validUntilWhen } from './coupling-view';

// „gültig bis …“ des Ablaufs `partner.invite` (Spezifikation 5, Abschnitt 5; #120) in der Zeitzone des Geräts.

const berlin = TimeZone.parse('Europe/Berlin');
const now = readingOf(Instant.parse('2026-10-14T12:00:00.000Z'), berlin);

test.each([
  ['2026-10-14T21:59:00.000Z', 'heute, 23:59'],
  ['2026-10-15T12:20:00.000Z', 'morgen, 14:20'],
  // 25.10.2026: Ende der Sommerzeit, 14:20 Uhr ist dann 13:20 UTC.
  ['2026-10-26T13:20:00.000Z', '26.10., 14:20'],
])('%s → „%s“', (expiresAt, when) => {
  expect(validUntilWhen(Instant.parse(expiresAt), now)).toBe(when);
});

test('der lokale Tag zählt, nicht 24 Stunden', () => {
  const lateEvening = readingOf(Instant.parse('2026-10-14T21:30:00.000Z'), berlin);
  expect(validUntilWhen(Instant.parse('2026-10-14T22:10:00.000Z'), lateEvening)).toBe('morgen, 00:10');
});
