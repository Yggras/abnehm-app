/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { dailyGoalCompletionId, dailyGoalKey, planChangeDays, type DailyGoalCause, type DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import { dailyBonusKey, energyBookingId } from '@abnehm/contracts/energy';

import { bookingByKey, readEnergy } from '../energy';
import type { LocalDatabase, TransactionContext } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { dailyGoalCompletion, outbox } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createLocalCommandRegistry, createSyncRegistry, createSyncWriter } from '../sync';
import { createDaysChangedDispatcher, type DaysChanged } from './days-changed';
import { createDailyGoalPersistence, dailyGoalCommands, dailyGoalSyncEntities } from './persistence';
import { createDailyGoalRegistry } from './registry';
import { insertDailyGoalForTest, insertPersonForTest } from './testing/persisted';
import { createTestFactsStore, testBausteinEvaluators, testCheckInEvaluators, type TestDayFacts } from './testing/test-evaluators';

// Nachweis für #105: der Persistenzdienst `reevaluateDailyGoals` (Spezifikation 0, Abschnitt 3) mit
// Test-Evaluatoren gegen eine echte SQLite-Datei. Er läuft in der Transaktion der auslösenden Änderung,
// legt erstmalige Erfüllungen samt `+1` und den Tagesbonus genau einmal an und meldet die Tage nach
// dem Commit an `onDaysChanged`.

const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const berlin = TimeZone.parse('Europe/Berlin');
const today = LocalDate.parse('2026-10-14');
const yesterday = LocalDate.parse('2026-10-13');
const tomorrow = LocalDate.parse('2026-10-15');
const noon = Instant.parse('2026-10-14T10:00:00.000Z');
/** Beginn des 15.10. in Berlin (Sommerzeit). */
const todayEndsAt = Instant.parse('2026-10-14T22:00:00.000Z');

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Drei Tagesziele eines Tags; `dayEndsAt` ist der Beginn des Folgetags in Berlin. */
function snapshotsOf(localDate: LocalDate, bausteine: readonly DailyGoalSnapshot['type'][] = ['gewogen', 'wasserziel', 'sporteinheit']): DailyGoalSnapshot[] {
  const dayEndsAt = Instant.parse(new Date(Date.parse(`${localDate}T00:00:00.000Z`) + 22 * 3_600_000).toISOString());
  return bausteine.map((type, index) => {
    const base = { personId: anna, localDate, slot: (index + 1) as 1 | 2 | 3, timeZone: berlin, dayEndsAt };
    switch (type) {
      case 'wasserziel':
        return { type, ...base, targetMl: 1500 };
      case 'sporteinheit':
        return { type, ...base, minimumSingleSessionMinutes: 20 };
      case 'ernaehrung_erfasst':
        return { type, ...base, minimumMealCategories: 2 };
      case 'im_kalorienbudget':
        return { type, ...base, budgetKcal: 1800, lowerBoundKcal: 1200 };
      case 'gewogen':
        return { type, ...base };
    }
  });
}

function materialize(tx: TransactionContext, localDate: LocalDate, bausteine?: readonly DailyGoalSnapshot['type'][]) {
  for (const snapshot of snapshotsOf(localDate, bausteine)) insertDailyGoalForTest(tx, EntityId.parse(randomUUID()), snapshot);
}

const allFulfilled: Partial<TestDayFacts> = { weightEntryCount: 1, countedMl: 1500, sessionMinutes: [30], intakeKcal: 1500 };

