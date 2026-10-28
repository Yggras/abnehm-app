import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { createTodayRegistry } from './today-registry';
import type { LocalDatabase } from '../local-db';
import { followTodayPerson } from './app-today';
import { todayHeaderSource } from './header-source';

test('Person, Uhr und Zeitzone liefern einen beobachtbaren Kopf; Änderungen aktualisieren ihn', () => {
  const clock = createTestClock({ instant: Instant.parse('2026-10-14T22:30:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
  const registry = createTodayRegistry();
  let publish: ((person: { displayName: string; timeZone: TimeZone } | null) => void) | undefined;
  registry.register('fundament', 'header', todayHeaderSource(clock, (listener) => { publish = listener; listener({ displayName: 'Philipp', timeZone: TimeZone.parse('Europe/Berlin') }); return () => {}; }));
  const received: unknown[] = [];
  const stop = registry.subscribe('header', (state) => received.push(state));
  expect(received).toMatchObject([{ type: 'ready', data: { displayName: 'Philipp', localDate: '2026-10-15', weekday: 'donnerstag' } }]);
  publish!({ displayName: 'Anna', timeZone: TimeZone.parse('America/New_York') });
  expect(received).toMatchObject([{}, { type: 'ready', data: { displayName: 'Anna', localDate: '2026-10-14', weekday: 'mittwoch' } }]);
  stop();
});

test('der Kopf ist vor dem Öffnen eines Kontos registriert und folgt der jeweils geöffneten Kontodatenbank', () => {
  const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
  const registry = createTodayRegistry();
  const people: Record<string, string> = { philipp: 'Philipp', anna: 'Anna' };
  // Kontodatenbanken als Test-Adapter: Der Kopf liest sie nur über die übergebene Beobachtung.
  const database = (accountId: string) => ({ accountId }) as unknown as LocalDatabase;
  const observed: string[] = [];
  const opened = followTodayPerson(registry, clock, ({ accountId }, listener) => {
    observed.push(`an:${accountId}`);
    listener({ displayName: people[accountId]!, timeZone: TimeZone.parse('Europe/Berlin') });
    return () => observed.push(`ab:${accountId}`);
  });
  const received: unknown[] = [];
  const stop = registry.subscribe('header', (state) => received.push(state));
  expect(received).toEqual([{ type: 'loading' }]);

  const close = opened(database('philipp'));
  expect(received.at(-1)).toMatchObject({ type: 'ready', data: { displayName: 'Philipp' } });
  opened(database('anna'));
  expect(received.at(-1)).toMatchObject({ type: 'ready', data: { displayName: 'Anna' } });
  // Das Lösen einer schon abgelösten Datenbank ändert nichts.
  close();
  expect(received.at(-1)).toMatchObject({ data: { displayName: 'Anna' } });
  stop();
  expect(observed).toEqual(['an:philipp', 'ab:philipp', 'an:anna', 'ab:anna']);
});
