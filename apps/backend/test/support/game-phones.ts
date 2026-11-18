import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, expect } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import { MomoCharacterState } from '@abnehm/contracts/today';
import { WirContributionsState, type WirContribution } from '@abnehm/contracts/wir';

import { dailyGoalCompletionEntity } from '../../../mobile/src/daily-goals/index.ts';
import { insertDailyGoalForTest } from '../../../mobile/src/daily-goals/testing/persisted.ts';
import { energyBookingEntity } from '../../../mobile/src/energy/index.ts';
import { islandObjectCommands } from '../../../mobile/src/island/object-commands.ts';
import { createGameService, type GameService } from '../../../mobile/src/island/game-service.ts';
import { islandSyncEntities } from '../../../mobile/src/island/island-entities.ts';
import type { IslandStage } from '../../../mobile/src/island/role-choice.ts';
import { sharedActionCommands } from '../../../mobile/src/island/shared-action-commands.ts';
import { quietGameDependencies } from '../../../mobile/src/island/testing/quiet-game.ts';
import { createLocalDatabases } from '../../../mobile/src/local-db/local-databases.ts';
import { islandField, sharedAction as localAction } from '../../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../../mobile/src/local-db/testing/better-sqlite.ts';
import type { TodayState } from '../../../mobile/src/shell/today-registry.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
} from '../../../mobile/src/sync/index.ts';
import { pendingOperations } from '../../../mobile/src/sync/outbox.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { personWithSession } from './authorization.ts';
import { worldStart } from './coupled-world.ts';
import { earnEnergy } from './building.ts';
import { coupleByInvitation } from './coupled-world.ts';
import { snapshotOf, type ServerDailyGoal } from './daily-goals.ts';

// Geräte mit dem Spieldienst der App (#180, #184, #191): Engine, Outbox und Adapter auf echtem SQLite
// (better-sqlite3) gegen die echte Hono-App mit Postgres, wie im Composition Root
// (`src/session/device-session.ts`) mit den Inselinhalten, Erfüllungen und Buchungen im Sync. „Heute“ und
// „Wir“ folgen den lokalen Daten.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

export type GamePhone = Awaited<ReturnType<typeof gamePhone>>;

