import { randomUUID } from 'node:crypto';

import { expect, onTestFinished } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, type AreaKey } from '@abnehm/contracts/base';
import type { PartnerSharingLevel } from '@abnehm/contracts/coupling';
import { canonicalRows, uncouplingRequestOf, type SeedKey, type SeedManifest, type SeedState, type SeedStep } from '@abnehm/contracts/seeds';
import { InstallationId } from '@abnehm/contracts/sync';

import { createDailyGoalPersistence, createDaysChangedDispatcher, dailyGoalCommands, dailyGoalCompletionEntity } from '../../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../../mobile/src/energy/index.ts';
import type { LocalDatabase } from '../../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../../mobile/src/local-db/testing/better-sqlite.ts';
import { nutritionEntryEntity } from '../../../mobile/src/nutrition/index.ts';
import { readPartnerCache } from '../../../mobile/src/partner-cache/index.ts';
import { goalVersionEntity, planCommands, weeklyPlanVersionEntity } from '../../../mobile/src/plan/index.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
  setPartnerSharing,
} from '../../../mobile/src/sync/index.ts';
import { canonicalDevice, dumpLocalDatabase, seedLocalDatabase } from '../../../mobile/src/test-capabilities/seed/local-seed.ts';
import { waterEntryEntity, weightEntryEntity } from '../../../mobile/src/trackers/index.ts';
import { dumpServer, seedServer } from '../../dev/seed/server-seed.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './app.ts';
import { signIn, type Device } from './auth-client.ts';
import { seedDailyGoalRegistry } from './seed-evaluators.ts';
import { uncoupleAs } from './shared-actions.ts';

// Seed-Welt für Integrationstests der Manifeste (#112, #113, #117): Postgres hinter der echten Hono-App
// und je Installation ein angemeldetes Gerät mit eigener SQLite-Datenbank (better-sqlite3), Sync-Engine
// und Persistenzdienst der Tagesziele (#105), wie im Composition Root (`src/session/device-session.ts`).
// Backend und Geräte laufen auf der Uhr des Manifests. Die Welt seedet nur den Ausgangszustand und führt
// die benannten Schritte des Manifests selbst aus; `stateOf` ergibt den kanonischen Gesamtzustand für
// den Vergleich mit `initial` oder `target`.

/** Alle Sync-Entitäten der App, wie im Composition Root. */
const registry = createSyncRegistry([
  ...foundationSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity, waterEntryEntity, weightEntryEntity, nutritionEntryEntity,
]);

export type SeedPhone = Readonly<{
  device: Device;
  personId: string;
  database: LocalDatabase;
  /** Push und Pull; übernommene Tage wertet der Persistenzdienst in derselben Transaktion aus. */
  sync(): Promise<void>;
  /** Schritt `tagesziele_auswerten`; der Writer vergibt dabei genau die Operations-IDs des Schritts. */
  evaluate(step: Extract<SeedStep, { type: 'tagesziele_auswerten' }>): Promise<void>;
  partner(): ReturnType<typeof readPartnerCache>;
  setSharing(area: AreaKey, level: PartnerSharingLevel): void;
}>;

/** Ein angemeldetes Gerät einer Installation, die lokale Datenbank im Ausgangszustand des Manifests. */
export async function seedPhone(backend: TestBackend, manifest: SeedManifest, key: SeedKey): Promise<SeedPhone> {
  const installation = manifest.installations.find((candidate) => candidate.key === key)!;
  const account = manifest.accounts.find((candidate) => candidate.key === installation.account)!;
  const { reply, device } = await signIn(backend, account.email, account.password);
  if (reply.status !== 200) throw new Error(`Anmeldung fehlgeschlagen: ${reply.status}`);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  onTestFinished(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(account.accountId);
  seedLocalDatabase(database, manifest, key);
  const clock = createTestClock(manifest.clock);
  /** Operations-IDs des laufenden Schritts; außerhalb eines Schritts vergibt der Writer zufällige. */
  const operationIds: string[] = [];
  const newId = () => EntityId.parse(operationIds.shift() ?? randomUUID());
  const writer = createSyncWriter({ registry, clock, newId });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: seedDailyGoalRegistry(), clock, writer, dispatcher });
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({
    database,
    registry,
    transport,
    clock,
    installationId: InstallationId.parse(installation.installationId),
    onCanonicalChanges: persistence.onCanonicalChanges,
    commands: createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, ...dailyGoalCommands, ...planCommands] }),
  });
  return {
    device,
    personId: account.personId,
    database,
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
      await dispatcher.deliver();
    },
    async evaluate(step) {
      operationIds.push(...step.operationIds);
      database.transaction((tx) => persistence.reevaluateDailyGoals(tx, EntityId.parse(account.personId), step.localDates, step.cause));
      const unused = operationIds.splice(0);
      expect(unused, 'Der Schritt legt weniger Fachbefehle an, als er Operations-IDs nennt').toEqual([]);
      await dispatcher.deliver();
    },
    partner: () => database.read((tx) => readPartnerCache(tx)),
    setSharing: (area, level) => database.transaction((tx) => setPartnerSharing(tx, writer, { area, level }, Instant.parse(clock.read().instant))),
  };
}

export type SeedWorld = Readonly<{ backend: TestBackend; manifest: SeedManifest; phones: Readonly<Record<SeedKey, SeedPhone>> }>;

/** Seedet Postgres und die Geräte aller Installationen; die Uhr des Backends steht auf der des Manifests. */
export async function seeded(manifest: SeedManifest): Promise<SeedWorld> {
  const backend = await createTestBackend({ clock: createTestClock(manifest.clock) });
  await seedServer(backend.database, manifest);
  const phones: Record<SeedKey, SeedPhone> = {};
  for (const { key } of manifest.installations) phones[key] = await seedPhone(backend, manifest, key);
  return { backend, manifest, phones };
}

/** Führt die benannten Schritte des Manifests aus; `entkoppeln` über die Test-Harness des Kerns (#107). */
export async function runSteps({ backend, manifest, phones }: SeedWorld): Promise<void> {
  for (const step of manifest.steps) {
    switch (step.type) {
      case 'sync':
        await phones[step.installation]!.sync();
        break;
      case 'tagesziele_auswerten':
        await phones[step.installation]!.evaluate(step);
        break;
      case 'entkoppeln': {
        const { at, ...request } = uncouplingRequestOf(step, manifest.accounts);
        expect((await uncoupleAs(backend, { ...request, at: new Date(at) })).status).toBe('angenommen');
        break;
      }
    }
  }
}

/** Seedet Postgres und alle Geräte erneut, etwa nach Änderungen oder den Schritten. */
export async function reseed({ backend, manifest, phones }: SeedWorld): Promise<void> {
  await seedServer(backend.database, manifest);
  for (const [key, { database }] of Object.entries(phones)) seedLocalDatabase(database, manifest, key);
}

/** Kanonischer Gesamtzustand: Postgres ohne Better-Auth-Tabellen und Sicherheitslog, je Installation SQLite. */
export async function stateOf({ backend, phones }: SeedWorld): Promise<SeedState> {
  return {
    server: await dumpServer(backend.database.db),
    devices: Object.fromEntries(Object.entries(phones).map(([key, { database }]) => [key, dumpLocalDatabase(database)])),
  };
}

/** Ein Zustand des Manifests in der kanonischen Form von `stateOf`. */
export function canonical(state: SeedState): SeedState {
  return { server: canonicalRows(state.server), devices: Object.fromEntries(Object.entries(state.devices).map(([key, device]) => [key, canonicalDevice(device)])) };
}
