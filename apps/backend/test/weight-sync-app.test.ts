import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';

import {
  createDailyGoalPersistence,
  createDailyGoalRegistry,
  createDaysChangedDispatcher,
  dailyGoalCompletionEntity,
  type DaysChanged,
} from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { weightEntry as localWeightEntry } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { createTrackers, waterEntryEntity, weightEntryEntity } from '../../mobile/src/trackers/index.ts';
import { changeLog, weightEntry } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { push, upsertOp } from './support/sync.ts';

// Nachweis für #175: Der Gewichtseintrag ist in der Entitäts-Registry beider Seiten angemeldet. Ein
// Eintrag über das Tracker-Modul der App geht über die echte Hono-App nach Postgres und kommt per Pull
// auf einem zweiten Gerät derselben Person an, ebenso die Löschung durch „Rückgängig“. Der Schreib-Port
// `WeightRecorder` erzeugt auch nach zwei Aufrufen genau einen Eintrag auf beiden Geräten.

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const morning = Instant.parse('2026-10-14T05:30:00.000Z');
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Eine Installation, wie sie der Composition Root zusammensetzt: Sync, Persistenzdienst und Tracker-Modul. */
async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(start);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry([...foundationSyncEntities, dailyGoalCompletionEntity, energyBookingEntity, waterEntryEntity, weightEntryEntity]);
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
  return {
    trackers: createTrackers({ database, clock, writer, persistence, newId }),
    sync: () => engine.sync(),
    signals,
    rows: () => database.read((tx) => sqliteOf(tx).select().from(localWeightEntry).all()),
  };
}

async function setup() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
  const a = await phone(backend, anna.accountId, anna.device);
  const b = await phone(backend, anna.accountId, second);
  // Erster Pull: Die Person kommt auf beide Geräte.
  await a.sync();
  await b.sync();
  return { backend, anna, a, b };
}

const payload = { weightG: 82_400, origin: 'manuell', measuredAt: morning, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 };

describe('Gewichtseintrag im Sync', () => {
  it('pusht einen Eintrag, pullt ihn auf dem zweiten Gerät und dort auch die Löschung durch „Rückgängig“', async () => {
    const { backend, anna, a, b } = await setup();

    const { undoToken } = a.trackers.recordWeight({ weightG: 82_400, measuredAt: morning });
    const [local] = a.rows();
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    const [stored] = await backend.database.db.select().from(weightEntry).where(eq(weightEntry.id, local!.id));
    expect(stored).toMatchObject({
      personId: anna.personId, weightG: 82_400, origin: 'manuell', externalKey: null, hiddenAt: null,
      localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, deletedAt: null,
    });
    expect(stored!.measuredAt.toISOString()).toBe(morning);
    expect(await backend.database.db.select().from(changeLog).where(eq(changeLog.entityId, local!.id))).toMatchObject([{ entityType: 'weight_entry', operation: 'upsert' }]);

    await b.sync();
    expect(b.rows()).toEqual([
      expect.objectContaining({ id: local!.id, weightG: 82_400, measuredAt: morning, localDate: '2026-10-14', deletedAt: null, serverVersion: stored!.serverVersion.toString() }),
    ]);
    // Die Pull-Übernahme meldet den Tag des Eintrags an den Persistenzdienst des zweiten Geräts.
    expect(b.signals).toContainEqual(expect.objectContaining({ personId: anna.personId, localDates: ['2026-10-14'], cause: 'pull' }));

    expect(a.trackers.undo(undoToken)).toEqual({ type: 'undone' });
    await a.sync();
    await b.sync();

    const [tombstone] = await backend.database.db.select().from(weightEntry).where(eq(weightEntry.id, local!.id));
    expect(tombstone!.deletedAt).not.toBeNull();
    expect(b.rows()).toEqual([expect.objectContaining({ id: local!.id, deletedAt: tombstone!.deletedAt!.toISOString() })]);
  });

  it('WeightRecorder: zwei Aufrufe mit derselben entryId ergeben auf Server und zweitem Gerät genau einen Eintrag', async () => {
    const { backend, anna, a, b } = await setup();
    const entryId = EntityId.parse(randomUUID());

    await a.trackers.weightRecorder.recordManualWeight({ entryId, personId: anna.personId, weightG: 92_000, measuredAt: morning });
    await a.sync();
    await a.trackers.weightRecorder.recordManualWeight({ entryId, personId: anna.personId, weightG: 91_800, measuredAt: morning });
    await a.sync();
    await b.sync();

    expect(await backend.database.db.select().from(weightEntry)).toEqual([expect.objectContaining({ id: entryId, weightG: 91_800 })]);
    expect(b.rows()).toEqual([expect.objectContaining({ id: entryId, weightG: 91_800, deletedAt: null })]);
  });

  it.each([
    ['über 350 kg', { weightG: 350_100 }],
    ['nicht in 100-g-Schritten', { weightG: 82_437 }],
    ['importierte Herkunft', { origin: 'apple_health' }],
  ])('lehnt eine Nutzlast %s dauerhaft ab, ohne etwas zu speichern', async (_, change) => {
    const { backend, anna } = await setup();

    const [result] = await push(backend, anna.device, [upsertOp(randomUUID(), { ...payload, ...change }, { entityType: 'weight_entry' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await backend.database.db.select().from(weightEntry)).toEqual([]);
  });
});
