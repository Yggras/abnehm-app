import { afterEach, describe, expect, it } from 'vitest';

import { Instant, TimeZone, type LocalDate } from '@abnehm/contracts/base';
import { canonicalRows, seedManifests, type SeedManifest } from '@abnehm/contracts/seeds';
import { InstallationId } from '@abnehm/contracts/sync';

import type { SessionStore, StoredSession } from '../../mobile/src/auth/app-auth.ts';
import type { LocalDatabase } from '../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createAppSession, type AppSession } from '../../mobile/src/session/app-session.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { createAppTestClock, type AppTestClock } from '../../mobile/src/test-capabilities/clock.ts';
import { createFaultController, faultyFetch, type FaultController } from '../../mobile/src/test-capabilities/faults.ts';
import { canonicalDevice, dumpLocalDatabase } from '../../mobile/src/test-capabilities/seed/local-seed.ts';
import { runSeed } from '../../mobile/src/test-capabilities/seed/seed-flow.ts';
import { waterEntryEntity } from '../../mobile/src/trackers/index.ts';
import { createDevelopmentApp } from '../dev/app.ts';
import { dumpServer } from '../dev/seed/server-seed.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { newDevice } from './support/auth-client.ts';

// Tracer Bullet für #112: Der Seed-Deep-Link der App seedet über die Seed-Route des echten
// Development-Backends Postgres, stellt die Testuhr, meldet das Testkonto über das echte Auth-Modul
// an, seedet die lokale Datenbank (SQLite über better-sqlite3) und nennt „Heute“ als Ziel. Danach
// läuft der benannte Schritt des Manifests (Sync) und beide Seiten erreichen den Sollzustand.

const solo = seedManifests.solo;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Was ein Gerät vor dem Seed zeigt: irgendeine echte Uhrzeit, nicht die des Manifests. */
const deviceClock = { read: () => ({ instant: Instant.parse('2026-10-19T08:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin'), localDate: '2026-10-19' as LocalDate, utcOffsetMinutes: 120 }) };

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

type Phone = { session: AppSession; clock: AppTestClock; faults: FaultController; opened: LocalDatabase[] };

/** Ein Gerät im Development Build: App-Sitzung mit Testuhr und Fehler-Adaptern, Backend über `app.request`. */
function phone(backend: TestBackend): Phone {
  const development = createDevelopmentApp({ backend, database: backend.database });
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({
    openSqlite: files.openSqlite,
    onError: (error) => {
      throw error;
    },
  });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const { ip } = newDevice();
  const clock = createAppTestClock(deviceClock);
  const faults = createFaultController();
  const opened: LocalDatabase[] = [];
  const network: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('x-forwarded-for', ip);
    return development.request(String(input), { ...init, headers });
  };
  const session = createAppSession({
    baseUrl: testBaseUrl,
    fetch: faultyFetch(network, faults),
    sessionStore: memoryStore(),
    databases,
    onAccountOpened: (database) => {
      opened.push(database);
      return () => undefined;
    },
    onError: (error) => {
      throw error;
    },
  });
  return { session, clock, faults, opened };
}

const today = { scenario: 'solo', installation: null, target: { type: 'today' } } as const;

function sync(device: Phone, manifest: SeedManifest, installation: string) {
  const installationId = InstallationId.parse(manifest.installations.find(({ key }) => key === installation)!.installationId);
  const transport = createHttpSyncTransport({ baseUrl: testBaseUrl, fetch: device.session.auth.fetch });
  const database = device.session.databases.current()!;
  // Wie der Composition Root: Die Bereiche melden ihre Entitäten an, hier der Wassereintrag (#171).
  const registry = createSyncRegistry([...foundationSyncEntities, waterEntryEntity]);
  return createSyncEngine({ database, registry, transport, clock: device.clock, installationId }).sync();
}

