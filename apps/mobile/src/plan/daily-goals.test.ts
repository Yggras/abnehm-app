/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { dailyGoalId, type DailyGoalCause } from '@abnehm/contracts/daily-goals';
import { MaterializeDailyGoals } from '@abnehm/contracts/plan';
import type { OutboxOperation } from '@abnehm/contracts/sync';

import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCommands, dailyGoalCompletionEntity } from '../daily-goals';
import { insertPersonForTest } from '../daily-goals/testing/persisted';
import { createTestFactsStore, testBausteinEvaluators, testCheckInEvaluators } from '../daily-goals/testing/test-evaluators';
import { energyBookingEntity } from '../energy';
import type { LocalDatabase, ReadContext } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { dailyGoal, dailyGoalCompletion, energyBooking } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createLocalCommandRegistry, createSyncRegistry, createSyncWriter, personEntity } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createPlan, goalVersionEntity, planCommands, weeklyPlanVersionEntity, type InitialPlanDraft } from '.';

// Nachweis für #131: Tagesziele des Plan-Moduls (Spezifikation 1, Abschnitt 5) gegen eine echte
// SQLite-Datei mit den Migrationen der App, der Testuhr samt Test-Zeitzone und den Test-Evaluatoren aus
// #104 am echten Persistenzdienst aus #105. Das Startgewicht läuft über einen Fixture-Adapter des
// `WeightRecorder`, der für die Test-Evaluatoren eine Wiegung am Messtag festhält.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const berlin = TimeZone.parse('Europe/Berlin');
const tokyo = TimeZone.parse('Asia/Tokyo');
const newYork = TimeZone.parse('America/New_York');
const london = TimeZone.parse('Europe/London');
const day = (value: string) => LocalDate.parse(value);
const instant = (value: string) => Instant.parse(value);

/** Referenzfall der Recherche: Frau, 35 Jahre, 168 cm, 80 kg, wenig aktiv, entspannt; Sport Di/Do/Sa, Wiegen montags. */
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

type Report = Readonly<{ localDates: readonly LocalDate[]; cause: DailyGoalCause }>;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Ein Gerät mit Kontodatenbank, Testuhr, Persistenzdienst samt Haken und Plan-Modul. */
async function setup(start: { at: string; timeZone?: TimeZone }) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock: TestClock = createTestClock({ instant: instant(start.at), timeZone: start.timeZone ?? berlin });
  const newId = () => EntityId.parse(randomUUID());
  const facts = createTestFactsStore();
  const registry = createDailyGoalRegistry({
    bausteine: Object.values(testBausteinEvaluators(facts.read)),
    checkIns: Object.values(testCheckInEvaluators(facts.read)),
  });
  const writer = createSyncWriter({
    registry: createSyncRegistry([personEntity, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity]),
    clock,
    newId,
  });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry, clock, writer, dispatcher });
  const reports: Report[] = [];
  let failing: DailyGoalCause | null = null;
  const plan = createPlan({
    database,
    clock,
    writer,
    newId,
    persistence: {
      reevaluateDailyGoals(tx, personId, localDates, cause) {
        reports.push({ localDates: [...localDates], cause });
        persistence.reevaluateDailyGoals(tx, personId, localDates, cause);
        if (cause === failing) throw new Error('Auswertung gescheitert');
      },
    },
    weightRecorder: {
      async recordManualWeight(input) {
        const localDate = createTestClock({ instant: input.measuredAt, timeZone: clock.read().timeZone }).read().localDate;
        facts.set(philipp, localDate, { weightEntryCount: 1 });
        return { type: 'recorded', entryId: input.entryId, localDate };
      },
    },
  });
  persistence.registerMissingDaysHook(plan.materializeMissingDays);
  const commands = createLocalCommandRegistry({ database, writer, commands: [...dailyGoalCommands, ...planCommands] });

  const goalsOf = (tx: ReadContext, localDate?: string) =>
    sqliteOf(tx)
      .select()
      .from(dailyGoal)
      .where(localDate === undefined ? undefined : eq(dailyGoal.localDate, localDate))
      .orderBy(asc(dailyGoal.localDate), asc(dailyGoal.slot))
      .all();
  const completionsOf = (tx: ReadContext, localDate?: string) =>
    sqliteOf(tx)
      .select({ localDate: dailyGoalCompletion.localDate, slot: dailyGoalCompletion.slot, baustein: dailyGoalCompletion.baustein })
      .from(dailyGoalCompletion)
      .where(localDate === undefined ? undefined : and(eq(dailyGoalCompletion.personId, philipp), eq(dailyGoalCompletion.localDate, localDate)))
      .orderBy(asc(dailyGoalCompletion.localDate), asc(dailyGoalCompletion.slot))
      .all();
  return {
    database,
    clock,
    facts,
    plan,
    persistence,
    commands,
    reports,
    /** Stellt die Uhr und speichert den Erstplan zu diesem Zeitpunkt. */
    async saveOn(at: string, changes: Partial<InitialPlanDraft> = {}) {
      clock.set(instant(at));
      await expect(plan.saveInitialPlan({ ...draft, ...changes })).resolves.toMatchObject({ type: 'gespeichert' });
    },
    /** Ein Auslöser zu diesem Zeitpunkt, wahlweise nach einer Reise in eine andere Zone. */
    trigger(at: string, timeZone?: TimeZone) {
      clock.set(instant(at));
      if (timeZone !== undefined) clock.setTimeZone(timeZone);
      reports.splice(0);
      plan.ensureDailyGoals();
    },
    failOn(cause: DailyGoalCause) {
      failing = cause;
    },
    goals: (localDate?: string) => database.read((tx) => goalsOf(tx, localDate)),
    goalsOf,
    days: () => [...new Set(database.read((tx) => goalsOf(tx)).map((goal) => goal.localDate))],
    completions: (localDate?: string) => database.read((tx) => completionsOf(tx, localDate)),
    completionsOf,
    bookings: () => database.read((tx) => sqliteOf(tx).select({ bookingKey: energyBooking.bookingKey }).from(energyBooking).orderBy(asc(energyBooking.bookingKey)).all()),
    operations: () => database.read((tx) => pendingOperations(tx, 200)),
    reportsOf: (cause: DailyGoalCause) => reports.filter((report) => report.cause === cause).map((report) => report.localDates),
  };
}

