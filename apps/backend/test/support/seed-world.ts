import { randomUUID } from 'node:crypto';

import { expect, onTestFinished } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, type AreaKey } from '@abnehm/contracts/base';
import type { PartnerSharingLevel } from '@abnehm/contracts/coupling';
import { canonicalRows, uncouplingRequestOf, withoutDerivedColumns, type SeedKey, type SeedManifest, type SeedState, type SeedStep } from '@abnehm/contracts/seeds';
import { InstallationId, PushResult, type OutboxOperation } from '@abnehm/contracts/sync';

import { islandEventCommands } from '../../../mobile/src/island/island-events.ts';
import { islandObjectCommands } from '../../../mobile/src/island/object-commands.ts';
import { islandSyncEntities } from '../../../mobile/src/island/island-entities.ts';
import { challengeSyncEntities } from '../../../mobile/src/island/challenges.ts';
import { createDailyGoalPersistence, createDaysChangedDispatcher, dailyGoalCommands, dailyGoalCompletionEntity } from '../../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../../mobile/src/energy/index.ts';
import type { LocalDatabase } from '../../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../../mobile/src/local-db/testing/better-sqlite.ts';
import { confirmPhotoDraftCommand, foodFavoriteEntity, intakeReaderOf, mealPhotoEntity, nutritionEntryEntity, ownFoodEntity } from '../../../mobile/src/nutrition/index.ts';
import { readPartnerCache } from '../../../mobile/src/partner-cache/index.ts';
import { budgetSuggestionEntity, createPlan, goalVersionEntity, planCommands, weeklyPlanVersionEntity } from '../../../mobile/src/plan/index.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
  setPartnerSharing,
  type PushNowResult,
} from '../../../mobile/src/sync/index.ts';
import { canonicalDevice, dumpLocalDatabase, seedLocalDatabase } from '../../../mobile/src/test-capabilities/seed/local-seed.ts';
import { createTrackers, sportEntryEntity, waterEntryEntity, weightEntryEntity } from '../../../mobile/src/trackers/index.ts';
import { seedPhotoFiles } from '../../dev/seed/photo-seed.ts';
import { dumpServer, seedServer } from '../../dev/seed/server-seed.ts';
import { processedOperation } from '../../src/db/schema/index.ts';
import { payloadHash } from '../../src/sync/sync.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './app.ts';
import { signIn, type Device } from './auth-client.ts';
import { seedDailyGoalRegistry } from '../../../mobile/src/daily-goals/testing/seed-evaluators.ts';
import { uncoupleAs } from './shared-actions.ts';
import { notificationSettingEntity } from '../../../mobile/src/notifications/notification-setting-entity.ts';
import { encouragementEntity } from '../../../mobile/src/partner/encouragement.ts';

// Seed-Welt für Integrationstests der Manifeste (#112, #113, #117): Postgres hinter der echten Hono-App
// und je Installation ein angemeldetes Gerät mit eigener SQLite-Datenbank (better-sqlite3), Sync-Engine
// und Persistenzdienst der Tagesziele (#105), wie im Composition Root (`src/session/device-session.ts`).
// Backend und Geräte laufen auf der Uhr des Manifests. Die Welt seedet nur den Ausgangszustand und führt
// die benannten Schritte des Manifests selbst aus; `stateOf` ergibt den kanonischen Gesamtzustand für
// den Vergleich mit `initial` oder `target`.

/** Alle Sync-Entitäten der App, wie im Composition Root. */
const registry = createSyncRegistry([
  ...foundationSyncEntities, ...islandSyncEntities, ...challengeSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, budgetSuggestionEntity, dailyGoalCompletionEntity, energyBookingEntity, waterEntryEntity, weightEntryEntity, sportEntryEntity, nutritionEntryEntity, mealPhotoEntity, ownFoodEntity, foodFavoriteEntity, notificationSettingEntity, encouragementEntity,
]);

