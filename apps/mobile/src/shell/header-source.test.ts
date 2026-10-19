import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { createTodayRegistry } from './today-registry';
import { registerTodayHeader } from './header-source';

test('Person, Uhr und Zeitzone liefern einen beobachtbaren Kopf; Änderungen aktualisieren ihn', () => {
  const clock = createTestClock({ instant: Instant.parse('2026-10-14T22:30:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
  const registry = createTodayRegistry();
  let publish: ((person: { displayName: string; timeZone: TimeZone } | null) => void) | undefined;
  registerTodayHeader(registry, clock, (listener) => { publish = listener; listener({ displayName: 'Philipp', timeZone: TimeZone.parse('Europe/Berlin') }); return () => {}; });
  const received: unknown[] = [];
  const stop = registry.subscribe('header', (state) => received.push(state));
  expect(received).toMatchObject([{ type: 'ready', data: { displayName: 'Philipp', localDate: '2026-10-15', weekday: 'donnerstag' } }]);
  publish!({ displayName: 'Anna', timeZone: TimeZone.parse('America/New_York') });
  expect(received).toMatchObject([{}, { type: 'ready', data: { displayName: 'Anna', localDate: '2026-10-14', weekday: 'mittwoch' } }]);
  stop();
});
