import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';
import { canonicalRows, seedIds, seedManifests, type SeedKey, type SeedManifest, type SeedState } from '@abnehm/contracts/seeds';
import { InstallationId } from '@abnehm/contracts/sync';

import { dailyGoalCompletionEntity } from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import { createIsland, type Island } from '../../mobile/src/island/island.ts';
import { sharedActionCommands, type IslandStage } from '../../mobile/src/island/role-choice.ts';
import type { LocalDatabase } from '../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { nutritionEntryEntity } from '../../mobile/src/nutrition/index.ts';
import { goalVersionEntity, weeklyPlanVersionEntity } from '../../mobile/src/plan/index.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
} from '../../mobile/src/sync/index.ts';
import { canonicalDevice, dumpLocalDatabase, seedLocalDatabase } from '../../mobile/src/test-capabilities/seed/local-seed.ts';
import { waterEntryEntity, weightEntryEntity } from '../../mobile/src/trackers/index.ts';
import { dumpServer, seedServer } from '../dev/seed/server-seed.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { signIn } from './support/auth-client.ts';

// Nachweis für #180: die Szenarien `solo-energie` und `rollenwahl-offen` (Spezifikation 4, Abschnitt 13)
// auf Postgres und den Geräten, deren Engine, Adapter und Spieldienst auf echtem SQLite (better-sqlite3)
// gegen die echte Hono-App laufen. Ausgangszustand exakt und wiederholbar, nach den benannten Schritten
// der Sollzustand; dazu zeigt der Spieldienst Laichkugel bzw. Rollenwahl, und die Rollenwahl lässt sich
// vom geseedeten Stand aus beantworten.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Alle Sync-Entitäten der App, wie im Composition Root (`src/session/device-session.ts`). */
const registry = createSyncRegistry([
  ...foundationSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity, waterEntryEntity, weightEntryEntity, nutritionEntryEntity,
]);

type Phone = Readonly<{ database: LocalDatabase; island: Island; stage(): IslandStage; sync(): Promise<void> }>;

async function phone(backend: TestBackend, manifest: SeedManifest, key: SeedKey): Promise<Phone> {
  const installation = manifest.installations.find((candidate) => candidate.key === key)!;
  const account = manifest.accounts.find((candidate) => candidate.key === installation.account)!;
  const { reply, device } = await signIn(backend, account.email, account.password);
  if (reply.status !== 200) throw new Error(`Anmeldung fehlgeschlagen: ${reply.status}`);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(account.accountId);
  seedLocalDatabase(database, manifest, key);
  const clock = createTestClock(manifest.clock);
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry, clock, newId });
  const engine = createSyncEngine({
    database,
    registry,
    transport: createHttpSyncTransport({
      baseUrl: testBaseUrl,
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${device.token ?? ''}`);
        headers.set('x-forwarded-for', device.ip);
        return backend.app.request(String(input), { ...init, headers });
      },
    }),
    clock,
    installationId: InstallationId.parse(installation.installationId),
    commands: createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, ...sharedActionCommands] }),
  });
  const island = createIsland({ database, writer, clock, newId });
  let stage: IslandStage | null = null;
  cleanups.push(island.observeStage((next) => (stage = next)));
  return {
    database,
    island,
    stage: () => stage!,
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
  };
}

type World = Readonly<{ backend: TestBackend; phones: Readonly<Record<SeedKey, Phone>> }>;

async function seeded(manifest: SeedManifest): Promise<World> {
  const backend = await createTestBackend({ clock: createTestClock(manifest.clock) });
  await seedServer(backend.database, manifest);
  const phones: Record<SeedKey, Phone> = {};
  for (const { key } of manifest.installations) phones[key] = await phone(backend, manifest, key);
  return { backend, phones };
}

async function stateOf({ backend, phones }: World): Promise<SeedState> {
  return {
    server: await dumpServer(backend.database.db),
    devices: Object.fromEntries(Object.entries(phones).map(([key, { database }]) => [key, dumpLocalDatabase(database)])),
  };
}

const canonical = (state: SeedState): SeedState => ({
  server: canonicalRows(state.server),
  devices: Object.fromEntries(Object.entries(state.devices).map(([key, device]) => [key, canonicalDevice(device)])),
});

async function runSyncSteps(manifest: SeedManifest, { phones }: World) {
  for (const step of manifest.steps) {
    if (step.type !== 'sync') throw new Error(`Unerwarteter Schritt ${step.type}`);
    await phones[step.installation]!.sync();
  }
}

describe.each(['solo-energie', 'rollenwahl-offen'] as const)('Szenario %s', (scenario) => {
  const manifest = seedManifests[scenario];

  it('stellt Postgres und die Geräte exakt her, wiederholbar; nach den benannten Schritten gilt der Sollzustand', async () => {
    const world = await seeded(manifest);
    expect(await stateOf(world)).toEqual(canonical(manifest.initial));

    await runSyncSteps(manifest, world);
    expect(await stateOf(world)).toEqual(canonical(manifest.target));

    await seedServer(world.backend.database, manifest);
    for (const [key, { database }] of Object.entries(world.phones)) seedLocalDatabase(database, manifest, key);
    expect(await stateOf(world)).toEqual(canonical(manifest.initial));
  });
});

describe('Spieldienst auf den geseedeten Geräten', () => {
  it('solo-energie: Momo wartet als Laichkugel, die zwei Energie aus den Tageszielen bleiben', async () => {
    const { phones } = await seeded(seedManifests['solo-energie']);
    expect(phones['philipp-iphone']!.stage()).toEqual({ type: 'laichkugel', energy: 2 });
  });

  it('rollenwahl-offen: Philipp sieht Annas Vorschlag, Anna „Vorschlag gesendet“; Philipp lehnt ab, und Anna sieht es nach dem Sync', async () => {
    const { phones } = await seeded(seedManifests['rollenwahl-offen']);
    const [philipp, anna] = [phones['philipp-iphone']!, phones['anna-android']!];
    const actionId = seedIds.sharedAction.annasRollenwahl;
    expect(philipp.stage()).toMatchObject({ type: 'rollenwahl', partnerDisplayName: 'Anna', proposal: { actionId, by: 'partner', proposerRole: 'natur' } });
    expect(anna.stage()).toMatchObject({ type: 'rollenwahl', partnerDisplayName: 'Philipp', proposal: { actionId, by: 'self' } });

    expect(philipp.island.declineRoles(EntityId.parse(actionId))).toBe('vorgemerkt');
    await philipp.sync();
    await anna.sync();

    expect(anna.stage()).toMatchObject({ type: 'rollenwahl', proposal: null });
  });
});