export type SeedPhone = Readonly<{
  device: Device;
  personId: string;
  database: LocalDatabase;
  /** Push und Pull; übernommene Tage wertet der Persistenzdienst in derselben Transaktion aus. */
  sync(): Promise<void>;
  /** Genau ein Push-Batch ohne Pull (`pushNow`), etwa um einen Zwischenstand zu prüfen. */
  pushOnce(): Promise<PushNowResult>;
  /** Schritt `tagesziele_auswerten`; der Writer vergibt dabei genau die Operations-IDs des Schritts. */
  evaluate(step: Extract<SeedStep, { type: 'tagesziele_auswerten' }>): Promise<void>;
  /** Schritt `tagesziele_sicherstellen` über das Plan-Modul; der Writer vergibt genau die Operations-IDs des Schritts. */
  ensureDailyGoals(step: Extract<SeedStep, { type: 'tagesziele_sicherstellen' }>): Promise<void>;
  /** Schritt `budgetvorschlag_pruefen` über das Plan-Modul mit den echten Readern der Gerätedatenbank (#150). */
  checkBudgetSuggestion(step: Extract<SeedStep, { type: 'budgetvorschlag_pruefen' }>): Promise<void>;
  partner(): ReturnType<typeof readPartnerCache>;
  setSharing(area: AreaKey, level: PartnerSharingLevel): void;
  /** Alle gesendeten Operationen, in Reihenfolge; ein Retry sendet dieselbe noch einmal. */
  pushedOperations(): readonly OutboxOperation[];
  /** Alle Push-Ergebnisse, die das Gerät erhalten hat, in Reihenfolge. */
  pushResults(): readonly PushResult[];
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
  // Plan-Modul wie im Composition Root, für den Schritt `tagesziele_sicherstellen` (#131). Seinen Haken für
  // fehlende Tage meldet die Seed-Welt bewusst nicht an: Die Szenarien vor #131 beschreiben Pull und
  // Auswertung ohne Nachholen, und bis „Tagesziele auf dem Server“ (#133) lehnt der Server jede
  // Materialisierung ab. Den Haken belegt `apps/mobile/src/plan/daily-goals.test.ts`.
  const trackers = createTrackers({ database, clock, writer, persistence, newId });
  const plan = createPlan({ database, clock, writer, persistence, newId, weightRecorder: trackers.weightRecorder });
  const http = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const pushedOperations: OutboxOperation[] = [];
  const pushResults: PushResult[] = [];
  const transport: typeof http = {
    pull: (request) => http.pull(request),
    async push(request, options) {
      pushedOperations.push(...request.operations);
      const reply = await http.push(request, options);
      if (reply.type === 'ok') pushResults.push(...reply.body.results);
      return reply;
    },
  };
  const engine = createSyncEngine({
    database,
    registry,
    transport,
    clock,
    installationId: InstallationId.parse(installation.installationId),
    onCanonicalChanges: persistence.onCanonicalChanges,
    commands: createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, ...dailyGoalCommands, ...planCommands, ...islandObjectCommands, ...islandEventCommands, confirmPhotoDraftCommand({ persistence })] }),
  });
  return {
    device,
    personId: account.personId,
    database,
    // Die Frist liegt eine Minute nach der Uhr des Manifests; die Testuhr steht still.
    pushOnce: () => engine.pushNow({ deadline: Instant.parse(new Date(Date.parse(clock.read().instant) + 60_000).toISOString()) }),
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
      await dispatcher.deliver();
    },
    async evaluate(step) {
      operationIds.push(...step.operationIds);
      // Mit `at` wertet das Gerät zu dieser Uhrzeit aus; danach steht es wieder auf der Uhr des Manifests.
      if (step.at !== undefined) clock.set(step.at);
      try {
        database.transaction((tx) => persistence.reevaluateDailyGoals(tx, EntityId.parse(account.personId), step.localDates, step.cause));
      } finally {
        clock.set(manifest.clock.instant);
      }
      const unused = operationIds.splice(0);
      expect(unused, 'Der Schritt legt weniger Fachbefehle an, als er Operations-IDs nennt').toEqual([]);
      await dispatcher.deliver();
    },
    async ensureDailyGoals(step) {
      operationIds.push(...step.operationIds);
      if (step.at !== undefined) clock.set(step.at);
      if (step.timeZone !== undefined) clock.setTimeZone(step.timeZone);
      try {
        plan.ensureDailyGoals();
      } finally {
        clock.set(manifest.clock.instant);
        clock.setTimeZone(manifest.clock.timeZone);
      }
      const unused = operationIds.splice(0);
      expect(unused, 'Der Schritt legt weniger Fachbefehle an, als er Operations-IDs nennt').toEqual([]);
      await dispatcher.deliver();
    },
    async checkBudgetSuggestion(step) {
      operationIds.push(...step.operationIds);
      // Gewichtstrend und Tagesaufnahme über die echten Ports wie im Composition Root.
      await plan.checkBudgetSuggestion({ weightTrendReader: trackers.weightTrendReader, intakeReader: intakeReaderOf(database) });
      const unused = operationIds.splice(0);
      expect(unused, 'Der Schritt legt weniger Operationen an, als er Operations-IDs nennt').toEqual([]);
    },
    partner: () => database.read((tx) => readPartnerCache(tx)),
    setSharing: (area, level) => database.transaction((tx) => setPartnerSharing(tx, writer, { area, level }, Instant.parse(clock.read().instant))),
    pushedOperations: () => [...pushedOperations],
    pushResults: () => [...pushResults],
  };
}

