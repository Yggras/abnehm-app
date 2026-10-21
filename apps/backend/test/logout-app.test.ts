import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';

import type { StoredSession } from '../../mobile/src/auth/app-auth.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createLogout, syncBeforeLogout, type LogoutCleanupHook, type LogoutRecord } from '../../mobile/src/logout/logout.ts';
import { createAppSession } from '../../mobile/src/session/app-session.ts';
import {
  createHttpSyncTransport,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationSyncEntities,
  updateOwnPerson,
  type SyncEngine,
} from '../../mobile/src/sync/index.ts';
import { onlineRequest } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, securityLogEntries } from './support/auth-client.ts';

// Das Abmeldemodul der App (#111) mit Auth-Modul, kontogetrennter SQLite-Datenbank und Sync-Engine
// gegen die echte Hono-App mit Postgres. SecureStore und Netz sind Test-Adapter; ein „Neustart“ baut die
// Installation über denselben Speichern und Dateien neu auf.

const start = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const email = 'anna@example.test';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Ein Speicher wie SecureStore, der einen Neustart überdauert. */
function memory<T>() {
  const store = {
    value: null as T | null,
    read: async () => store.value,
    write: async (value: T) => {
      store.value = value;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

/** Was eine Installation über einen Neustart behält. */
function persisted() {
  const files = createBetterSqliteFiles();
  cleanups.push(() => files.remove());
  return { files, sessionStore: memory<StoredSession>(), logoutStore: memory<LogoutRecord>(), ip: newDevice().ip };
}
type Persisted = ReturnType<typeof persisted>;

/** Netz der Installation: aus, eine feste Antwort für einen Pfad oder eine verlorene Antwort. */
type Network = { online: boolean; answer?: { path: string; status: number; body: unknown }; loseResponseOf?: string };

/** Eine laufende Installation; `install` erneut über denselben Speichern ist ein Neustart. */
function install(backend: TestBackend, kept: Persisted, network: Network = { online: true }) {
  const clock = createTestClock(start);
  const registry = createSyncRegistry(foundationSyncEntities);
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry, clock, newId });
  const fail = (error: unknown) => {
    throw error;
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!network.online) throw new TypeError('Network request failed');
    if (network.answer !== undefined && url.endsWith(network.answer.path)) return Response.json(network.answer.body, { status: network.answer.status });
    const headers = new Headers(init?.headers);
    headers.set('x-forwarded-for', kept.ip);
    const response = await backend.app.request(input instanceof Request ? input : url, { ...init, headers });
    if (network.loseResponseOf !== undefined && url.endsWith(network.loseResponseOf)) throw new TypeError('Network request failed');
    return response;
  };
  const databases = createLocalDatabases({ openSqlite: kept.files.openSqlite, onError: fail });
  cleanups.push(() => databases.lock());
  let engine: SyncEngine | null = null;
  const opened = vi.fn<(accountId: string) => void>();
  const session = createAppSession({
    baseUrl: testBaseUrl,
    fetch,
    sessionStore: kept.sessionStore,
    databases,
    onAccountOpened(database) {
      opened(database.accountId);
      const current = createSyncEngine({
        database,
        registry,
        transport: createHttpSyncTransport({ baseUrl: testBaseUrl, fetch: session.auth.fetch }),
        clock,
        installationId: newId(),
      });
      engine = current;
      return () => {
        if (engine === current) engine = null;
      };
    },
    onError: fail,
  });
  const errors: unknown[] = [];
  const logout = createLogout({
    auth: session.auth,
    revocations: session.revocations,
    databases,
    store: kept.logoutStore,
    sync: () => syncBeforeLogout(engine),
    newId,
    onError: (error) => errors.push(error),
  });
  const cleanedUp: string[] = [];
  logout.onCleanup({ name: 'test-check-ins', run: (accountId) => void cleanedUp.push(accountId) });
  return {
    auth: session.auth,
    logout,
    opened,
    errors,
    cleanedUp,
    sync: () => engine!.sync(),
    /** Eine lokale Änderung samt Outbox-Operation. */
    rename: (displayName: string) =>
      databases.current()!.transaction((tx) => updateOwnPerson(tx, writer, { displayName }, Instant.parse(clock.read().instant))),
    onCleanup: (hook: LogoutCleanupHook) => logout.onCleanup(hook),
  };
}

