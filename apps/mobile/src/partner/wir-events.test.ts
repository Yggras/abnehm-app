/**
 * @jest-environment node
 */
import { readingOf } from '@abnehm/clock';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { historyOf, type WirEvent } from './wir-events';

// Verlauf hinter „Alle anzeigen“ (Spezifikation 5, Abschnitt 2; #124): Kalenderwochen Montag bis Sonntag in
// der Zeitzone der betrachtenden Person, „Diese Woche“, „Letzte Woche“, sonst „KW n“. Die erwarteten
// Kalenderwochen stammen aus dem ISO-Kalender (Python `date.isocalendar()`): 21.12.2026 → KW 52,
// 28.12.2026 → KW 53, 04.01.2027 → KW 1. Den gerenderten Verlauf prüft `WirScreen.test.tsx`.

const berlin = TimeZone.parse('Europe/Berlin');

const event = (id: string, occurredAt: string): WirEvent => ({ id, occurredAt: Instant.parse(occurredAt), icon: 'star', text: id });

const grouped = (events: WirEvent[], now: string, zone = berlin) =>
  historyOf(events, readingOf(Instant.parse(now), zone)).map((group) => [group.label, group.events.map((entry) => entry.id)]);

describe('historyOf', () => {
  it('gruppiert über den Jahreswechsel nach Kalenderwochen, neueste Woche und neuestes Ereignis zuerst', () => {
    const events = [
      event('vorletzte', '2026-12-22T09:00:00.000Z'),
      event('silvester', '2026-12-31T20:00:00.000Z'),
      event('neujahr', '2027-01-01T10:00:00.000Z'),
      event('heute', '2027-01-06T08:00:00.000Z'),
      event('montag', '2027-01-04T07:00:00.000Z'),
    ];

    // Mittwoch, 6. Januar 2027.
    expect(grouped(events, '2027-01-06T12:00:00.000Z')).toEqual([
      ['Diese Woche', ['heute', 'montag']],
      ['Letzte Woche', ['neujahr', 'silvester']],
      ['KW 52', ['vorletzte']],
    ]);
    // Eine Woche später ist die Woche über den Jahreswechsel KW 53 des Jahres 2026.
    expect(grouped(events, '2027-01-13T12:00:00.000Z')).toEqual([
      ['Letzte Woche', ['heute', 'montag']],
      ['KW 53', ['neujahr', 'silvester']],
      ['KW 52', ['vorletzte']],
    ]);
  });

  it('ordnet Ereignisse nach dem lokalen Tag der betrachtenden Person in ihre Woche', () => {
    // Sonntag, 3. Januar 2027, 23:30 UTC ist in Berlin schon Montag, 0:30, in New York noch Sonntag.
    const late = [event('nacht', '2027-01-03T23:30:00.000Z')];

    expect(grouped(late, '2027-01-06T12:00:00.000Z')).toEqual([['Diese Woche', ['nacht']]]);
    expect(grouped(late, '2027-01-06T12:00:00.000Z', TimeZone.parse('America/New_York'))).toEqual([['Letzte Woche', ['nacht']]]);
  });

  it('hat ohne Ereignisse keine Gruppe', () => {
    expect(grouped([], '2027-01-06T12:00:00.000Z')).toEqual([]);
  });
});
