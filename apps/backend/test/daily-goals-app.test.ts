import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { dailyGoalKey } from '@abnehm/contracts/daily-goals';
import { dailyBonusKey } from '@abnehm/contracts/energy';

import {
  createDailyGoalPersistence,
  createDailyGoalRegistry,
  createDaysChangedDispatcher,
  dailyGoalCommands,
  dailyGoalCompletionEntity,
  type DaysChanged,
} from '../../mobile/src/daily-goals/index.ts';
import { insertDailyGoalForTest } from '../../mobile/src/daily-goals/testing/persisted.ts';
import { createTestFactsStore, testBausteinEvaluators, testCheckInEvaluators, type TestDayFacts } from '../../mobile/src/daily-goals/testing/test-evaluators.ts';
import { bookingByKey, energyBookingEntity, readEnergy } from '../../mobile/src/energy/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { dailyGoalCompletion as localCompletion, outbox } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationSyncEntities,
  type SyncTransport,
} from '../../mobile/src/sync/index.ts';
import { dailyGoalCompletion, energyBooking } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { insertDailyGoals, snapshotOf, type ServerDailyGoal } from './support/daily-goals.ts';

// Tracer Bullet für #105: Der Persistenzdienst der App erfüllt ein Tagesziel offline, der Fachbefehl
// geht über die echte Hono-App, und erzeugt ein zweites Gerät offline dieselbe Erfüllung, existiert
// die Gutschrift nach dem Sync trotzdem genau einmal. Engine, Outbox, Persistenzdienst und Dispatcher
// laufen auf echtem SQLite (better-sqlite3), der Server auf Postgres.

const berlin = TimeZone.parse('Europe/Berlin');
const today = LocalDate.parse('2026-10-14');
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Eine Installation samt Persistenzdienst, Dispatcher und Sync, wie sie der Composition Root zusammensetzt. */
async function phone(backend: TestBackend, accountId: string, device: Device, startsAt: string) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock({ instant: Instant.parse(startsAt), timeZone: berlin });
  const facts = createTestFactsStore();
  const registry = createSyncRegistry([...foundationSyncEntities, dailyGoalCompletionEntity, energyBookingEntity]);
  const writer = createSyncWriter({ registry, clock, newId: () => EntityId.parse(randomUUID()) });
  const signals: DaysChanged[] = [];
  const dispatcher = createDaysChangedDispatcher({ database, observers: [(signal) => void signals.push(signal)], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({
    registry: createDailyGoalRegistry({ bausteine: Object.values(testBausteinEvaluators(facts.read)), checkIns: Object.values(testCheckInEvaluators(facts.read)) }),
    clock,
    writer,
    dispatcher,
  });
  const network = { dropNextPushResponse: false };
  const http = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const transport: SyncTransport = {
    pull: (request) => http.pull(request),
    async push(request) {
      const reply = await http.push(request);
      if (!network.dropNextPushResponse) return reply;
      // Der Server hat verarbeitet, die Antwort geht unterwegs verloren.
      network.dropNextPushResponse = false;
      return { type: 'unavailable' };
    },
  };
  const engine = createSyncEngine({
    database,
    registry,
    transport,
    clock,
    installationId: EntityId.parse(randomUUID()),
    onCanonicalChanges: persistence.onCanonicalChanges,
    commands: createLocalCommandRegistry({ database, writer, commands: dailyGoalCommands }),
  });
  let personId: EntityId | null = null;
  return {
    database,
    network,
    signals,
    sync: async () => {
      const result = await engine.sync();
      await dispatcher.deliver();
      return result;
    },
    /** Dieselben Tagesziele wie auf dem Server, wie sie `materializeDailyGoals` (Spezifikation 1) brächte. */
    materialize(goals: readonly ServerDailyGoal[]) {
      personId = goals[0]!.personId;
      const dayEndsAt = new Date('2026-10-14T22:00:00.000Z');
      database.transaction((tx) => goals.forEach((goal) => insertDailyGoalForTest(tx, goal.id, snapshotOf(goal, dayEndsAt))));
    },
    /** Eine Eingabe auf „Heute“: Fakten ändern, Tag melden. */
    enter(next: Partial<TestDayFacts>) {
      facts.set(personId!, today, next);
      database.transaction((tx) => persistence.reevaluateDailyGoals(tx, personId!, [today], 'eingabe'));
    },
    completions: () => database.read((tx) => sqliteOf(tx).select().from(localCompletion).all()),
    outbox: () => database.read((tx) => sqliteOf(tx).select().from(outbox).all()),
    booking: (key: string) => database.read((tx) => bookingByKey(tx, key)),
    energy: () => database.read((tx) => readEnergy(tx, personId!)),
  };
}

async function setup() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
  const goals = await insertDailyGoals(backend, anna.personId, today);
  const a = await phone(backend, anna.accountId, anna.device, '2026-10-14T10:00:00.000Z');
  const b = await phone(backend, anna.accountId, second, '2026-10-14T10:05:00.000Z');
  // Erster Pull: Die Person kommt auf beide Geräte.
  await a.sync();
  await b.sync();
  a.materialize(goals);
  b.materialize(goals);
  const server = async () => ({
    completions: await backend.database.db.select().from(dailyGoalCompletion),
    bookings: await backend.database.db.select().from(energyBooking),
  });
  return { backend, anna, goals, a, b, server };
}

