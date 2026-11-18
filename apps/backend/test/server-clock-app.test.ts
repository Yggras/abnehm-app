import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { seedManifests, seedRoutePath, serverClockRoutePath } from '@abnehm/contracts/seeds';

import type { SessionStore, StoredSession } from '../../mobile/src/auth/app-auth.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createAppSession } from '../../mobile/src/session/app-session.ts';
import { createAppTestClock } from '../../mobile/src/test-capabilities/clock.ts';
import { createFaultController, faultyFetch } from '../../mobile/src/test-capabilities/faults.ts';
import { createNotificationTestControl } from '../../mobile/src/test-capabilities/notifications.ts';
import { runSeed } from '../../mobile/src/test-capabilities/seed/seed-flow.ts';
import { fetchFollowingServerClock } from '../../mobile/src/test-capabilities/server-clock.ts';
import { createDevelopmentTestBackend, testBaseUrl, type DevelopmentTestBackend } from './support/app.ts';
import { call, newDevice } from './support/auth-client.ts';
import { canonical, seedPhone, stateOf, type SeedWorld } from './support/seed-world.ts';

// Nachweis für #271: Das Development-Backend liest nach einem Seed die Uhr des Manifests, und der
// Uhr-Link der App stellt die Serveruhr mit, auch wenn das Netz erst später zurückkommt. Die Systemuhr
// steht hier als Testuhr auf einem anderen Tag als jedes Manifest, wie im echten Betrieb.

const system = () => createTestClock({ instant: Instant.parse('2026-11-04T09:00:00.000Z'), timeZone: TimeZone.parse('UTC') });
const gekoppelt = seedManifests.gekoppelt;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('Serveruhr des Development-Backends', () => {
  it('`POST /dev/uhr` stellt die Serveruhr; ein ungültiger Zeitpunkt ändert nichts', async () => {
    const backend = await createDevelopmentTestBackend({ system: system() });

    expect((await call(backend.development, 'POST', serverClockRoutePath, newDevice(), { instant: '2026-10-15T13:00:00.000Z' })).status).toBe(204);
    expect(backend.serverClock.read().instant).toBe('2026-10-15T13:00:00.000Z');
    expect(backend.clock.read().instant).toBe('2026-10-15T13:00:00.000Z');

    expect(await call(backend.development, 'POST', serverClockRoutePath, newDevice(), { instant: 'morgen' })).toEqual(
      expect.objectContaining({ status: 400, body: { code: 'invalid_payload', retryable: false } }),
    );
    expect(backend.serverClock.read().instant).toBe('2026-10-15T13:00:00.000Z');
  });

  it('die Seed-Route stellt die Serveruhr auf die Uhr des Manifests', async () => {
    const backend = await createDevelopmentTestBackend({ system: system() });
    backend.serverClock.set(Instant.parse('2026-12-24T18:00:00.000Z'));

    expect((await call(backend.development, 'POST', seedRoutePath, newDevice(), { scenario: 'gekoppelt' })).status).toBe(204);

    expect(backend.serverClock.read(TimeZone.parse('Europe/Berlin'))).toEqual({
      instant: gekoppelt.clock.instant,
      timeZone: 'Europe/Berlin',
      localDate: '2026-10-14',
      utcOffsetMinutes: 120,
    });
  });

  /** `gekoppelt` über die Seed-Route, beide Geräte im Ausgangszustand des Manifests. */
  async function seededByRoute(backend: DevelopmentTestBackend): Promise<SeedWorld> {
    expect((await call(backend.development, 'POST', seedRoutePath, newDevice(), { scenario: 'gekoppelt' })).status).toBe(204);
    const phones = {
      'philipp-iphone': await seedPhone(backend, gekoppelt, 'philipp-iphone'),
      'anna-android': await seedPhone(backend, gekoppelt, 'anna-android'),
    };
    return { backend, manifest: gekoppelt, phones };
  }

  it('`gekoppelt`: Nach dem Seed ändert der Pull beider Geräte den geseedeten Tageszielstand nicht', async () => {
    const world = await seededByRoute(await createDevelopmentTestBackend({ system: system() }));

    await world.phones['philipp-iphone']!.sync();
    await world.phones['anna-android']!.sync();

    expect(gekoppelt.target).toEqual(gekoppelt.initial);
    expect(await stateOf(world)).toEqual(canonical(gekoppelt.target));
    expect(world.phones['philipp-iphone']!.partner().dailyGoalStatus).toEqual(expect.objectContaining({ stage: 'fast_geschafft' }));
  });

  it('Gegenprobe: Auf der Systemuhr rechnet der Vor-Pull-Schritt den Tageszielstand für den echten Tag neu', async () => {
    const backend = await createDevelopmentTestBackend({ system: system() });
    const world = await seededByRoute(backend);
    backend.serverClock.set(system().read().instant);

    await world.phones['philipp-iphone']!.sync();

    expect(world.phones['philipp-iphone']!.partner().dailyGoalStatus).not.toEqual(expect.objectContaining({ stage: 'fast_geschafft' }));
    expect((await stateOf(world)).server).not.toEqual(canonical(gekoppelt.target).server);
  });
});