export type SeedWorld = Readonly<{ backend: TestBackend; manifest: SeedManifest; phones: Readonly<Record<SeedKey, SeedPhone>> }>;

/** Seedet Postgres und die Geräte aller Installationen; die Uhr des Backends steht auf der des Manifests. */
export async function seeded(manifest: SeedManifest): Promise<SeedWorld> {
  const backend = await createTestBackend({ clock: createTestClock(manifest.clock) });
  await seedServer(backend.database, manifest, backend.inviteCodes);
  await seedPhotoFiles(backend.photoStorage, manifest);
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
      case 'tagesziele_sicherstellen':
        await phones[step.installation]!.ensureDailyGoals(step);
        break;
      case 'budgetvorschlag_pruefen':
        await phones[step.installation]!.checkBudgetSuggestion(step);
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
  await seedServer(backend.database, manifest, backend.inviteCodes);
  await seedPhotoFiles(backend.photoStorage, manifest);
  for (const [key, { database }] of Object.entries(phones)) seedLocalDatabase(database, manifest, key);
}

/**
 * Kanonischer Gesamtzustand: Postgres ohne Better-Auth-Tabellen, Sicherheitslog und Projektions-Invalidierungen, je Installation SQLite.
 * Wie im Manifest fehlen die abgeleiteten Spalten verarbeiteter Operationen; sie prüft `expectProcessedOperations`.
 */
export async function stateOf({ backend, phones }: SeedWorld): Promise<SeedState> {
  return {
    server: withoutDerivedColumns(await dumpServer(backend.database.db)),
    devices: Object.fromEntries(Object.entries(phones).map(([key, { database }]) => [key, dumpLocalDatabase(database)])),
  };
}

/** Ein Zustand des Manifests in der kanonischen Form von `stateOf`. */
export function canonical(state: SeedState): SeedState {
  return { server: withoutDerivedColumns(canonicalRows(state.server)), devices: Object.fromEntries(Object.entries(state.devices).map(([key, device]) => [key, canonicalDevice(device)])) };
}

/**
 * Prüft die abgeleiteten Spalten der verarbeiteten Operationen semantisch (`derivedColumns`, #116):
 *
 * - `request_hash` ist der Hash der Operation, wie ein Gerät sie gesendet hat.
 * - Bei einer Entitätsoperation ist `payload_hash` gleich `request_hash`. Ein Fachbefehl hat einen eigenen
 *   Fach-Hash; sein Duplikat (`already_applied` ohne fachlichen Schlüssel) trägt den eines angenommenen
 *   Befehls derselben Art und Person, wie der Server ihn beim Abgleich findet.
 * - `result` ist ein gültiges Push-Ergebnis dieser Operation mit dem gespeicherten Ausgang, genau das, was
 *   das Gerät erhalten hat. Ein Retry derselben Operation erhielte `already_applied`; die Szenarien wiederholen keine.
 */
export async function expectProcessedOperations({ backend, phones }: SeedWorld): Promise<void> {
  const sent = new Map<string, OutboxOperation>(Object.values(phones).flatMap((phone) => phone.pushedOperations()).map((operation) => [operation.operationId, operation]));
  const received = new Map<string, PushResult>(Object.values(phones).flatMap((phone) => phone.pushResults()).map((result) => [result.operationId, result]));
  const rows = await backend.database.db.select().from(processedOperation);
  for (const row of rows) {
    const operation = sent.get(row.operationId);
    expect(operation, `Operation ${row.operationId} hat kein Gerät gesendet`).toBeDefined();
    expect(row.requestHash).toBe(payloadHash(operation!));
    if (row.entityType !== null) {
      expect(row.payloadHash).toBe(row.requestHash);
    } else if (row.outcome === 'already_applied' && row.businessKey === null) {
      expect(rows.some((original) => original.outcome === 'applied' && original.personId === row.personId &&
        original.operationType === row.operationType && original.payloadHash === row.payloadHash)).toBe(true);
    } else {
      expect(row.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    }
    const result = PushResult.parse(row.result);
    expect({ type: result.type, operationId: result.operationId }).toEqual({ type: row.outcome, operationId: row.operationId });
    expect(received.get(row.operationId)).toEqual(result);
  }
}