export async function gamePhone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(worldStart);
  const newId = () => EntityId.parse(randomUUID());
  // Erfüllungen und Buchungen bringen die Energie fürs Bauen (#191).
  const registry = createSyncRegistry([...foundationSyncEntities, ...islandSyncEntities, dailyGoalCompletionEntity, energyBookingEntity]);
  const writer = createSyncWriter({ registry, clock, newId });
  let online = true;
  let dropNextPushResponse = false;
  const engine = createSyncEngine({
    database,
    registry,
    transport: createHttpSyncTransport({
      baseUrl: testBaseUrl,
      fetch: async (input, init) => {
        if (!online) throw new TypeError('Netzwerk nicht erreichbar');
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${device.token ?? ''}`);
        headers.set('x-forwarded-for', device.ip);
        const response = await backend.app.request(String(input), { ...init, headers });
        // Der Server hat verarbeitet, die Antwort geht unterwegs verloren.
        if (dropNextPushResponse && String(input).endsWith('/v1/sync/push')) {
          dropNextPushResponse = false;
          throw new TypeError('Antwort verloren');
        }
        return response;
      },
    }),
    clock,
    installationId: newId(),
    commands: createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, ...sharedActionCommands, ...islandObjectCommands] }),
  });
  const game: GameService = createGameService({ database, writer, clock, newId, ...quietGameDependencies });
  const latest = <T,>(subscribe: (listener: (value: T) => void) => () => void) => {
    let value: T | undefined;
    cleanups.push(subscribe((next) => (value = next)));
    return () => value as T;
  };
  return {
    game,
    database,
    clock,
    stage: latest<IslandStage>((listener) => game.observeStage(listener)),
    character: latest<TodayState<'momo.character'>>((listener) => game.momoCharacter.subscribe((state) => listener(MomoCharacterState.parse(state)))),
    wir: latest<ContributionState<WirContribution[]>>((listener) => game.wirContributions.subscribe((state) => listener(WirContributionsState.parse(state)))),
    offline: () => (online = false),
    online: () => (online = true),
    /**
     * Dieselben Tagesziele wie auf dem Server, wie sie `materializeDailyGoals` (Spezifikation 1) brächte;
     * ihre Erfüllungen und Gutschriften kommen dann per Pull.
     */
    materialize(goals: readonly ServerDailyGoal[]) {
      const dayEnd = (localDate: string) => new Date(Date.parse(`${localDate}T00:00:00.000Z`) + 22 * 3_600_000);
      database.transaction((tx) => goals.forEach((goal) => insertDailyGoalForTest(tx, goal.id, snapshotOf(goal, dayEnd(goal.localDate)))));
    },
    /** Der nächste Push erreicht den Server, seine Antwort aber nicht das Gerät. */
    dropNextPushResponse: () => (dropNextPushResponse = true),
    /** Ein Sync, dessen Push vorübergehend scheitert. */
    async syncWithFailedPush() {
      expect(await engine.sync()).toMatchObject({ push: 'unavailable' });
    },
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
    outbox: () => database.read((tx) => pendingOperations(tx, 100)),
    openRoleChoices: () =>
      database.read((tx) => sqliteOf(tx).select().from(localAction).all().filter((row) => row.kind === 'rollenwahl' && row.status === 'offen')),
  };
}

/** Der offene Vorschlag, den ein Gerät gerade zeigt. */
export function proposalOn(phone: GamePhone) {
  const stage = phone.stage();
  if (stage.type !== 'rollenwahl' || stage.proposal === null) throw new Error(`Kein offener Vorschlag: ${JSON.stringify(stage)}`);
  return stage.proposal;
}

/** Philipp und Anna mit je einem Gerät, noch ungekoppelt und auf dem Stand des Servers. */
export async function gamePhones() {
  const backend = await createTestBackend({ clock: createTestClock(worldStart) });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philippsPhone = await gamePhone(backend, philipp.accountId, philipp.device);
  const annasPhone = await gamePhone(backend, anna.accountId, anna.device);
  await philippsPhone.sync();
  await annasPhone.sync();
  return { backend, philipp, anna, philippsPhone, annasPhone };
}

/** Anna hat Natur vorgeschlagen, Philipp hat angenommen: Momo ist geschlüpft, beide Geräte sind auf dem Stand. */
export async function hatchedPhones() {
  const world = await gamePhones();
  await coupleByInvitation(world.backend, world.philipp.device, world.anna.device);
  await world.annasPhone.sync();
  world.annasPhone.game.proposeRoles('natur');
  await world.annasPhone.sync();
  await world.philippsPhone.sync();
  world.philippsPhone.game.acceptRoles(proposalOn(world.philippsPhone).actionId);
  await world.philippsPhone.sync();
  await world.annasPhone.sync();
  return world;
}

/** Philipp verdient auf dem Server Energie; seine Geräte kennen die Tagesziele und holen die Gutschriften. */
export async function energize(world: Awaited<ReturnType<typeof gamePhones>>, localDates: readonly string[], phones: readonly GamePhone[] = [world.philippsPhone]) {
  const goals = await earnEnergy(world.backend, world.philipp, localDates);
  for (const phone of phones) {
    phone.materialize(goals);
    await phone.sync();
  }
}

export function islandOf(phone: GamePhone) {
  const stage = phone.stage();
  if (stage.type !== 'geschluepft' || stage.island === null) throw new Error(`Nicht geschlüpft: ${JSON.stringify(stage)}`);
  return stage.island;
}

export const fieldOn = (phone: GamePhone, key: string) =>
  EntityId.parse(phone.database.read((tx) => sqliteOf(tx).select().from(islandField).where(eq(islandField.fieldKey, key)).get())!.id);