const materializations = (operations: readonly OutboxOperation[]) =>
  operations.flatMap((operation) => (operation.type === 'materializeDailyGoals' ? [operation] : []));

describe('Materialisierung', () => {
  it('legt beim Erstplan genau drei Tagesziele für heute an und schreibt sie über materializeDailyGoals in die Outbox', async () => {
    // Mittwoch, 14.10.2026, 12:00 in Berlin: Ernährung erfasst, Wasserziel, Im Kalorienbudget.
    const world = await setup({ at: '2026-10-14T10:00:00.000Z' });
    await world.saveOn('2026-10-14T10:00:00.000Z');

    const base = { personId: philipp, localDate: '2026-10-14', timeZone: berlin, dayEndsAt: '2026-10-14T22:00:00.000Z' };
    const expected = [
      { type: 'ernaehrung_erfasst', ...base, slot: 1, minimumMealCategories: 2 },
      { type: 'wasserziel', ...base, slot: 2, targetMl: 1_500 },
      // Referenzfall: Budget 1620 kcal, Untergrenze = Grundumsatz 1514 kcal (research/calorie-needs.md).
      { type: 'im_kalorienbudget', ...base, slot: 3, budgetKcal: 1_620, lowerBoundKcal: 1_514 },
    ];
    expect(world.goals()).toEqual(expected.map((snapshot) => ({
      id: dailyGoalId(philipp, day('2026-10-14'), snapshot.slot as 1 | 2 | 3),
      personId: philipp,
      localDate: '2026-10-14',
      timeZone: berlin,
      utcOffsetMinutes: 120,
      slot: snapshot.slot,
      baustein: snapshot.type,
      snapshot,
      dayEndsAt: '2026-10-14T22:00:00.000Z',
      createdAt: '2026-10-14T10:00:00.000Z',
      serverVersion: null,
    })));
    expect(materializations(world.operations())).toEqual([
      expect.objectContaining({
        businessKey: `tagesziele:${philipp}:2026-10-14`,
        knownServerVersion: null,
        payload: { localDate: '2026-10-14', goals: world.goals().map((goal) => ({ id: goal.id, snapshot: goal.snapshot })) },
      }),
    ]);
    expect(MaterializeDailyGoals.safeParse(materializations(world.operations())[0]!.payload).success).toBe(true);
  });

  it('schreibt je Baustein die Schwelle fest: Sporteinheit aus dem Zielrechner, Gewogen ohne Schwelle', async () => {
    const world = await setup({ at: '2026-10-12T10:00:00.000Z' });
    await world.saveOn('2026-10-12T10:00:00.000Z');
    world.trigger('2026-10-13T10:00:00.000Z');

    // Montag ist Wiegetag, Dienstag Sporttag; 150 Minuten auf drei Sporttage ergeben 50 Minuten.
    expect(world.goals('2026-10-12').map((goal) => goal.snapshot)[2]).toEqual({
      type: 'gewogen', personId: philipp, localDate: '2026-10-12', slot: 3, timeZone: berlin, dayEndsAt: '2026-10-12T22:00:00.000Z',
    });
    expect(world.goals('2026-10-13').map((goal) => goal.snapshot)).toEqual([
      expect.objectContaining({ type: 'ernaehrung_erfasst', minimumMealCategories: 2 }),
      expect.objectContaining({ type: 'wasserziel', targetMl: 1_500 }),
      expect.objectContaining({ type: 'sporteinheit', minimumSingleSessionMinutes: 50 }),
    ]);
  });

  it('wertet die heutigen Tagesziele beim Erstplan sofort aus: Ein Startgewicht am Wiegetag erfüllt „Gewogen“', async () => {
    const world = await setup({ at: '2026-10-12T10:00:00.000Z' });
    await world.saveOn('2026-10-12T10:00:00.000Z');

    expect(world.completions()).toEqual([{ localDate: '2026-10-12', slot: 3, baustein: 'gewogen' }]);
    expect(world.operations().map((operation) => operation.type)).toEqual([
      'upsert_entity', 'createGoalVersion', 'createWeeklyPlanVersion', 'materializeDailyGoals', 'completeDailyGoal',
    ]);
  });

  it('vergibt deterministische IDs aus Person, Tag und Platz: zwei Installationen legen dieselben Tagesziele an', async () => {
    const iphone = await setup({ at: '2026-10-14T10:00:00.000Z' });
    const ipad = await setup({ at: '2026-10-14T10:00:00.000Z' });
    await iphone.saveOn('2026-10-14T10:00:00.000Z');
    await ipad.saveOn('2026-10-14T11:00:00.000Z');

    const ids = iphone.goals().map((goal) => goal.id);
    expect(ids).toEqual([1, 2, 3].map((slot) => dailyGoalId(philipp, day('2026-10-14'), slot as 1 | 2 | 3)));
    expect(ipad.goals().map((goal) => goal.id)).toEqual(ids);
  });

  it('legt einen Tag atomar an: Scheitert die Auswertung, bleiben weder Tagesziele noch Outbox zurück', async () => {
    const world = await setup({ at: '2026-10-14T10:00:00.000Z' });
    await world.saveOn('2026-10-14T10:00:00.000Z');
    const before = { goals: world.goals(), operations: world.operations() };
    world.failOn('app_oeffnung');

    expect(() => world.trigger('2026-10-15T10:00:00.000Z')).toThrow('Auswertung gescheitert');
    expect(world.goals()).toEqual(before.goals);
    expect(world.operations()).toEqual(before.operations);
  });
});

