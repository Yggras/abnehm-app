import { Instant, TimeZone } from '@abnehm/contracts/base';

import type { SessionStore, StoredSession } from '../auth/app-auth';
import { createAppTestClock, type AppTestClock } from './clock';
import { createFaultController, faultyFetch, faultySessionStore, type FaultController } from './faults';
import { createTestInbox } from './inbox';
import { parseTestLink } from './links';
import { applyRuntimeProfile, runtimeProfiles, type RuntimeProfileKey } from './profiles';

// Nachweis für #113: Jedes Laufzeitprofil bildet seinen Zeit-, Transport-, Auth-, Storage- oder
// Serverfehler deterministisch über die Test-Adapter der App-Sitzung ab, erreichbar über den Link
// `profil` der Testfähigkeiten. Je Profil steht ein Fall mit seinem Schlüssel; die Registry der
// Seed-Varianten (`test/seed-varianten.ts`) verweist darauf.

const start = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const ok = () => Promise.resolve(new Response('{}', { status: 200 }));

type Adapters = { faults: FaultController; clock: AppTestClock; fetch: typeof fetch; store: SessionStore; backend: jest.Mock };

/** Profil anwenden, dann über die echten Adapter beobachten. */
function profiled(key: RuntimeProfileKey): Adapters {
  const faults = createFaultController();
  const clock = createAppTestClock({ read: () => { throw new Error('Geräteuhr'); } });
  clock.fix(start);
  applyRuntimeProfile(key, { faults, clock });
  const backend = jest.fn(ok);
  let stored: StoredSession | null = null;
  const store: SessionStore = { read: async () => stored, write: async (session) => void (stored = session), clear: async () => void (stored = null) };
  return { faults, clock, fetch: faultyFetch(backend, faults), store: faultySessionStore(store, faults), backend };
}

describe('Laufzeitprofile', () => {
  it('uhr-ungesichert-24h: Die Testuhr steht 25 Stunden später, alle Adapter arbeiten normal', async () => {
    const { clock, faults, fetch } = profiled('uhr-ungesichert-24h');
    expect(clock.read()).toMatchObject({ instant: '2026-10-15T13:00:00.000Z', timeZone: 'Europe/Berlin', localDate: '2026-10-15' });
    expect(faults.plan()).toEqual({ transport: 'ok', server: 'ok', auth: 'ok', storage: 'ok' });
    expect((await fetch('https://backend.test/v1/status')).status).toBe(200);
  });

  it('uhr-reise: Die eigene Zone ist Pacific/Kiritimati, der Zeitpunkt bleibt', () => {
    const { clock } = profiled('uhr-reise');
    expect(clock.read()).toMatchObject({ instant: '2026-10-14T12:00:00.000Z', timeZone: 'Pacific/Kiritimati', localDate: '2026-10-15', utcOffsetMinutes: 840 });
  });

  it('transport-offline: Anfragen scheitern ohne den Server zu erreichen', async () => {
    const { fetch, backend } = profiled('transport-offline');
    await expect(fetch('https://backend.test/v1/sync/push')).rejects.toThrow('Network request failed');
    expect(backend).not.toHaveBeenCalled();
  });

  it('transport-antwort-verloren: Der Server verarbeitet, die App sieht einen Netzfehler', async () => {
    const { fetch, backend } = profiled('transport-antwort-verloren');
    await expect(fetch('https://backend.test/v1/sync/push')).rejects.toThrow('Network request failed');
    expect(backend).toHaveBeenCalledTimes(1);
  });

  it('server-nicht-verfuegbar: 503 ohne Body', async () => {
    const response = await profiled('server-nicht-verfuegbar').fetch('https://backend.test/v1/sync/pull');
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
  });

  it('auth-sitzung-abgelehnt: Anfragen mit Sitzung enden mit 401', async () => {
    const { fetch } = profiled('auth-sitzung-abgelehnt');
    expect((await fetch('https://backend.test/v1/person/bootstrap', { headers: { authorization: 'Bearer x' } })).status).toBe(401);
  });

  it('storage-nicht-verfuegbar: Der geschützte Speicher liest und schreibt nicht', async () => {
    const { store } = profiled('storage-nicht-verfuegbar');
    await expect(store.write({ accountId: 'a', token: 't' })).rejects.toThrow('Geschützter Speicher nicht verfügbar');
    await expect(store.read()).rejects.toThrow('Geschützter Speicher nicht verfügbar');
  });

  it('Profile ändern nur, was sie nennen, und lassen sich kombinieren', () => {
    const faults = createFaultController();
    const clock = createAppTestClock({ read: () => { throw new Error('Geräteuhr'); } });
    clock.fix(start);
    applyRuntimeProfile('transport-offline', { faults, clock });
    applyRuntimeProfile('uhr-ungesichert-24h', { faults, clock });
    applyRuntimeProfile('auth-sitzung-abgelehnt', { faults, clock });
    expect(faults.plan()).toEqual({ transport: 'offline', server: 'ok', auth: 'session_rejected', storage: 'ok' });
    expect(clock.read().instant).toBe('2026-10-15T13:00:00.000Z');
  });

  it('jedes Profil nennt Art und Beschreibung und stellt mindestens einen Adapter', () => {
    for (const profile of Object.values(runtimeProfiles)) {
      expect(['zeit', 'transport', 'auth', 'storage', 'server']).toContain(profile.kind);
      expect(profile.description.length).toBeGreaterThan(0);
      expect('faults' in profile || 'clock' in profile).toBe(true);
    }
  });
});

describe('Link `profil`', () => {
  it('nennt ein bekanntes Profil; unbekannte Namen und fehlende Parameter sind ungültig', () => {
    expect(parseTestLink('abnehmapp-dev://profil?name=transport-offline')).toEqual({ type: 'profil', profile: 'transport-offline' });
    expect(parseTestLink('abnehmapp-e2e://profil?name=zufall')).toEqual({ type: 'ungueltig', capability: 'profil' });
    expect(parseTestLink('abnehmapp-dev://profil')).toEqual({ type: 'ungueltig', capability: 'profil' });
  });

  it('der Eingang stellt das Profil sofort und meldet Plan und Ablesung', () => {
    const faults = createFaultController();
    const clock = createAppTestClock({ read: () => { throw new Error('Geräteuhr'); } });
    clock.fix(start);
    const inbox = createTestInbox({ faults, clock, deviceSuite: () => Promise.reject(new Error('nicht im Test')) });

    inbox.receive(parseTestLink('abnehmapp-dev://profil?name=server-nicht-verfuegbar')!);

    expect(inbox.status()).toEqual({
      type: 'profil_gestellt',
      profile: 'server-nicht-verfuegbar',
      plan: { transport: 'ok', server: 'unavailable', auth: 'ok', storage: 'ok' },
      reading: expect.objectContaining({ instant: '2026-10-14T12:00:00.000Z' }),
    });
  });
});
