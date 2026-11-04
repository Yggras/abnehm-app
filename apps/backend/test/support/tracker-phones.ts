import { randomUUID } from 'node:crypto';

import { createTestClock, type ClockStart } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';

import {
  createDailyGoalPersistence,
  createDailyGoalRegistry,
  createDaysChangedDispatcher,
  dailyGoalCompletionEntity,
  type DaysChanged,
} from '../../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../../mobile/src/energy/index.ts';
import type { LocalDatabase } from '../../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../../mobile/src/local-db/local-databases.ts';
import { createBetterSqliteFiles } from '../../../mobile/src/local-db/testing/better-sqlite.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../../../mobile/src/sync/index.ts';
import { createTrackers, sportEntryEntity, waterEntryEntity, weightEntryEntity, type Trackers } from '../../../mobile/src/trackers/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './auth-client.ts';
import { personWithSession } from './authorization.ts';

// Zwei Installationen derselben Person gegen die echte Hono-App, so zusammengesetzt wie im Composition
// Root: Sync, Persistenzdienst und Tracker-Modul (#171, #173, #175). App-Code läuft auf echtem SQLite
// (better-sqlite3), der HTTP-Transport über `app.request`.

export type TrackerPhone = Readonly<{
  database: LocalDatabase;
  trackers: Trackers;
  sync: () => ReturnType<ReturnType<typeof createSyncEngine>['sync']>;
  /** Signale `onDaysChanged` des Persistenzdiensts, etwa nach einer Pull-Übernahme. */
  signals: DaysChanged[];
}>;

async function trackerPhone(backend: TestBackend, accountId: string, device: Device, start: ClockStart, cleanups: (() => void)[]): Promise<TrackerPhone> {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(start);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry([...foundationSyncEntities, dailyGoalCompletionEntity, energyBookingEntity, waterEntryEntity, weightEntryEntity, sportEntryEntity]);
  const writer = createSyncWriter({ registry, clock, newId });
  const signals: DaysChanged[] = [];
  const dispatcher = createDaysChangedDispatcher({ database, observers: [(signal) => void signals.push(signal)], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock, writer, dispatcher });
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId(), onCanonicalChanges: persistence.onCanonicalChanges });
  return { database, trackers: createTrackers({ database, clock, writer, persistence, newId }), sync: () => engine.sync(), signals };
}

/**
 * Anna mit zwei angemeldeten Geräten `a` und `b`, beide nach dem ersten Pull mit ihrer Person. Die
 * Datenbanken der Geräte löst `close` wieder.
 */
export async function sameAccountPhones(start: ClockStart) {
  const cleanups: (() => void)[] = [];
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
  const a = await trackerPhone(backend, anna.accountId, anna.device, start, cleanups);
  const b = await trackerPhone(backend, anna.accountId, second, start, cleanups);
  await a.sync();
  await b.sync();
  return {
    backend,
    anna,
    a,
    b,
    close: () => {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
