import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { InstallationId } from '@abnehm/contracts/sync';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createNotifications } from '../../mobile/src/notifications/notifications.ts';
import { createPushInstallationTransport } from '../../mobile/src/notifications/push-installation-transport.ts';
import { startPushRegistration } from '../../mobile/src/notifications/push-registration.ts';
import { createFakeNotificationPort } from '../../mobile/src/test-capabilities/notifications.ts';
import { pushInstallation } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';

// Die Registrierung der Push-Installation aus der App (#139) gegen die echte Hono-App mit Postgres:
// Fake-Mitteilungs-Port, echte SQLite-Datei, HTTP-Transport über `app.request`.

const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${device.token ?? ''}`);
    headers.set('x-forwarded-for', device.ip);
    return backend.app.request(String(input), { ...init, headers });
  };
  const port = createFakeNotificationPort({ permission: 'undetermined', pushToken: 'ExponentPushToken[annas-pixel]' });
  const notifications = createNotifications({ port, onError: (error) => { throw error; } });
  const installationKey = InstallationId.parse(randomUUID());
  const stop = startPushRegistration({
    database,
    clock,
    notifications,
    port,
    transport: createPushInstallationTransport({ baseUrl: testBaseUrl, fetch }),
    installationKey,
    platform: 'android',
    retryAfter: () => () => {},
    onError: (error) => {
      throw error;
    },
  });
  cleanups.push(stop);
  return { port, notifications, installationKey };
}

it('nach erteilter Erlaubnis steht die Installation am Server; eine entzogene Erlaubnis wird nachgemeldet', async () => {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const { port, notifications, installationKey } = await phone(backend, anna.accountId, anna.device);
  const stored = async () => (await backend.database.db.select().from(pushInstallation).where(eq(pushInstallation.installationKey, installationKey)))[0];

  await notifications.request();
  await expect.poll(stored).toMatchObject({
    personId: anna.personId,
    platform: 'android',
    expoPushToken: 'ExponentPushToken[annas-pixel]',
    permissionStatus: 'erlaubt',
    active: true,
  });

  port.setPermission('denied');
  await notifications.refresh();
  await expect.poll(async () => (await stored())?.permissionStatus).toBe('verweigert');
});