describe('Tagesende, Zeitumstellung und Reisen', () => {
  const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 3_600_000;
  const endOf = (world: Awaited<ReturnType<typeof setup>>, localDate: string) => world.goals(localDate)[0]!.dayEndsAt;

  it('gibt dem 25.10.2026 in Berlin 25 Stunden', async () => {
    const world = await setup({ at: '2026-10-24T10:00:00.000Z' });
    await world.saveOn('2026-10-24T10:00:00.000Z');
    world.trigger('2026-10-25T11:00:00.000Z');

    expect(endOf(world, '2026-10-24')).toBe('2026-10-24T22:00:00.000Z');
    expect(endOf(world, '2026-10-25')).toBe('2026-10-25T23:00:00.000Z');
    expect(hours(endOf(world, '2026-10-24'), endOf(world, '2026-10-25'))).toBe(25);
    expect(world.goals('2026-10-25').map((goal) => goal.utcOffsetMinutes)).toEqual([120, 120, 120]);
  });

  it('gibt dem 28.03.2027 in Berlin 23 Stunden', async () => {
    const world = await setup({ at: '2027-03-27T11:00:00.000Z' });
    await world.saveOn('2027-03-27T11:00:00.000Z');
    world.trigger('2027-03-28T10:00:00.000Z');

    expect(endOf(world, '2027-03-27')).toBe('2027-03-27T23:00:00.000Z');
    expect(endOf(world, '2027-03-28')).toBe('2027-03-28T22:00:00.000Z');
    expect(hours(endOf(world, '2027-03-27'), endOf(world, '2027-03-28'))).toBe(23);
  });

  it('Reise nach Osten: Der neue Tag entsteht in der Zone des Geräts, der Tag in Berlin behält sein Tagesende', async () => {
    const world = await setup({ at: '2026-10-14T10:00:00.000Z' });
    await world.saveOn('2026-10-14T10:00:00.000Z');
    // 16:00 UTC ist in Tokio schon 01:00 am 15.10.; in Berlin läuft der 14.10. noch bis 22:00 UTC.
    world.trigger('2026-10-14T16:00:00.000Z', tokyo);

    expect(world.goals('2026-10-14').map((goal) => [goal.timeZone, goal.dayEndsAt])[0]).toEqual([berlin, '2026-10-14T22:00:00.000Z']);
    expect(world.goals('2026-10-15').map((goal) => [goal.timeZone, goal.dayEndsAt, goal.utcOffsetMinutes])[0]).toEqual([tokyo, '2026-10-15T15:00:00.000Z', 540]);
    expect(world.reportsOf('tagesabschluss')).toEqual([]);
  });

  it('Reise nach Westen: Der Berliner Tag schließt zu seinem Tagesende, obwohl es in New York noch derselbe Tag ist', async () => {
    const world = await setup({ at: '2026-10-14T10:00:00.000Z' });
    await world.saveOn('2026-10-14T10:00:00.000Z');
    // 03:00 UTC am 15.10. ist in New York 23:00 am 14.10.
    world.trigger('2026-10-15T03:00:00.000Z', newYork);

    expect(world.days()).toEqual(['2026-10-14']);
    expect(world.reportsOf('tagesabschluss')).toEqual([['2026-10-14']]);

    world.trigger('2026-10-15T12:00:00.000Z');
    // Mitternacht in New York ist im Oktober 04:00 UTC (Sommerzeit, UTC−4).
    expect(world.goals('2026-10-15').map((goal) => [goal.timeZone, goal.dayEndsAt, goal.utcOffsetMinutes])[0]).toEqual([newYork, '2026-10-16T04:00:00.000Z', -240]);
  });
});

