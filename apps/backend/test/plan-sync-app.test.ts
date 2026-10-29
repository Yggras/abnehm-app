import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { goalVersionId, weeklyPlanVersionId } from '@abnehm/contracts/plan';

import { fakeWeightRecorder } from '../../mobile/src/area-ports/testing/fakes.ts';
import {
  createDailyGoalPersistence,
  createDailyGoalRegistry,
  createDaysChangedDispatcher,
  dailyGoalCommands,
  dailyGoalCompletionEntity,
  type DaysChanged,
} from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { goalVersion as localGoalVersion } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createPlan, goalVersionEntity, planCommands, planReaderOf, weeklyPlanVersionEntity, type InitialPlanDraft } from '../../mobile/src/plan/index.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
} from '../../mobile/src/sync/index.ts';
import { goalVersion, person, weeklyPlanDay } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';

// Nachweis für #128: Erstplan speichern über das Plan-Modul der App, Push über die echte Hono-App nach
// Postgres und Pull auf eine zweite Installation derselben Person. Dort liest der `PlanReader` die
// Fassungen aus SQLite, und die Übernahme meldet die Tage bis heute + 13 mit `planaenderung`. App-Code
// läuft auf echtem SQLite (better-sqlite3), der HTTP-Transport über `app.request`.

/** Mittwoch, 14.10.2026, 12:00 in Berlin. */
const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const day = (value: string) => LocalDate.parse(value);
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const draft: InitialPlanDraft = {
  startWeightEntryId: EntityId.parse('1f3e5d7c-9b8a-4c6e-8f2d-1e3c5a7b9d01'),
  calculationSex: 'weiblich',
  birthDate: day('1991-03-02'),
  heightCm: 168,
  weightG: 80_000,
  activityLevel: 'wenig_aktiv',
  pregnantOrBreastfeeding: false,
  knownEatingDisorder: false,
  goalWeightG: 76_000,
  pace: 'entspannt',
  manualBudgetKcal: null,
  waterTargetMl: null,
  weeklySportTargetMinutes: null,
  sportDays: ['dienstag', 'donnerstag', 'samstag'],
  weighDay: 'montag',
};

/** Eine Installation, wie sie der Composition Root zusammensetzt: Sync, Persistenzdienst und Plan-Modul. */
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
  const registry = createSyncRegistry([...foundationSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity]);
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
  const commands = createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, ...dailyGoalCommands, ...planCommands] });
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId(), onCanonicalChanges: persistence.onCanonicalChanges, commands });
  const weightRecorder = fakeWeightRecorder((measuredAt) => createTestClock({ instant: measuredAt, timeZone: start.timeZone }).read().localDate);
  return {
    plan: createPlan({ database, clock, writer, persistence, weightRecorder, newId }),
    planReader: planReaderOf(database),
    sync: () => engine.sync(),
    signals,
    goals: () => database.read((tx) => sqliteOf(tx).select().from(localGoalVersion).all()),
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
  return { backend, anna, personId: EntityId.parse(anna.personId), a, b };
}

describe('Erstplan im Sync', () => {
  it('pusht Personenfelder und beide Fassungen; Postgres hält sie mit den IDs aus Person und valid_from', async () => {
    const { backend, personId, a } = await setup();

    await a.plan.saveInitialPlan(draft);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    expect(await backend.database.db.select().from(goalVersion)).toEqual([
      expect.objectContaining({ id: goalVersionId(personId, day('2026-10-14')), personId, validFrom: '2026-10-14', calorieBudgetMilliKcal: 1_620_000 }),
    ]);
    expect(await backend.database.db.select().from(weeklyPlanDay).where(eq(weeklyPlanDay.weeklyPlanVersionId, weeklyPlanVersionId(personId, day('2026-10-14')))))
      .toHaveLength(7);
    const [stored] = await backend.database.db.select().from(person).where(eq(person.id, personId));
    expect(stored).toMatchObject({ calculationSex: 'weiblich', birthDate: '1991-03-02', heightCm: 168, activityLevel: 'wenig_aktiv',
      pregnantOrBreastfeeding: false, knownEatingDisorder: false, onboardingStatus: 'begonnen' });
    // Die kanonische Antwort bestätigt die lokale Fassung.
    expect(a.goals()).toEqual([expect.objectContaining({ id: goalVersionId(personId, day('2026-10-14')), serverVersion: expect.any(String) })]);
  });

  it('kommt per Pull auf die zweite Installation: Der PlanReader dort liest sie, die Übernahme meldet heute bis heute + 13', async () => {
    const { personId, a, b } = await setup();
    await a.plan.saveInitialPlan(draft);
    await a.sync();

    await b.sync();

    await expect(b.planReader.effectivePlan(personId, day('2026-10-14'))).resolves.toMatchObject({
      type: 'gueltig',
      goal: { id: goalVersionId(personId, day('2026-10-14')), calorieBudgetMilliKcal: 1_620_000, waterTargetMl: 1_500 },
      weeklyPlanDay: { weeklyPlanVersionId: weeklyPlanVersionId(personId, day('2026-10-14')), bausteine: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'] },
    });
    await expect(b.planReader.effectivePlan(personId, day('2026-10-19'))).resolves.toMatchObject({ weeklyPlanDay: { bausteine: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] } });
    const planDays = Array.from({ length: 14 }, (_, index) => `2026-10-${String(14 + index).padStart(2, '0')}`);
    expect(b.signals).toContainEqual(expect.objectContaining({ personId, cause: 'planaenderung', localDates: planDays }));
  });
});