// Uhr-Link -----------------------------------------------------------------------------------------

function memoryStore(): SessionStore {
  let value: StoredSession | null = null;
  return {
    read: async () => value,
    write: async (session) => {
      value = session;
    },
    clear: async () => {
      value = null;
    },
  };
}

/** Geräteuhr vor dem Seed: irgendeine echte Uhrzeit, nicht die des Manifests. */
const deviceClock = { read: () => ({ instant: Instant.parse('2026-11-04T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin'), localDate: LocalDate.parse('2026-11-04'), utcOffsetMinutes: 60 }) };

/**
 * Ein Gerät im Development Build, verdrahtet wie `deviceSession`: Fehler-Adapter außen, darunter die
 * Serveruhr, die der Testuhr folgt. `online` stellt das echte Netz (Android: Flugmodus).
 */
function phone(backend: DevelopmentTestBackend) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const { ip } = newDevice();
  const clock = createAppTestClock(deviceClock);
  const faults = createFaultController();
  const network = { online: true, requests: [] as string[] };
  const raw: typeof fetch = async (input, init) => {
    if (!network.online) throw new TypeError('Network request failed');
    const headers = new Headers(init?.headers);
    headers.set('x-forwarded-for', ip);
    network.requests.push(`${init?.method ?? 'GET'} ${String(input).slice(testBaseUrl.length)}`);
    return backend.development.app.request(String(input), { ...init, headers });
  };
  const session = createAppSession({
    baseUrl: testBaseUrl,
    fetch: faultyFetch(fetchFollowingServerClock(raw, { clock, baseUrl: testBaseUrl }), faults),
    sessionStore: memoryStore(),
    databases,
    onAccountOpened: () => () => undefined,
    onError: (error) => {
      throw error;
    },
  });
  return { session, clock, faults, network, notifications: createNotificationTestControl() };
}

const solo = { scenario: 'solo', installation: null, target: { type: 'today' } } as const;

describe('Uhr-Link mit Serveruhr', () => {
  it('der Seed-Link stellt Testuhr und Serveruhr auf die Uhr des Manifests', async () => {
    const backend = await createDevelopmentTestBackend({ system: system() });
    const device = phone(backend);

    expect((await runSeed(solo, device)).type).toBe('geseedet');

    expect(device.clock.read().instant).toBe(seedManifests.solo.clock.instant);
    expect(backend.serverClock.read().instant).toBe(seedManifests.solo.clock.instant);
  });

  it('stellt die Serveruhr mit der Testuhr vor, auch im Transport-Fehlermodus (iOS)', async () => {
    const backend = await createDevelopmentTestBackend({ system: system() });
    const device = phone(backend);
    await runSeed(solo, device);
    device.faults.set({ transport: 'offline' });

    device.clock.adjust({ timeZone: TimeZone.parse('Pacific/Kiritimati') });
    device.clock.adjust({ advanceHours: 25 });

    await expect.poll(() => backend.serverClock.read().instant).toBe('2026-10-15T13:00:00.000Z');
    expect(device.clock.read().instant).toBe('2026-10-15T13:00:00.000Z');
  });

  it('ohne Netz (Android-Flugmodus) holt die nächste Anfrage das Stellen nach, bevor sie selbst den Server erreicht', async () => {
    const backend = await createDevelopmentTestBackend({ system: system() });
    const device = phone(backend);
    await runSeed(solo, device);
    device.network.online = false;

    device.clock.adjust({ advanceHours: 25 });
    await expect(device.session.fetch(`${testBaseUrl}/v1/status`)).rejects.toThrow('Network request failed');
    expect(backend.serverClock.read().instant).toBe(seedManifests.solo.clock.instant);

    device.network.online = true;
    device.network.requests.length = 0;
    expect((await device.session.fetch(`${testBaseUrl}/v1/status`)).status).toBe(200);

    expect(device.network.requests).toEqual([`POST ${serverClockRoutePath}`, 'GET /v1/status']);
    expect(backend.serverClock.read().instant).toBe('2026-10-15T13:00:00.000Z');
  });

  it('ohne Änderung der Testuhr bleibt die Serveruhr unberührt', async () => {
    const backend = await createDevelopmentTestBackend({ system: system() });
    const device = phone(backend);

    expect((await device.session.fetch(`${testBaseUrl}/v1/status`)).status).toBe(200);

    expect(device.network.requests).toEqual(['GET /v1/status']);
    expect(backend.serverClock.read().instant).toBe('2026-11-04T09:00:00.000Z');
  });
});