describe('Nachholen', () => {
  it('legt fehlende Tage genau im 7-Tage-Fenster an, mit den damals gültigen Fassungen und der aktuellen Zone', async () => {
    const world = await setup({ at: '2026-10-01T10:00:00.000Z' });
    await world.saveOn('2026-10-01T10:00:00.000Z');
    // Ab 11.10. gilt ein höheres Wasserziel. Auch dieses Speichern ist ein Auslöser: Es holt den 05. bis
    // 10.10. mit der damals gültigen Fassung nach, der 02. bis 04.10. liegen außerhalb des Fensters.
    await world.saveOn('2026-10-11T10:00:00.000Z', { waterTargetMl: 2_000 });
    // Nach einer Reise nach London: heute ist der 14.10., der 12. bis 14.10. fehlen noch.
    world.trigger('2026-10-14T10:00:00.000Z', london);

    expect(world.days()).toEqual([
      '2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14',
    ]);
    const water = (localDate: string) => world.goals(localDate).find((goal) => goal.baustein === 'wasserziel')!;
    expect(water('2026-10-10').snapshot).toMatchObject({ targetMl: 1_500, timeZone: berlin, dayEndsAt: '2026-10-10T22:00:00.000Z' });
    expect(water('2026-10-11').snapshot).toMatchObject({ targetMl: 2_000, timeZone: berlin });
    expect(water('2026-10-12').snapshot).toMatchObject({ targetMl: 2_000, timeZone: london, dayEndsAt: '2026-10-12T23:00:00.000Z' });
    expect(materializations(world.operations()).map((operation) => operation.payload.localDate)).toEqual([
      '2026-10-01', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14',
    ]);
  });

  it('Erstplan speichern ist ein Auslöser: Er holt nach und meldet abgelaufene Tage mit tagesabschluss', async () => {
    const world = await setup({ at: '2026-10-01T10:00:00.000Z' });
    await world.saveOn('2026-10-01T10:00:00.000Z');
    world.reports.splice(0);
    // Fortsetzen des Onboardings am 03.10.: Schritt 8 erneut gespeichert.
    await world.saveOn('2026-10-03T10:00:00.000Z');

    expect(world.days()).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(world.reportsOf('tagesabschluss')).toEqual([['2026-10-01', '2026-10-02']]);
    expect(world.reportsOf('app_oeffnung')).toEqual([]);
    expect(world.reportsOf('planaenderung')[0]![0]).toBe('2026-10-03');
  });

  it('legt nie einen Tag vor dem ersten valid_from an', async () => {
    const world = await setup({ at: '2026-10-12T10:00:00.000Z' });
    await world.saveOn('2026-10-12T10:00:00.000Z');
    world.trigger('2026-10-14T10:00:00.000Z');

    expect(world.days()).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
  });

  it('Haken für fehlende Tage: Ein Eintrag für einen fehlenden Tag im Fenster legt ihn an und wertet ihn in derselben Transaktion aus', async () => {
    const world = await setup({ at: '2026-10-01T10:00:00.000Z' });
    await world.saveOn('2026-10-01T10:00:00.000Z');
    world.clock.set(instant('2026-10-14T10:00:00.000Z'));
    // Nachgetragene Wiegung am Montag, 12.10. (Wiegetag), und eine am 07.10. außerhalb des Fensters.
    world.facts.set(philipp, day('2026-10-12'), { weightEntryCount: 1 });
    world.facts.set(philipp, day('2026-10-07'), { weightEntryCount: 1 });

    const inTransaction = world.database.transaction((tx) => {
      world.persistence.reevaluateDailyGoals(tx, philipp, [day('2026-10-12'), day('2026-10-07')], 'eingabe');
      return { goals: world.goalsOf(tx, '2026-10-12').length, completions: world.completionsOf(tx, '2026-10-12') };
    });

    expect(inTransaction).toEqual({ goals: 3, completions: [{ localDate: '2026-10-12', slot: 3, baustein: 'gewogen' }] });
    expect(world.days()).toEqual(['2026-10-01', '2026-10-12']);
  });
});