async function setup(options: { materialized?: LocalDate[] } = {}) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const facts = createTestFactsStore();
  const registry = createDailyGoalRegistry({
    bausteine: Object.values(testBausteinEvaluators(facts.read)),
    checkIns: Object.values(testCheckInEvaluators(facts.read)),
  });
  const writer = createSyncWriter({ registry: createSyncRegistry(dailyGoalSyncEntities), clock, newId: () => EntityId.parse(randomUUID()) });
  const signals: DaysChanged[] = [];
  const dispatcher = createDaysChangedDispatcher({ database, observers: [(signal) => void signals.push(signal)], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry, clock, writer, dispatcher });
  database.transaction((tx) => {
    insertPersonForTest(tx, anna);
    for (const localDate of options.materialized ?? [today]) materialize(tx, localDate);
  });

  const reevaluate = (localDates: LocalDate[], cause: DailyGoalCause = 'eingabe') =>
    database.transaction((tx) => persistence.reevaluateDailyGoals(tx, anna, localDates, cause));
  return {
    database,
    clock,
    facts,
    registry,
    writer,
    persistence,
    dispatcher,
    signals,
    reevaluate,
    /** Wie eine Eingabe auf „Heute“: Fakten ändern und den Tag melden. */
    enter(localDate: LocalDate, next: Partial<TestDayFacts>, cause: DailyGoalCause = 'eingabe') {
      facts.set(anna, localDate, next);
      reevaluate([localDate], cause);
    },
    completions: () => database.read((tx) => sqliteOf(tx).select().from(dailyGoalCompletion).all()),
    commands: () => database.read((tx) => sqliteOf(tx).select({ type: outbox.type, businessKey: outbox.businessKey, payload: outbox.payload }).from(outbox).all()),
    energy: () => database.read((tx) => readEnergy(tx, anna)),
    evaluate: (localDate: LocalDate, slot: 1 | 2 | 3, at: Instant) =>
      database.read((tx) => registry.evaluateDailyGoal(tx, snapshotsOf(localDate)[slot - 1]!, at)),
  };
}

