/**
 * @jest-environment node
 */
import { seedManifests, type SeedScenarioKey } from '@abnehm/contracts/seeds';

import { deviceClock } from '../../clock/device-clock';
import { createLocalDatabases } from '../../local-db/local-databases';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import type { AppSession } from '../../session/app-session';
import { createAppTestClock } from '../clock';
import { createFakeNotificationPort, createNotificationTestControl } from '../notifications';
import { runSeed } from './seed-flow';

// Nachweis für #125: Der Seed-Link stellt die Erlaubnis für Mitteilungen der Installation her. `solo`
// hat eine unentschiedene Erlaubnis (Spezifikation 5, Abschnitt 10); Szenarien ohne Angabe lassen den
// Mitteilungs-Port, wie er ist. Backend und Anmeldung sind hier Attrappen, die lokale Datenbank echt.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function seed(scenario: SeedScenarioKey) {
  const manifest = seedManifests[scenario];
  const account = manifest.accounts.find((candidate) => candidate.key === manifest.installations[0]!.account)!;
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const session = {
    baseUrl: 'https://backend.test',
    fetch: async () => new Response(null, { status: 204 }),
    auth: {
      signIn: async () => {
        await databases.open(account.accountId);
        return { type: 'signed_in', accountId: account.accountId };
      },
    },
    databases,
  } as unknown as AppSession;
  const notifications = createNotificationTestControl();
  const port = notifications.port(createFakeNotificationPort({ permission: 'granted' }));
  const outcome = await runSeed({ scenario, installation: null, target: { type: 'today' } }, { session, clock: createAppTestClock(deviceClock), notifications });
  return { outcome, notifications, port };
}

test('`solo` erhält eine unentschiedene Erlaubnis', async () => {
  expect(seedManifests.solo.installations.map((installation) => installation.notificationPermission)).toEqual(['undetermined']);

  const { outcome, notifications, port } = await seed('solo');

  expect(outcome.type).toBe('geseedet');
  expect(notifications.mode()).toEqual({ type: 'fake', permission: 'undetermined', answer: 'granted' });
  expect(await port.permission()).toBe('undetermined');
});

test('ein Szenario ohne Angabe lässt den Mitteilungs-Port beim System', async () => {
  expect(seedManifests.gekoppelt.installations.every((installation) => installation.notificationPermission === undefined)).toBe(true);

  const { outcome, notifications, port } = await seed('gekoppelt');

  expect(outcome.type).toBe('geseedet');
  expect(notifications.mode()).toEqual({ type: 'system' });
  expect(await port.permission()).toBe('granted');
});