describe('Tagesabschluss', () => {
  it('meldet bei jedem Auslöser genau die materialisierten Tage des Fensters mit abgelaufenem dayEndsAt', async () => {
    const world = await setup({ at: '2026-10-01T10:00:00.000Z' });
    await world.saveOn('2026-10-01T10:00:00.000Z');
    world.trigger('2026-10-14T10:00:00.000Z');

    // Der 01.10. liegt außerhalb des Fensters, der 14.10. endet erst um 22:00 UTC.
    expect(world.reportsOf('tagesabschluss')).toEqual([['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']]);
    expect(world.reportsOf('app_oeffnung')).toEqual([['2026-10-14']]);

    // Eine Minute nach Mitternacht in Berlin ist auch der 14.10. abgeschlossen, und der 15.10. entsteht.
    world.trigger('2026-10-14T22:01:00.000Z');
    expect(world.reportsOf('tagesabschluss')).toEqual([['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']]);
    expect(world.reportsOf('app_oeffnung')).toEqual([['2026-10-15']]);
  });

  it('bleibt bei Wiederholung folgenlos: Im Kalorienbudget wird genau einmal gutgeschrieben', async () => {
    const world = await setup({ at: '2026-10-01T10:00:00.000Z' });
    await world.saveOn('2026-10-01T10:00:00.000Z');
    // Sonntag, 11.10.: Ernährung erfasst, Wasserziel, Im Kalorienbudget; 1600 kcal liegen im Budget.
    world.facts.set(philipp, day('2026-10-11'), { intakeKcal: 1_600 });
    world.trigger('2026-10-14T10:00:00.000Z');
    const once = { completions: world.completions(), bookings: world.bookings(), operations: world.operations() };
    world.trigger('2026-10-14T10:05:00.000Z');
    world.trigger('2026-10-14T10:10:00.000Z');

    expect(once.completions).toEqual([{ localDate: '2026-10-11', slot: 3, baustein: 'im_kalorienbudget' }]);
    expect(once.bookings).toEqual([{ bookingKey: `tagesziel:${philipp}:2026-10-11:3` }]);
    expect({ completions: world.completions(), bookings: world.bookings(), operations: world.operations() }).toEqual(once);
  });
});