describe('reevaluateDailyGoals', () => {
  it('Tracer Bullet: erstmals erfüllt – genau eine Erfüllung, eine +1-Buchung, ein Fachbefehl, und der Tag erreicht die Beobachter', async () => {
    const world = await setup();
    world.enter(today, { countedMl: 1500 });

    const key = dailyGoalKey(anna, today, 2);
    expect(world.completions()).toEqual([
      expect.objectContaining({ id: dailyGoalCompletionId(key), completionKey: key, slot: 2, baustein: 'wasserziel', firstCompletedAt: noon, serverVersion: null }),
    ]);
    expect(world.database.read((tx) => bookingByKey(tx, key))).toEqual({
      type: 'daily_goal_credit', id: energyBookingId(key), personId: anna, amount: 1, localDate: today, bookingKey: key, createdAt: noon,
      trigger: { dailyGoalCompletionId: dailyGoalCompletionId(key), slot: 2 },
    });
    expect(world.commands()).toEqual([
      { type: 'completeDailyGoal', businessKey: key,
        payload: { dailyGoalId: world.completions()[0]!.dailyGoalId, localDate: today, slot: 2, baustein: 'wasserziel', completedAt: noon } },
    ]);
    await world.dispatcher.deliver();
    expect(world.signals).toEqual([{ personId: anna, localDates: [today], cause: 'eingabe' }]);
  });

  it('erneute Auswertung: keine zweite Erfüllung, keine zweite Buchung, kein zweiter Befehl', async () => {
    const world = await setup();
    world.enter(today, { countedMl: 1500 });
    world.clock.advanceBy(60_000);
    world.reevaluate([today], 'app_oeffnung');
    world.enter(today, { countedMl: 2000 });
    expect(world.completions()).toHaveLength(1);
    expect(world.completions()[0]!.firstCompletedAt).toBe(noon);
    expect(world.commands()).toHaveLength(1);
    expect(world.energy()).toEqual({ balance: 1, levelHalf: 0 });
  });

  it('korrigiert: Erfüllung bleibt, keine Gegenbuchung; der Zustand ist „offen · bereits gutgeschrieben“', async () => {
    const world = await setup();
    world.enter(today, { countedMl: 1500 });
    world.enter(today, { countedMl: 0 }, 'rueckgaengig');
    expect(world.completions()).toHaveLength(1);
    expect(world.commands()).toHaveLength(1);
    expect(world.energy()).toEqual({ balance: 1, levelHalf: 0 });
    expect(world.evaluate(today, 2, noon)).toMatchObject({ type: 'evaluated', currentState: 'offen', completion: { type: 'festgehalten', firstCompletedAt: noon } });
  });

  it('Tagesbonus: genau einmal, sobald alle drei Erfüllungen eines Tags bestehen', async () => {
    const world = await setup();
    world.enter(today, { weightEntryCount: 1, countedMl: 1500 });
    expect(world.database.read((tx) => bookingByKey(tx, dailyBonusKey(anna, today)))).toBeNull();
    world.enter(today, allFulfilled);
    world.reevaluate([today], 'app_oeffnung');

    const bonusKey = dailyBonusKey(anna, today);
    expect(world.database.read((tx) => bookingByKey(tx, bonusKey))).toEqual({
      type: 'daily_bonus_credit', id: energyBookingId(bonusKey), personId: anna, amount: 1, localDate: today, bookingKey: bonusKey, createdAt: noon,
      trigger: { dailyGoalCompletionIds: ([1, 2, 3] as const).map((slot) => dailyGoalCompletionId(dailyGoalKey(anna, today, slot))) },
    });
    expect(world.commands().map((command) => command.type)).toEqual(['completeDailyGoal', 'completeDailyGoal', 'completeDailyGoal', 'grantDailyBonus']);
    expect(world.commands()[3]).toEqual({ type: 'grantDailyBonus', businessKey: bonusKey, payload: { localDate: today, grantedAt: noon } });
    expect(world.energy()).toEqual({ balance: 4, levelHalf: 0 });
  });

  it('Tagesende: „Im Kalorienbudget“ und damit auch der Bonus warten bis `dayEndsAt`', async () => {
    const world = await setup({ materialized: [] });
    world.database.transaction((tx) => materialize(tx, today, ['gewogen', 'wasserziel', 'im_kalorienbudget']));
    world.enter(today, allFulfilled);
    expect(world.completions().map((completion) => completion.baustein).sort()).toEqual(['gewogen', 'wasserziel']);
    expect(world.database.read((tx) => bookingByKey(tx, dailyBonusKey(anna, today)))).toBeNull();

    world.clock.set(todayEndsAt);
    world.reevaluate([today], 'tagesabschluss');
    expect(world.completions().map((completion) => completion.baustein).sort()).toEqual(['gewogen', 'im_kalorienbudget', 'wasserziel']);
    expect(world.database.read((tx) => bookingByKey(tx, dailyBonusKey(anna, today)))).not.toBeNull();
    expect(world.energy()).toEqual({ balance: 4, levelHalf: 0 });
  });

  it('Tagesende verfehlt: das Kalorienbudget bleibt ohne Erfüllung, es gibt keinen Bonus', async () => {
    const world = await setup({ materialized: [] });
    world.database.transaction((tx) => materialize(tx, today, ['gewogen', 'wasserziel', 'im_kalorienbudget']));
    world.enter(today, { ...allFulfilled, intakeKcal: 2100 });
    world.clock.set(todayEndsAt);
    world.reevaluate([today], 'tagesabschluss');
    expect(world.completions()).toHaveLength(2);
    expect(world.energy()).toEqual({ balance: 2, levelHalf: 0 });
  });

  it('künftige Tage: nichts angelegt, nichts gebucht, nur das Signal', async () => {
    const world = await setup({ materialized: [today, tomorrow] });
    const hook = jest.fn();
    world.persistence.registerMissingDaysHook(hook);
    world.facts.set(anna, tomorrow, allFulfilled);
    world.reevaluate([tomorrow, LocalDate.parse('2026-10-27')], 'planaenderung');
    expect(world.completions()).toEqual([]);
    expect(world.commands()).toEqual([]);
    expect(hook).not.toHaveBeenCalled();
    await world.dispatcher.deliver();
    expect(world.signals).toEqual([{ personId: anna, localDates: [tomorrow, '2026-10-27'], cause: 'planaenderung' }]);
  });

  it('Rollback: Scheitert die auslösende Änderung, bleiben weder Erfüllung noch Buchung, Befehl oder Marker', async () => {
    const world = await setup();
    world.facts.set(anna, today, { countedMl: 1500 });
    expect(() =>
      world.database.transaction((tx) => {
        world.persistence.reevaluateDailyGoals(tx, anna, [today], 'eingabe');
        throw new Error('Eingabe scheitert');
      }),
    ).toThrow('Eingabe scheitert');
    expect(world.completions()).toEqual([]);
    expect(world.commands()).toEqual([]);
    expect(world.energy()).toEqual({ balance: 0, levelHalf: 0 });
    expect(world.dispatcher.pending()).toBe(0);
  });

  it('fehlende Tage: Der registrierte Haken legt sie in derselben Transaktion an, danach wird ausgewertet', async () => {
    const world = await setup({ materialized: [] });
    const requests: unknown[] = [];
    world.persistence.registerMissingDaysHook((tx, request) => {
      requests.push(request);
      for (const localDate of request.localDates) materialize(tx, localDate);
    });
    expect(() => world.persistence.registerMissingDaysHook(() => {})).toThrow();
    world.enter(yesterday, { countedMl: 1500 }, 'health_import');
    expect(requests).toEqual([{ personId: anna, localDates: [yesterday], today }]);
    expect(world.completions()).toEqual([expect.objectContaining({ localDate: yesterday, slot: 2 })]);
  });

  it('nur der Persistenzdienst erzeugt die beiden Fachbefehle', async () => {
    const world = await setup();
    const commands = createLocalCommandRegistry({ database: world.database, writer: world.writer, commands: dailyGoalCommands });
    expect(() => commands.execute('completeDailyGoal', dailyGoalKey(anna, today, 1),
      { dailyGoalId: anna, localDate: today, slot: 1, baustein: 'gewogen', completedAt: noon })).toThrow(/Persistenzdienst/);
    expect(world.commands()).toEqual([]);
  });

  it('dauerhaft abgelehnt: entfernt die unbestätigte Erfüllung samt Buchung, ohne andere Tage anzutasten', async () => {
    const world = await setup();
    world.enter(today, allFulfilled);
    const commands = createLocalCommandRegistry({ database: world.database, writer: world.writer, commands: dailyGoalCommands });
    const rejected = (businessKey: string, type: 'completeDailyGoal' | 'grantDailyBonus') => {
      const operation = { type, operationId: EntityId.parse(randomUUID()), businessKey, payload: {}, knownServerVersion: null, schemaVersion: 1, createdAt: noon };
      world.database.transaction((tx) => commands.reconcileRejected(tx, operation, { type: 'permanently_rejected', operationId: operation.operationId,
        error: { code: 'invalid_payload', retryable: false }, canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId } }));
    };
    rejected(dailyBonusKey(anna, today), 'grantDailyBonus');
    rejected(dailyGoalKey(anna, today, 2), 'completeDailyGoal');
    expect(world.completions().map((completion) => completion.slot).sort()).toEqual([1, 3]);
    expect(world.energy()).toEqual({ balance: 2, levelHalf: 0 });
  });
});

describe('Pull-Übernahme', () => {
  it('meldet tagesbezogene Tage mit `pull` und neue Plan-Fassungen mit `planaenderung` bis heute + 13', async () => {
    const world = await setup({ materialized: [yesterday, today] });
    world.facts.set(anna, yesterday, { countedMl: 1500 });
    world.database.transaction((tx) =>
      world.persistence.onCanonicalChanges(tx, [
        { entityType: 'water_entry', entityId: anna, type: 'record', days: [{ type: 'tag', personId: anna, localDate: yesterday }, { type: 'tag', personId: anna, localDate: today }] },
        { entityType: 'goal_version', entityId: anna, type: 'record', days: [{ type: 'plan', personId: anna, validFrom: LocalDate.parse('2026-10-01') }] },
      ]),
    );
    expect(world.completions()).toEqual([expect.objectContaining({ localDate: yesterday, slot: 2 })]);
    await world.dispatcher.deliver();
    expect(world.signals).toEqual([
      { personId: anna, localDates: [yesterday, today], cause: 'pull' },
      { personId: anna, localDates: planChangeDays(LocalDate.parse('2026-10-01'), today), cause: 'planaenderung' },
    ]);
  });
});