/** Backend mit Test-Haken für die Serverabmeldung und eine registrierte, synchronisierte Installation. */
async function setup(network: Network = { online: true }) {
  const backend = await createTestBackend();
  const serverHook = { calls: [] as string[], failing: false };
  backend.logout.registerHook({
    name: 'test-push',
    async run(_tx, actor) {
      if (serverHook.failing) throw new Error('Push-Dienst nicht erreichbar');
      serverHook.calls.push(actor.accountId);
    },
  });
  const kept = persisted();
  const phone = install(backend, kept, network);
  const registered = await phone.auth.register({ email, password: defaultPassword, displayName: 'Anna', timeZone: start.timeZone });
  if (registered.type !== 'registered') throw new Error(`Registrierung fehlgeschlagen: ${registered.type}`);
  await phone.sync();
  const token = kept.sessionStore.value!.token!;
  return { backend, serverHook, kept, phone, network, accountId: registered.accountId, token };
}

const sessionIsValid = async (backend: TestBackend, token: string) =>
  (await backend.auth.sessions.authenticate(new Headers({ authorization: `Bearer ${token}` }))) !== null;
const accountFiles = (kept: Persisted, accountId: string) => kept.files.existingFileNames().filter((name) => name.includes(accountId));
const logoutEvents = async (backend: TestBackend) =>
  (await securityLogEntries(backend)).filter((entry) => entry.eventType === 'abmeldung' || entry.eventType === 'sitzungswiderruf');

/** Server abgemeldet, lokal nichts mehr vom Konto: Sitzung, Datenbank samt Partnercache, Haken gelaufen. */
async function expectLoggedOut({ backend, serverHook, kept, accountId, token }: Awaited<ReturnType<typeof setup>>, phone: ReturnType<typeof install>) {
  expect(await sessionIsValid(backend, token)).toBe(false);
  expect(serverHook.calls).toEqual([accountId]);
  expect(await logoutEvents(backend)).toEqual([
    { eventType: 'abmeldung', accountId, details: { accountId } },
    { eventType: 'sitzungswiderruf', accountId, details: { accountId, scope: 'aktuelle', cause: 'abmeldung' } },
  ]);
  expect(phone.auth.state()).toEqual({ type: 'abgemeldet' });
  expect(kept.sessionStore.value).toBeNull();
  expect(kept.logoutStore.value).toBeNull();
  // Partner-Zusammenfassungen und -Tageszielstatus liegen als Lesecache in dieser Datei.
  expect(accountFiles(kept, accountId)).toEqual([]);
  expect(phone.cleanedUp).toEqual([accountId]);
}

/** Nichts ist geschehen: Sitzung gilt, Daten und Outbox liegen noch da, keine Abmeldung begonnen. */
async function expectUnchanged({ backend, serverHook, kept, accountId, token }: Awaited<ReturnType<typeof setup>>, phone: ReturnType<typeof install>) {
  expect(await sessionIsValid(backend, token)).toBe(true);
  expect(serverHook.calls).toEqual([]);
  expect(await logoutEvents(backend)).toEqual([]);
  expect(phone.auth.state()).toEqual({ type: 'angemeldet', accountId });
  expect(kept.sessionStore.value).toEqual({ accountId, token });
  expect(accountFiles(kept, accountId)).not.toEqual([]);
  expect(phone.cleanedUp).toEqual([]);
}