describe('Tagesziele über App und Backend', () => {
  it('zwei Offline-Geräte und Retry: genau eine Gutschrift; das zweite Gerät ersetzt sein Duplikat und erkennt sie am Schlüssel', async () => {
    const { anna, a, b, server } = await setup();
    a.enter({ countedMl: 1500 });
    b.enter({ countedMl: 1500 });
    expect(a.completions()).toHaveLength(1);
    expect(b.completions()).toHaveLength(1);

    await a.sync();
    b.network.dropNextPushResponse = true;
    expect((await b.sync()).push).toBe('unavailable');
    expect(b.outbox()).toHaveLength(1);
    await b.sync();

    const key = dailyGoalKey(EntityId.parse(anna.personId), today, 2);
    const { completions, bookings } = await server();
    expect(completions).toHaveLength(1);
    expect(bookings).toEqual([expect.objectContaining({ bookingKey: key, amount: 1 })]);
    // Der zuerst angenommene Erfüllungszeitpunkt gilt überall.
    expect(b.completions()).toEqual([expect.objectContaining({ completionKey: key, firstCompletedAt: '2026-10-14T10:00:00.000Z', serverVersion: expect.any(String) })]);
    expect(b.booking(key)).toEqual(a.booking(key));
    expect(b.booking(key)).toMatchObject({ bookingKey: key, amount: 1 });
    expect(b.outbox()).toEqual([]);
    expect(b.energy()).toEqual({ balance: 1, levelHalf: 0 });
    expect(a.energy()).toEqual({ balance: 1, levelHalf: 0 });
  });

  it('nach dem Pull fehlender Erfüllungen gewährt jedes Gerät den Bonus, der Server bucht ihn genau einmal', async () => {
    const { anna, a, b, server } = await setup();
    a.enter({ weightEntryCount: 1 });
    b.enter({ countedMl: 1500, sessionMinutes: [30] });
    await a.sync();
    await b.sync();
    // A kennt jetzt alle drei Erfüllungen erst durch den Pull; der Pull-Haken wertet den Tag aus.
    await a.sync();
    await b.sync();
    await a.sync();

    const bonusKey = dailyBonusKey(EntityId.parse(anna.personId), today);
    const { completions, bookings } = await server();
    expect(completions).toHaveLength(3);
    expect(bookings.filter((booking) => booking.bookingKey === bonusKey)).toHaveLength(1);
    for (const device of [a, b]) {
      expect(device.booking(bonusKey)).toMatchObject({ type: 'daily_bonus_credit', amount: 1 });
      expect(device.energy()).toEqual({ balance: 4, levelHalf: 0 });
      expect(device.outbox()).toEqual([]);
    }
    expect(a.signals).toContainEqual({ personId: anna.personId, localDates: [today], cause: 'pull' });
  });
});