describe('Seed-Deep-Link „solo“ gegen das Development-Backend', () => {
  it('seedet beide Seiten, stellt die Testuhr, meldet das Testkonto an und führt direkt auf „Heute“', async () => {
    const backend = await createTestBackend();
    const device = phone(backend);

    expect(await runSeed(today, device)).toEqual({ type: 'geseedet', scenario: 'solo', installation: 'philipp-iphone', target: { type: 'today' } });

    expect(await dumpServer(backend.database.db)).toEqual(canonicalRows(solo.initial.server));
    expect(dumpLocalDatabase(device.session.databases.current()!)).toEqual(canonicalDevice(solo.initial.devices['philipp-iphone']!));
    expect(device.clock.read()).toEqual({ instant: '2026-10-14T12:00:00.000Z', timeZone: 'Europe/Berlin', localDate: '2026-10-14', utcOffsetMinutes: 120 });
    expect(device.session.auth.state()).toEqual({ type: 'angemeldet', accountId: solo.accounts[0]!.accountId });
    // Die kontobezogenen Beobachter (Kopf von „Heute“) hängen an der geseedeten Datenbank.
    expect(device.opened.map(({ accountId }) => accountId)).toEqual([solo.accounts[0]!.accountId]);
    // Ohne Onboarding: Die Person des Kontos hat es abgeschlossen.
    const bootstrap = await device.session.auth.bootstrapPerson({ displayName: 'Egal', timeZone: TimeZone.parse('Europe/Berlin') });
    expect(bootstrap).toEqual({ type: 'bootstrapped', person: expect.objectContaining({ personId: solo.accounts[0]!.personId, onboardingStatus: 'abgeschlossen' }) });
  });

  it('erreicht nach dem benannten Schritt (Sync) den Sollzustand des Manifests auf beiden Seiten', async () => {
    const backend = await createTestBackend();
    const device = phone(backend);
    await runSeed(today, device);
    expect(solo.steps).toEqual([{ type: 'sync', installation: 'philipp-iphone' }]);

    expect(await sync(device, solo, 'philipp-iphone')).toEqual({ push: 'nothing_to_do', pull: 'done' });

    expect(await dumpServer(backend.database.db)).toEqual(canonicalRows(solo.target.server));
    expect(dumpLocalDatabase(device.session.databases.current()!)).toEqual(canonicalDevice(solo.target.devices['philipp-iphone']!));
  });

  it('ist wiederholbar: erneutes Seeden ergibt kanonisch denselben Stand, auch nach Änderungen', async () => {
    const backend = await createTestBackend();
    const device = phone(backend);
    await runSeed(today, device);
    const server = await dumpServer(backend.database.db);
    const local = dumpLocalDatabase(device.session.databases.current()!);
    await backend.database.db.execute('update water_entry set amount_ml = 1');

    expect((await runSeed(today, device)).type).toBe('geseedet');
    expect(await dumpServer(backend.database.db)).toEqual(server);
    expect(dumpLocalDatabase(device.session.databases.current()!)).toEqual(local);
  });

  it('der geseedete Serverstand trägt einen vollständigen Pull einer neuen Installation', async () => {
    const backend = await createTestBackend();
    await runSeed(today, phone(backend));
    const fresh = phone(backend);
    await fresh.session.auth.signIn({ email: solo.accounts[0]!.email, password: solo.accounts[0]!.password });

    expect(await sync(fresh, solo, 'philipp-iphone')).toEqual({ push: 'nothing_to_do', pull: 'done' });
    const local = dumpLocalDatabase(fresh.session.databases.current()!);
    expect(local.rows.person).toEqual(solo.initial.devices['philipp-iphone']!.rows.person);
    expect(local.cursor).toBe(solo.initial.devices['philipp-iphone']!.cursor);
  });

  it('scheitert über den Fehler-Adapter deterministisch am Backend und lässt Gerät und Uhr unverändert', async () => {
    const backend = await createTestBackend();
    const device = phone(backend);
    device.faults.set({ transport: 'offline' });
    expect(await runSeed(today, device)).toEqual({ type: 'fehlgeschlagen', step: 'backend' });
    device.faults.set({ transport: 'ok', server: 'unavailable' });
    expect(await runSeed(today, device)).toEqual({ type: 'fehlgeschlagen', step: 'backend' });
    expect(device.session.auth.state()).toEqual({ type: 'unbekannt' });
    expect(device.clock.read().instant).toBe('2026-10-19T08:00:00.000Z');
    expect(await dumpServer(backend.database.db)).toEqual(canonicalRows({ sync_clock: [{ id: 1, position: '0' }] }));
  });

  it('Auth-Adapter: lehnt der Server die Sitzung ab, sperrt die App und schließt die Kontodatenbank', async () => {
    const backend = await createTestBackend();
    const device = phone(backend);
    await runSeed(today, device);
    device.faults.set({ auth: 'session_rejected' });

    expect(await device.session.auth.bootstrapPerson({ displayName: 'Egal', timeZone: TimeZone.parse('Europe/Berlin') })).toEqual({ type: 'unauthorized' });
    expect(device.session.auth.state()).toEqual({ type: 'gesperrt', accountId: solo.accounts[0]!.accountId });
    expect(device.session.databases.current()).toBeNull();
  });
});