describe('Keine Rückwirkung', () => {
  it('neue Ziele, ein neuer Wochenplan und ein Zeitzonenwechsel verändern materialisierte Tagesziele nie', async () => {
    const world = await setup({ at: '2026-10-14T10:00:00.000Z' });
    await world.saveOn('2026-10-14T10:00:00.000Z');
    const before = world.goals();

    // Erneutes Speichern am selben Tag ersetzt die Fassungen lokal (#128); ob der Server das annimmt, klären #134 und #144.
    await world.saveOn('2026-10-14T11:00:00.000Z', { waterTargetMl: 2_500, weeklySportTargetMinutes: 200, sportDays: ['mittwoch'], weighDay: 'freitag' });
    world.trigger('2026-10-14T12:00:00.000Z', tokyo);

    expect(world.goals('2026-10-14')).toEqual(before);
  });
});

describe('Dauerhafte Ablehnung durch den Server', () => {
  it('entfernt die nie bestätigten Tagesziele des Tags samt Erfüllung, Gutschrift und Tagesbonus; der nächste Auslöser legt ihn neu an', async () => {
    const world = await setup({ at: '2026-10-12T10:00:00.000Z' });
    // Montag: Ernährung erfasst und Wasserziel erfüllt, das Startgewicht erfüllt „Gewogen“, also auch der Tagesbonus.
    await world.saveOn('2026-10-12T10:00:00.000Z');
    world.facts.set(philipp, day('2026-10-12'), { recordedMealCategories: 2, countedMl: 1_500, weightEntryCount: 1 });
    world.database.transaction((tx) => world.persistence.reevaluateDailyGoals(tx, philipp, [day('2026-10-12')], 'eingabe'));
    expect(world.bookings()).toHaveLength(4);

    const [materialization] = materializations(world.operations());
    world.database.transaction((tx) =>
      world.commands.reconcileRejected(tx, materialization!, {
        type: 'permanently_rejected',
        operationId: materialization!.operationId,
        error: { code: 'forbidden', retryable: false },
        canonical: { type: 'absent', entityType: 'command_result', entityId: materialization!.operationId },
      }));

    expect(world.goals()).toEqual([]);
    expect(world.completions()).toEqual([]);
    expect(world.bookings()).toEqual([]);

    world.trigger('2026-10-12T10:10:00.000Z');
    expect(world.days()).toEqual(['2026-10-12']);
    expect(world.completions()).toHaveLength(3);
  });

  it('lässt einen Tag stehen, den der Server schon bestätigt hat', async () => {
    const world = await setup({ at: '2026-10-14T10:00:00.000Z' });
    await world.saveOn('2026-10-14T10:00:00.000Z');
    world.database.transaction((tx) => sqliteOf(tx).update(dailyGoal).set({ serverVersion: '7' }).run());
    const [materialization] = materializations(world.operations());

    world.database.transaction((tx) =>
      world.commands.reconcileRejected(tx, materialization!, {
        type: 'permanently_rejected',
        operationId: materialization!.operationId,
        error: { code: 'invalid_payload', retryable: false },
        canonical: { type: 'absent', entityType: 'command_result', entityId: materialization!.operationId },
      }));

    expect(world.goals()).toHaveLength(3);
  });

  it('erzeugt keine Materialisierung über die lokale Befehls-Registry; das darf nur das Plan-Modul', async () => {
    const world = await setup({ at: '2026-10-14T10:00:00.000Z' });
    await world.saveOn('2026-10-14T10:00:00.000Z');
    const [materialization] = materializations(world.operations());

    expect(() => world.commands.execute('materializeDailyGoals', 'tagesziele:x', materialization!.payload)).toThrow('materializeDailyGoals erzeugt nur das Plan-Modul');
  });
});
