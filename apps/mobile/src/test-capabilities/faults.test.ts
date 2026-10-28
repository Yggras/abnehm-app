import { Instant, TimeZone } from '@abnehm/contracts/base';

import type { SessionStore, StoredSession } from '../auth/app-auth';
import { createAppTestClock } from './clock';
import { createFaultController, faultyFetch, faultySessionStore } from './faults';

// Nachweis für #112: Test-Adapter für Zeit, Transport, Server, Auth und Storage sind deterministisch steuerbar.

const ok = () => Promise.resolve(new Response('{}', { status: 200 }));

describe('Fehler-Adapter', () => {
  it('reicht ohne Fehler unverändert durch', async () => {
    const inner = jest.fn(ok);
    const response = await faultyFetch(inner, createFaultController())('https://backend.test/v1/status');
    expect(response.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('Transport offline: scheitert ohne Anfrage wie fetch ohne Netz', async () => {
    const inner = jest.fn(ok);
    const faults = createFaultController({ transport: 'offline' });
    await expect(faultyFetch(inner, faults)('https://backend.test/v1/status')).rejects.toThrow('Network request failed');
    expect(inner).not.toHaveBeenCalled();
  });

  it('Antwort verloren: der Server erhält die Anfrage, die App sieht einen Netzfehler', async () => {
    const inner = jest.fn(ok);
    await expect(faultyFetch(inner, createFaultController({ transport: 'response_lost' }))('https://backend.test/v1/sync/push')).rejects.toThrow(
      'Network request failed',
    );
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('Serverfehler: 503 ohne Body', async () => {
    const response = await faultyFetch(ok, createFaultController({ server: 'unavailable' }))('https://backend.test/v1/sync/pull');
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it('Auth: lehnt Anfragen mit Sitzung mit 401 ab, öffentliche nicht', async () => {
    const faulty = faultyFetch(ok, createFaultController({ auth: 'session_rejected' }));
    expect((await faulty('https://backend.test/v1/person/bootstrap', { headers: { authorization: 'Bearer x' } })).status).toBe(401);
    expect((await faulty('https://backend.test/v1/auth/sign-in/email')).status).toBe(200);
  });

  it('Storage: SessionStore scheitert, solange der Schalter steht, und arbeitet danach wieder', async () => {
    let stored: StoredSession | null = null;
    const inner: SessionStore = { read: async () => stored, write: async (session) => void (stored = session), clear: async () => void (stored = null) };
    const faults = createFaultController({ storage: 'unavailable' });
    const store = faultySessionStore(inner, faults);
    await expect(store.write({ accountId: 'a', token: 't' })).rejects.toThrow('Geschützter Speicher nicht verfügbar');
    expect(stored).toBeNull();
    faults.reset();
    await store.write({ accountId: 'a', token: 't' });
    expect(await store.read()).toEqual({ accountId: 'a', token: 't' });
  });

  it('lehnt unbekannte Schalterwerte ab', () => {
    expect(() => createFaultController().set({ transport: 'zufaellig' as never })).toThrow();
  });
});

describe('Testuhr der App', () => {
  const device = { read: () => ({ instant: Instant.parse('2030-01-01T00:00:00.000Z'), timeZone: TimeZone.parse('UTC'), localDate: '2030-01-01' as never, utcOffsetMinutes: 0 }) };

  it('liest die Geräteuhr, bis ein Seed sie stellt, und steht dann auf dessen Uhr', () => {
    const clock = createAppTestClock(device);
    expect(clock.read().instant).toBe('2030-01-01T00:00:00.000Z');
    clock.fix({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
    expect(clock.read()).toEqual({ instant: '2026-10-14T12:00:00.000Z', timeZone: 'Europe/Berlin', localDate: '2026-10-14' });
    clock.fixed()!.advanceBy(12 * 60 * 60 * 1000);
    expect(clock.read().localDate).toBe('2026-10-15');
    clock.release();
    expect(clock.read().instant).toBe('2030-01-01T00:00:00.000Z');
  });

  it('stellt Zeit und Zone vor und meldet jede Änderung (#114)', () => {
    const clock = createAppTestClock(device);
    const changes = jest.fn();
    clock.subscribe(changes);
    clock.fix({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
    clock.adjust({ advanceHours: 25, timeZone: TimeZone.parse('Pacific/Kiritimati') });
    expect(clock.read()).toEqual({ instant: '2026-10-15T13:00:00.000Z', timeZone: 'Pacific/Kiritimati', localDate: '2026-10-16' });
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('stellt eine noch freie Uhr zuerst auf die Geräteuhr', () => {
    const clock = createAppTestClock(device);
    clock.adjust({ advanceHours: 1 });
    expect(clock.read()).toEqual({ instant: '2030-01-01T01:00:00.000Z', timeZone: 'UTC', localDate: '2030-01-01' });
  });
});