describe('Vollständiges Abmelden', () => {
  it('meldet online mit leerer Outbox vollständig ab', async () => {
    const world = await setup();

    expect(await world.phone.logout.logout()).toEqual({ type: 'logged_out' });

    await expectLoggedOut(world, world.phone);
  });

  it('verlangt bei offener Operation den bestätigten Verzicht und meldet danach ab', async () => {
    const world = await setup();
    // Ein zu alter Client kann nicht pushen (Abschnitt 10); die Operation bleibt ungesichert.
    world.network.answer = { path: '/v1/sync/push', status: 409, body: { code: 'schema_update_required', retryable: false } };
    world.phone.rename('Anni');

    expect(await world.phone.logout.logout()).toEqual({ type: 'confirmation_required', unsecuredOperations: 1 });
    await expectUnchanged(world, world.phone);
    expect(world.kept.logoutStore.value).toBeNull();

    expect(await world.phone.logout.logout({ discardUnsecured: true })).toEqual({ type: 'logged_out' });
    await expectLoggedOut(world, world.phone);
  });

  it('setzt nach verlorener Serverantwort beim Neustart mit identischem Retry der widerrufenen Sitzung fort', async () => {
    const world = await setup();
    world.network.loseResponseOf = '/v1/session/logout';

    expect(await world.phone.logout.logout()).toEqual({ type: 'unreachable' });
    expect(await sessionIsValid(world.backend, world.token)).toBe(false);
    expect(world.kept.logoutStore.value).toMatchObject({ phase: 'logout_pending', revocation: { accountId: world.accountId } });
    expect(accountFiles(world.kept, world.accountId)).not.toEqual([]);
    const { requestId } = world.kept.logoutStore.value!.revocation;

    const restarted = install(world.backend, world.kept);
    expect(await restarted.logout.start()).toEqual({ type: 'logged_out' });

    expect(restarted.opened).not.toHaveBeenCalled();
    expect((await world.backend.database.db.select().from(onlineRequest)).map((row) => row.requestId)).toEqual([requestId]);
    await expectLoggedOut(world, restarted);
  });

  it('meldet ohne Netz einen Fehler und lässt alles bestehen', async () => {
    const world = await setup();
    world.network.online = false;

    expect(await world.phone.logout.logout()).toEqual({ type: 'unreachable' });

    await expectUnchanged(world, world.phone);
    expect(world.kept.logoutStore.value).toBeNull();
  });

  it('lässt bei einem Fehler vor dem Widerruf alles bestehen und wiederholt mit derselben requestId', async () => {
    const world = await setup();
    world.serverHook.failing = true;

    expect(await world.phone.logout.logout()).toEqual({ type: 'unreachable' });
    await expectUnchanged(world, world.phone);
    const pending = world.kept.logoutStore.value!;
    expect(pending.phase).toBe('logout_pending');
    expect(await world.backend.database.db.select().from(onlineRequest)).toEqual([]);

    world.serverHook.failing = false;
    expect(await world.phone.logout.logout()).toEqual({ type: 'logged_out' });
    expect((await world.backend.database.db.select().from(onlineRequest)).map((row) => row.requestId)).toEqual([pending.revocation.requestId]);
    await expectLoggedOut(world, world.phone);
  });

  it('setzt eine nach dem Widerruf abgebrochene Bereinigung beim Neustart fort, bevor Fachdaten erscheinen', async () => {
    const world = await setup();
    // Die App bleibt im ersten Haken stehen, etwa weil das System sie beendet.
    const stuck = vi.fn(() => new Promise<void>(() => {}));
    const unregister = world.phone.onCleanup({ name: 'bleibt-stehen', run: stuck });
    void world.phone.logout.logout();
    await vi.waitFor(() => expect(stuck).toHaveBeenCalled());
    unregister();
    expect(world.kept.logoutStore.value).toMatchObject({ phase: 'cleanup_pending', revocation: { accountId: world.accountId } });
    expect(world.kept.sessionStore.value).not.toBeNull();

    // Ohne Netz öffnete `checkSession` die Datenbank mit der gespeicherten Sitzung; die Bereinigung braucht keins.
    const restarted = install(world.backend, world.kept, { online: false });
    expect(await restarted.logout.start()).toEqual({ type: 'logged_out' });

    expect(restarted.opened).not.toHaveBeenCalled();
    await expectLoggedOut(world, restarted);
  });

  it('meldet niemanden ab, der sich nach verlorener Antwort neu angemeldet hat', async () => {
    const world = await setup();
    world.network.loseResponseOf = '/v1/session/logout';
    await world.phone.logout.logout();
    delete world.network.loseResponseOf;
    expect(await world.phone.auth.checkSession()).toEqual({ type: 'ungueltig' });
    expect(await world.phone.auth.signIn({ email, password: defaultPassword })).toEqual({ type: 'signed_in', accountId: world.accountId });
    const newToken = world.kept.sessionStore.value!.token!;

    const restarted = install(world.backend, world.kept);
    expect(await restarted.logout.start()).toBeNull();

    expect(restarted.auth.state()).toEqual({ type: 'angemeldet', accountId: world.accountId });
    expect(restarted.opened).toHaveBeenCalledWith(world.accountId);
    expect(await sessionIsValid(world.backend, newToken)).toBe(true);
    expect(world.kept.logoutStore.value).toBeNull();
    expect(restarted.cleanedUp).toEqual([]);
  });

  it('löscht nach gescheiterter Bereinigung keine spätere Anmeldung beim Neustart', async () => {
    const world = await setup();
    world.phone.onCleanup({
      name: 'scheitert',
      run: () => {
        throw new Error('Check-ins nicht abräumbar');
      },
    });
    expect(await world.phone.logout.logout()).toEqual({ type: 'cleanup_pending' });
    expect(world.phone.auth.state()).toEqual({ type: 'abgemeldet' });
    expect(await world.phone.auth.signIn({ email, password: defaultPassword })).toEqual({ type: 'signed_in', accountId: world.accountId });
    const newToken = world.kept.sessionStore.value!.token!;

    const restarted = install(world.backend, world.kept);
    expect(await restarted.logout.start()).toBeNull();

    expect(restarted.auth.state()).toEqual({ type: 'angemeldet', accountId: world.accountId });
    expect(world.kept.sessionStore.value).toEqual({ accountId: world.accountId, token: newToken });
    expect(await sessionIsValid(world.backend, newToken)).toBe(true);
    expect(world.kept.logoutStore.value).toBeNull();
  });

  it('setzt eine offene Abmeldung beim Start fort; ein gleichzeitiger Aufruf der Oberfläche wartet darauf', async () => {
    const world = await setup();
    world.network.loseResponseOf = '/v1/session/logout';
    world.network.answer = { path: '/v1/sync/push', status: 409, body: { code: 'schema_update_required', retryable: false } };
    expect(await world.phone.logout.logout()).toEqual({ type: 'unreachable' });
    expect(await world.phone.logout.pending()).toBe(true);
    delete world.network.loseResponseOf;

    // Der Server hat schon widerrufen; ohne Sitzung lässt sich die neue Änderung nicht mehr sichern.
    const restarted = install(world.backend, world.kept);
    const starting = restarted.logout.start();
    // Ein gleichzeitiger Aufruf der Oberfläche wartet auf den Start, statt dessen `null` zu erhalten.
    const fromScreen = restarted.logout.logout();

    expect(await starting).toEqual({ type: 'logged_out' });
    expect(await fromScreen).toEqual({ type: 'unauthorized' });
    expect(await restarted.logout.pending()).toBe(false);
    await expectLoggedOut(world, restarted);
  });

  it('fragt beim fortgesetzten Start nach, solange die Sitzung gilt und Operationen offen sind', async () => {
    const world = await setup();
    world.serverHook.failing = true;
    expect(await world.phone.logout.logout()).toEqual({ type: 'unreachable' });
    world.serverHook.failing = false;
    world.network.answer = { path: '/v1/sync/push', status: 409, body: { code: 'schema_update_required', retryable: false } };

    const restarted = install(world.backend, world.kept, world.network);
    await restarted.logout.start({ resumeLogout: false });
    restarted.rename('Anni');
    expect(await restarted.logout.start()).toEqual({ type: 'confirmation_required', unsecuredOperations: 1 });
    expect(await restarted.logout.pending()).toBe(true);

    expect(await restarted.logout.logout({ discardUnsecured: true })).toEqual({ type: 'logged_out' });
    await expectLoggedOut(world, restarted);
  });

  it('fragt nach, wenn vor dem 401 Operationen offline entstanden sind, und lässt die Datenbank bis dahin stehen', async () => {
    const world = await setup();
    world.network.loseResponseOf = '/v1/session/logout';
    expect(await world.phone.logout.logout()).toEqual({ type: 'unreachable' });
    delete world.network.loseResponseOf;
    world.network.online = false;
    world.phone.rename('Anni');
    world.network.online = true;

    const restarted = install(world.backend, world.kept);
    expect(await restarted.logout.start()).toEqual({ type: 'confirmation_required', unsecuredOperations: 1 });

    expect(restarted.auth.state()).toEqual({ type: 'gesperrt', accountId: world.accountId });
    expect(restarted.opened).not.toHaveBeenCalled();
    expect(accountFiles(world.kept, world.accountId)).not.toEqual([]);
    expect(await restarted.logout.logout({ discardUnsecured: true })).toEqual({ type: 'logged_out' });
    await expectLoggedOut(world, restarted);
  });

  it('sperrt keine neue Anmeldung, wenn der Server die alte Sitzung ohne Abmeldeergebnis ablehnt', async () => {
    const world = await setup();
    world.serverHook.failing = true;
    expect(await world.phone.logout.logout()).toEqual({ type: 'unreachable' });
    world.serverHook.failing = false;
    // Etwa eine Passwortänderung auf einem anderen Gerät: Die alte Sitzung endet ohne Abmeldeergebnis.
    const old = await world.backend.auth.sessions.authenticate(new Headers({ authorization: `Bearer ${world.token}` }));
    await world.backend.auth.revokeSession(old!, 'widerruf');
    expect(await world.phone.auth.checkSession()).toEqual({ type: 'ungueltig' });
    expect(await world.phone.auth.signIn({ email, password: defaultPassword })).toEqual({ type: 'signed_in', accountId: world.accountId });
    const newToken = world.kept.sessionStore.value!.token!;

    const restarted = install(world.backend, world.kept);
    expect(await restarted.logout.start()).toBeNull();

    expect(restarted.auth.state()).toEqual({ type: 'angemeldet', accountId: world.accountId });
    expect(world.kept.sessionStore.value).toEqual({ accountId: world.accountId, token: newToken });
    expect(world.kept.logoutStore.value).toBeNull();
    expect(restarted.cleanedUp).toEqual([]);
  });
});
