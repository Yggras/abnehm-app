/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import type { RegisterPushInstallationRequest } from '@abnehm/contracts/notifications';
import { InstallationId } from '@abnehm/contracts/sync';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createFakeNotificationPort, type FakeNotificationPort } from '../test-capabilities/notifications';
import { createNotifications, type AppNotifications } from './notifications';
import type { NotificationPermission, NotificationPort } from './port';
import { startPushRegistration, type PushRegistrationOutcome } from './push-registration';

// Nachweis für #139: die Registrierung der Push-Installation (Spezifikation 5, Abschnitt 9) mit dem
// Fake-Mitteilungs-Port und einer echten SQLite-Datei. Der Transport ist ein Fake; gegen den echten
// Server prüft ihn `apps/backend/test/push-registration-app.test.ts`.

const installationKey = InstallationId.parse('5d1a7c3e-2b4f-4e6a-9c8d-1f2e3a4b5c6d');
const token = 'ExponentPushToken[philipps-iphone]';
const clock = createTestClock({ instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Was ein Neustart behält: dieselbe Kontodatenbank. */
async function device() {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  return databases.open('konto_philipp');
}

/** Ein Transport, der Anfragen mitschreibt und auf Wunsch scheitert. */
function fakeTransport() {
  const requests: RegisterPushInstallationRequest[] = [];
  let next: PushRegistrationOutcome[] = [];
  return {
    requests,
    answer(...outcomes: PushRegistrationOutcome[]) {
      next = outcomes;
    },
    async register(request: RegisterPushInstallationRequest): Promise<PushRegistrationOutcome> {
      const outcome = next.shift() ?? 'ok';
      if (outcome === 'ok') requests.push(request);
      return outcome;
    },
  };
}

/** Wiederholungen laufen nur, wenn der Test sie auslöst. */
function manualRetries() {
  const pending: { delayMs: number; run: () => void }[] = [];
  return {
    pending,
    retryAfter(delayMs: number, run: () => void) {
      const entry = { delayMs, run };
      pending.push(entry);
      return () => {
        const index = pending.indexOf(entry);
        if (index >= 0) pending.splice(index, 1);
      };
    },
    async runNext() {
      const entry = pending.shift();
      if (entry === undefined) throw new Error('keine Wiederholung geplant');
      entry.run();
      await flush();
    },
  };
}

type Started = {
  port: FakeNotificationPort;
  notifications: AppNotifications;
  transport: ReturnType<typeof fakeTransport>;
  retries: ReturnType<typeof manualRetries>;
  errors: unknown[];
  stop(): void;
};

async function start(
  database: LocalDatabase,
  permission: NotificationPermission,
  setup: (started: Omit<Started, 'stop'>) => void = () => {},
  { wrap = (port) => port }: { wrap?: (port: NotificationPort) => NotificationPort } = {},
): Promise<Started> {
  const port = createFakeNotificationPort({ permission, pushToken: token });
  const errors: unknown[] = [];
  const notifications = createNotifications({ port: wrap(port), onError: (error) => errors.push(error) });
  const transport = fakeTransport();
  const retries = manualRetries();
  setup({ port, notifications, transport, retries, errors });
  const stop = startPushRegistration({
    database,
    clock,
    notifications,
    port,
    transport,
    installationKey,
    platform: 'ios',
    retryAfter: retries.retryAfter,
    onError: (error) => errors.push(error),
  });
  cleanups.push(stop);
  await flush();
  return { port, notifications, transport, retries, errors, stop };
}

const registered = (permission: NotificationPermission, expoPushToken = token) => ({ installationKey, platform: 'ios', expoPushToken, permission });

test('registriert nach erteilter Erlaubnis', async () => {
  const { notifications, transport } = await start(await device(), 'undetermined');
  expect(transport.requests).toEqual([]);

  await notifications.request();
  await flush();

  expect(transport.requests).toEqual([registered('granted')]);
});

test('registriert bei jedem Start mit Erlaubnis, auch wenn sich nichts geändert hat', async () => {
  const database = await device();
  const first = await start(database, 'granted');
  first.stop();

  const second = await start(database, 'granted');

  expect(first.transport.requests).toEqual([registered('granted')]);
  expect(second.transport.requests).toEqual([registered('granted')]);
});

test('ohne Erlaubnis und ohne frühere Registrierung holt sie kein Token und meldet nichts', async () => {
  const { port, transport } = await start(await device(), 'denied');

  expect(transport.requests).toEqual([]);
  expect(port.calls()).not.toContain('expoPushToken');
});

test('holt den Token über den Mitteilungs-Port und wiederholt später, wenn das scheitert', async () => {
  const { port, transport, retries } = await start(await device(), 'granted', ({ port }) => port.fail('expoPushToken'));
  expect(transport.requests).toEqual([]);
  expect(retries.pending).toHaveLength(1);

  port.heal();
  await retries.runNext();

  expect(port.calls().filter((call) => call === 'expoPushToken')).toHaveLength(2);
  expect(transport.requests).toEqual([registered('granted')]);
  expect(retries.pending).toEqual([]);
});

test('wiederholt eine gescheiterte Anfrage mit wachsendem Abstand, bis sie gelingt', async () => {
  const { transport, retries } = await start(await device(), 'granted', ({ transport }) => transport.answer('failed', 'failed'));
  expect(retries.pending.map((retry) => retry.delayMs)).toEqual([30_000]);

  await retries.runNext();
  expect(retries.pending.map((retry) => retry.delayMs)).toEqual([60_000]);

  await retries.runNext();
  expect(transport.requests).toEqual([registered('granted')]);
  expect(retries.pending).toEqual([]);
});

test('nach einer abgelaufenen Sitzung (401) wiederholt sie nicht', async () => {
  const { transport, retries } = await start(await device(), 'granted', ({ transport }) => transport.answer('unauthorized'));

  expect(transport.requests).toEqual([]);
  expect(retries.pending).toEqual([]);
});

test('meldet einen geänderten Erlaubnisstatus beim Vordergrund nach, mit dem bekannten Token', async () => {
  const { port, notifications, transport } = await start(await device(), 'granted');

  // Die Person entzieht die Erlaubnis in den System-Einstellungen; im Vordergrund liest die App sie neu.
  port.setPermission('denied');
  await notifications.refresh();
  await flush();

  expect(transport.requests).toEqual([registered('granted'), registered('denied')]);
  expect(port.calls().filter((call) => call === 'expoPushToken')).toHaveLength(1);
});

test('ein Vordergrund ohne geänderte Erlaubnis meldet nichts', async () => {
  const { notifications, transport } = await start(await device(), 'granted');

  await notifications.refresh();
  await flush();

  expect(transport.requests).toEqual([registered('granted')]);
});

test('meldet beim Start nach, wenn die Erlaubnis bei geschlossener App entzogen wurde', async () => {
  const database = await device();
  (await start(database, 'granted')).stop();

  const restarted = await start(database, 'denied');

  expect(restarted.transport.requests).toEqual([registered('denied')]);
});

test('erteilt die Person die Erlaubnis wieder, registriert sie mit frischem Token', async () => {
  const database = await device();
  const { port, notifications, transport } = await start(database, 'granted');
  port.setPermission('denied');
  await notifications.refresh();
  await flush();

  port.setPermission('granted');
  await notifications.refresh();
  await flush();

  expect(transport.requests).toEqual([registered('granted'), registered('denied'), registered('granted')]);
  expect(port.calls().filter((call) => call === 'expoPushToken')).toHaveLength(2);
});

test('nach dem Beenden plant und meldet sie nichts mehr', async () => {
  const { port, notifications, transport, retries, stop } = await start(await device(), 'granted', ({ transport }) => transport.answer('failed'));
  stop();

  expect(retries.pending).toEqual([]);
  port.setPermission('denied');
  await notifications.refresh();
  await flush();
  expect(transport.requests).toEqual([]);
});

test('wartet beim Start, bis die Erlaubnis gelesen ist, und registriert dann trotz unveränderter Erlaubnis', async () => {
  const database = await device();
  (await start(database, 'granted')).stop();
  let release: () => void = () => {};
  const permissionRead = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Das Mitteilungs-Modul kennt die Erlaubnis erst, wenn das System antwortet.
  const restarted = await start(database, 'granted', undefined, {
    wrap: (port) => ({ ...port, permission: async () => (await permissionRead, port.permission()) }),
  });
  expect(restarted.transport.requests).toEqual([]);

  release();
  await flush();

  expect(restarted.transport.requests).toEqual([registered('granted')]);
});
