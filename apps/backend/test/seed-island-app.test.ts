import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';
import { canonicalRows, seedIds, seedManifests, type SeedKey, type SeedManifest, type SeedState } from '@abnehm/contracts/seeds';
import { InstallationId } from '@abnehm/contracts/sync';

import { islandSyncEntities } from '../../mobile/src/island/island-entities.ts';
import { dailyGoalCompletionEntity } from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import { islandObjectCommands } from '../../mobile/src/island/object-commands.ts';
import { createGameService, type GameService } from '../../mobile/src/island/game-service.ts';
import type { IslandStage } from '../../mobile/src/island/role-choice.ts';
import { sharedActionCommands } from '../../mobile/src/island/shared-action-commands.ts';
import { quietGameDependencies } from '../../mobile/src/island/testing/quiet-game.ts';
import type { LocalDatabase } from '../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { mealPhotoEntity, nutritionEntryEntity, ownFoodEntity } from '../../mobile/src/nutrition/index.ts';
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
import { notificationSettingEntity } from '../../mobile/src/notifications/notification-setting-entity.ts';
import { encouragementEntity } from '../../mobile/src/partner/encouragement.ts';

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
  ...foundationSyncEntities, ...islandSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity, waterEntryEntity, weightEntryEntity, nutritionEntryEntity, mealPhotoEntity, ownFoodEntity, notificationSettingEntity, encouragementEntity,
]);

type Phone = Readonly<{ database: LocalDatabase; game: GameService; stage(): IslandStage; sync(): Promise<void> }>;

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
    commands: createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, ...sharedActionCommands, ...islandObjectCommands] }),
  });
  const game = createGameService({ database, writer, clock, newId, ...quietGameDependencies });
  let stage: IslandStage | null = null;
  cleanups.push(game.observeStage((next) => (stage = next)));
  return {
    database,
    game,
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

describe.each(['solo-energie', 'rollenwahl-offen', 'haelfte-voll'] as const)('Szenario %s', { timeout: 30_000 }, (scenario) => {
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

    expect(philipp.game.declineRoles(EntityId.parse(actionId))).toBe('vorgemerkt');
    await philipp.sync();
    await anna.sync();

    expect(anna.stage()).toMatchObject({ type: 'rollenwahl', proposal: null });
  });

  it('gekoppelt: Level 3, Philipp hat 23 Energie und seine Hälfte zu 53 %, Anna zu 46 % (#191)', { timeout: 30_000 }, async () => {
    const { phones } = await seeded(seedManifests.gekoppelt);
    expect(islandOf(phones['philipp-iphone']!)).toMatchObject({ energy: 23, halves: { level: 3, own: { halfPercent: 53 }, partner: { halfPercent: 46 }, waitingForPartner: false } });
    expect(islandOf(phones['philipp-iphone']!).objects).toHaveLength(20);
    expect(islandOf(phones['anna-android']!)).toMatchObject({ energy: 25, halves: { own: { halfPercent: 46 }, partner: { halfPercent: 53 } } });
  });

  it('haelfte-voll: Philipps Hälfte ist voll, Momo wartet auf Anna; Anna sieht nur die volle Partnerhälfte (#191)', { timeout: 30_000 }, async () => {
    const { phones } = await seeded(seedManifests['haelfte-voll']);
    expect(islandOf(phones['philipp-iphone']!)).toMatchObject({ energy: 17, halves: { level: 3, own: { halfPercent: 100, halfFull: true }, waitingForPartner: true } });
    expect(islandOf(phones['anna-android']!)).toMatchObject({ halves: { level: 3, partner: { halfFull: true }, waitingForPartner: false } });
  });

  it('doppelausgabe: Beide Geräte bauen offline mit derselben Energie; nach dem Sync stehen alle acht Bauten, und beide zeigen 0 Energie (#191)', { timeout: 30_000 }, async () => {
    const world = await seeded(seedManifests.doppelausgabe);
    const [iphone, ipad] = [world.phones['philipp-iphone']!, world.phones['philipp-ipad']!];
    // Offline sieht jedes Gerät nur die eigenen vier Laternen: 23 − 12 = 11.
    expect(islandOf(iphone)).toMatchObject({ energy: 11, halves: { own: { halfPercent: 100 } } });
    expect(islandOf(ipad)).toMatchObject({ energy: 11 });

    await runSyncSteps(seedManifests.doppelausgabe, world);

    for (const phone of [iphone, ipad]) {
      expect(islandOf(phone)).toMatchObject({ energy: 0, halves: { level: 3, own: { halfPercent: 100 } } });
      expect(islandOf(phone).objects).toHaveLength(20 + 8);
    }
  });
});

function islandOf(phone: Phone) {
  const stage = phone.stage();
  if (stage.type !== 'geschluepft' || stage.island === null) throw new Error(`Nicht geschlüpft: ${JSON.stringify(stage)}`);
  return stage.island;
}
