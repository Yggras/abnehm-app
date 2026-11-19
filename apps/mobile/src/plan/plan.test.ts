/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { DailyGoalCause } from '@abnehm/contracts/daily-goals';
import { goalVersionId, weeklyPlanVersionId } from '@abnehm/contracts/plan';
import type { RecordManualWeightResult } from '@abnehm/contracts/ports';

import { PortContractError } from '../area-ports';
import { fakeWeightRecorder } from '../area-ports/testing/fakes';
import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCompletionEntity } from '../daily-goals';
import { insertPersonForTest } from '../daily-goals/testing/persisted';
import { energyBookingEntity } from '../energy';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { dailyGoal, goalVersion, person, weeklyPlanDay, weeklyPlanVersion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createLocalCommandRegistry, createSyncRegistry, createSyncWriter, personEntity } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createPlan, goalVersionEntity, planCommands, planReaderOf, standardWeeklyPlan, weeklyPlanVersionEntity, type InitialPlanDraft } from '.';

// Nachweis für #128: Tracer Bullet des Plan-Moduls (Spezifikation 1, Abschnitte 1, 2 und 4) gegen eine
// echte SQLite-Datei mit denselben Migrationen wie die App, gesteuert über Testuhr und Test-Zeitzone.
// Das Startgewicht läuft über den Fixture-Adapter des `WeightRecorder` aus #104, bis Spezifikation 3
// den echten Port liefert.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const berlin = TimeZone.parse('Europe/Berlin');
/** Mittwoch, 14.10.2026, 12:00 in Berlin (Sommerzeit, UTC+2). */
const noon = Instant.parse('2026-10-14T10:00:00.000Z');
const day = (value: string) => LocalDate.parse(value);
/** Die Tage von `from` bis `to` einschließlich, alle im Oktober 2026. */
const october = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => day(`2026-10-${String(from + index).padStart(2, '0')}`));
const startWeightEntry = EntityId.parse('1f3e5d7c-9b8a-4c6e-8f2d-1e3c5a7b9d01');

/** Referenzfall der Recherche: Frau, 35 Jahre, 168 cm, 80 kg, wenig aktiv, entspannt; Sport Di/Do/Sa, Wiegen montags. */
const draft: InitialPlanDraft = {
  startWeightEntryId: startWeightEntry,
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

type Report = { personId: EntityId; localDates: readonly LocalDate[]; cause: DailyGoalCause };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup({ at = noon, recorded }: { at?: Instant; recorded?: RecordManualWeightResult } = {}) {
  let failReevaluation = false;
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock: TestClock = createTestClock({ instant: at, timeZone: berlin });
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry([personEntity, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity]);
  const writer = createSyncWriter({ registry, clock, newId });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock, writer, dispatcher });
  const weights = fakeWeightRecorder((measuredAt) => createTestClock({ instant: measuredAt, timeZone: berlin }).read().localDate);
  const weightCalls: unknown[] = [];
  const reports: Report[] = [];
  const plan = createPlan({
    database,
    clock,
    writer,
    newId,
    weightRecorder: {
      async recordManualWeight(input) {
        weightCalls.push(input);
        return recorded ?? weights.recordManualWeight(input);
      },
    },
    persistence: {
      reevaluateDailyGoals(tx, personId, localDates, cause) {
        reports.push({ personId, localDates: [...localDates], cause });
        persistence.reevaluateDailyGoals(tx, personId, localDates, cause);
        if (failReevaluation) throw new Error('Auswertung gescheitert');
      },
    },
  });
  const commands = createLocalCommandRegistry({ database, writer, commands: planCommands });
  return {
    database,
    clock,
    plan,
    planReader: planReaderOf(database),
    commands,
    weights,
    weightCalls,
    reports,
    goals: () => database.read((tx) => sqliteOf(tx).select().from(goalVersion).all()),
    weeklyPlans: () => database.read((tx) => sqliteOf(tx).select().from(weeklyPlanVersion).all()),
    weeklyPlanDays: () => database.read((tx) => sqliteOf(tx).select().from(weeklyPlanDay).all()),
    ownPerson: () => database.read((tx) => sqliteOf(tx).select().from(person).get()),
    dailyGoalsOn: (localDate: string) =>
      database.read((tx) => sqliteOf(tx).select().from(dailyGoal).where(eq(dailyGoal.localDate, localDate)).orderBy(asc(dailyGoal.slot)).all()),
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
    failReevaluation: () => {
      failReevaluation = true;
    },
  };
}

describe('Standard-Wochenplan aus Sporttagen und Wiegetag', () => {
  it('belegt Platz 1 mit Ernährung erfasst, Platz 2 mit Wasserziel und Platz 3 je nach Tag', () => {
    expect(standardWeeklyPlan({ sportDays: ['dienstag', 'donnerstag', 'samstag'], weighDay: 'montag' })).toEqual({
      type: 'gueltig',
      days: {
        montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
        dienstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
        mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
        donnerstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
        freitag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
        samstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
        sonntag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
      },
    });
  });

  it('erlaubt 0 bis 6 Sporttage und genau einen Wiegetag, der kein Sporttag ist', () => {
    expect(standardWeeklyPlan({ sportDays: [], weighDay: 'sonntag' })).toMatchObject({ type: 'gueltig' });
    const sechs = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'] as const;
    expect(standardWeeklyPlan({ sportDays: sechs, weighDay: 'sonntag' })).toMatchObject({ type: 'gueltig' });
    expect(standardWeeklyPlan({ sportDays: ['montag'], weighDay: 'montag' })).toEqual({ type: 'ungueltig', errors: ['weigh_day_is_sport_day'] });
    expect(standardWeeklyPlan({ sportDays: ['dienstag', 'dienstag'], weighDay: 'montag' })).toEqual({ type: 'ungueltig', errors: ['sport_day_repeated'] });
  });
});

describe('Vorschau', () => {
  it('rechnet über den Zielrechner mit dem Alter am heutigen Tag und schreibt nichts', async () => {
    const { plan, goals, operations } = await setup();

    expect(plan.preview(draft)).toMatchObject({ type: 'berechnet', calorieBudget: { kcal: 1_620 }, basalMetabolicRate: { kcal: 1_514 } });
    // Am 14.10.2026 ist, wer am 15.10.2008 geboren ist, noch 17.
    expect(plan.preview({ ...draft, birthDate: day('2008-10-15') })).toEqual({ type: 'ungueltig', errors: ['underage'] });
    expect(plan.preview({ ...draft, birthDate: day('2008-10-14') })).toMatchObject({ type: 'berechnet' });
    expect(goals()).toEqual([]);
    expect(operations()).toEqual([]);
  });
});

describe('Erstplan speichern', () => {
  it('legt zuerst das Startgewicht über den WeightRecorder an, mit Messzeitpunkt jetzt und der entryId des Entwurfs', async () => {
    const { plan, weights } = await setup();

    await expect(plan.saveInitialPlan(draft)).resolves.toEqual({
      type: 'gespeichert',
      validFrom: '2026-10-14',
      goalVersionId: goalVersionId(philipp, day('2026-10-14')),
      weeklyPlanVersionId: weeklyPlanVersionId(philipp, day('2026-10-14')),
    });
    expect(weights.entries()).toEqual([{ entryId: startWeightEntry, personId: philipp, weightG: 80_000, measuredAt: noon }]);
  });

  it('schreibt die Personenfelder über den Person-Upsert; der Onboarding-Stand bleibt begonnen', async () => {
    const { plan, ownPerson } = await setup();

    await plan.saveInitialPlan({ ...draft, knownEatingDisorder: true });

    expect(ownPerson()).toMatchObject({
      calculationSex: 'weiblich',
      birthDate: '1991-03-02',
      heightCm: 168,
      activityLevel: 'wenig_aktiv',
      pregnantOrBreastfeeding: false,
      knownEatingDisorder: true,
      onboardingStatus: 'begonnen',
      onboardingCompletedAt: null,
    });
  });

  it('legt Zielversion und Wochenplanversion ab heute samt Outbox in einer Transaktion an', async () => {
    const { plan, goals, weeklyPlans, weeklyPlanDays, operations } = await setup();

    await plan.saveInitialPlan(draft);

    expect(goals()).toEqual([
      expect.objectContaining({
        id: goalVersionId(philipp, day('2026-10-14')),
        personId: philipp,
        validFrom: '2026-10-14',
        calorieBudgetMilliKcal: 1_620_000,
        basalMetabolicRateMilliKcal: 1_514_000,
        totalEnergyExpenditureMilliKcal: 2_120_000,
        lowerBoundMilliKcal: 1_514_000,
        deficitMilliKcal: 500_000,
        budgetSource: 'berechnet',
        ageYears: 35,
        weightG: 80_000,
        maintenanceReason: null,
        pace: 'entspannt',
        goalWeightG: 76_000,
        waterTargetMl: 1_500,
        weeklySportTargetMinutes: 150,
        serverVersion: null,
      }),
    ]);
    expect(weeklyPlans()).toEqual([expect.objectContaining({ id: weeklyPlanVersionId(philipp, day('2026-10-14')), validFrom: '2026-10-14' })]);
    expect(weeklyPlanDays()).toHaveLength(7);
    expect(operations().map((operation) => [operation.type, 'businessKey' in operation ? operation.businessKey.split(':').slice(0, 3).join(':') : operation.entityType])).toEqual([
      ['upsert_entity', 'person'],
      ['createGoalVersion', `zielversion:${philipp}:2026-10-14`],
      ['createWeeklyPlanVersion', `wochenplan:${philipp}:2026-10-14`],
      // Seit #131 entstehen die heutigen Tagesziele in derselben Transaktion.
      ['materializeDailyGoals', `tagesziele:${philipp}:2026-10-14`],
    ]);
  });

  it('meldet in derselben Transaktion die Tage von heute bis heute + 13 mit planaenderung', async () => {
    const { plan, reports } = await setup();

    await plan.saveInitialPlan(draft);

    expect(reports).toEqual([
      {
        personId: philipp,
        localDates: Array.from({ length: 14 }, (_, index) => day(`2026-10-${String(14 + index).padStart(2, '0')}`)),
        cause: 'planaenderung',
      },
    ]);
  });

  it('gilt ab dem lokalen Tag des Speicherns in der Zone des Geräts', async () => {
    // 00:30 in Berlin am Donnerstag, in UTC noch Mittwoch.
    const { plan, goals, reports } = await setup({ at: Instant.parse('2026-10-14T22:30:00.000Z') });

    await expect(plan.saveInitialPlan(draft)).resolves.toMatchObject({ validFrom: '2026-10-15' });
    expect(goals()).toEqual([expect.objectContaining({ validFrom: '2026-10-15' })]);
    expect(reports[0]?.localDates[0]).toBe('2026-10-15');
    expect(reports[0]?.localDates.at(-1)).toBe('2026-10-28');
  });

  it('zweimal speichern ergibt genau ein Startgewicht und keine zweite Fassung', async () => {
    const { plan, weights, goals, weeklyPlans, operations } = await setup();

    await plan.saveInitialPlan(draft);
    await plan.saveInitialPlan(draft);

    expect(weights.entries()).toHaveLength(1);
    expect(goals()).toHaveLength(1);
    expect(weeklyPlans()).toHaveLength(1);
    expect(operations().filter((operation) => operation.type !== 'upsert_entity').map((operation) => operation.type)).toEqual([
      'createGoalVersion',
      'createWeeklyPlanVersion',
      'materializeDailyGoals',
    ]);
  });

  it('nach „Zurück“ mit geänderter Eingabe gilt die Änderung ab morgen; heute bleibt die erste Fassung, das Startgewicht bleibt eines', async () => {
    const { plan, weights, goals, weeklyPlanDays, operations, reports } = await setup();

    expect(plan.hasPlanToday()).toBe(false);
    await plan.saveInitialPlan(draft);
    expect(plan.hasPlanToday()).toBe(true);
    reports.splice(0);
    await expect(plan.saveInitialPlan({ ...draft, weightG: 80_500, waterTargetMl: 2_000, sportDays: ['mittwoch'] })).resolves.toEqual({
      type: 'gespeichert',
      validFrom: '2026-10-15',
      goalVersionId: goalVersionId(philipp, day('2026-10-15')),
      weeklyPlanVersionId: weeklyPlanVersionId(philipp, day('2026-10-15')),
    });

    expect(weights.entries()).toEqual([expect.objectContaining({ entryId: startWeightEntry, weightG: 80_500 })]);
    expect(goals()).toEqual([
      expect.objectContaining({ validFrom: '2026-10-14', weightG: 80_000, waterTargetMl: 1_500 }),
      expect.objectContaining({ validFrom: '2026-10-15', weightG: 80_500, waterTargetMl: 2_000 }),
    ]);
    const mittwoch = (validFrom: string) =>
      weeklyPlanDays().find((row) => row.weekday === 'mittwoch' && row.weeklyPlanVersionId === weeklyPlanVersionId(philipp, day(validFrom)));
    expect(mittwoch('2026-10-14')).toMatchObject({ baustein3: 'im_kalorienbudget' });
    expect(mittwoch('2026-10-15')).toMatchObject({ baustein3: 'sporteinheit' });
    expect(operations().filter((operation) => operation.type === 'createGoalVersion')).toHaveLength(2);
    expect(reports.filter((report) => report.cause === 'planaenderung')).toEqual([{ personId: philipp, localDates: october(15, 27), cause: 'planaenderung' }]);
  });

  it('lehnt einen ungültigen Entwurf ab, bevor es etwas schreibt oder wiegt', async () => {
    const { plan, weightCalls, goals, operations, reports } = await setup();

    await expect(plan.saveInitialPlan({ ...draft, waterTargetMl: 1_600, weighDay: 'dienstag' })).resolves.toEqual({
      type: 'ungueltig',
      errors: ['water_target_not_on_step', 'weigh_day_is_sport_day'],
    });
    expect(weightCalls).toEqual([]);
    expect(goals()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(reports).toEqual([]);
  });

  it('schreibt nichts weiter, wenn der WeightRecorder das Startgewicht ablehnt', async () => {
    const { plan, goals, operations, ownPerson } = await setup({
      recorded: { type: 'contract_error', error: { code: 'invalid_payload', retryable: false } },
    });

    await expect(plan.saveInitialPlan(draft)).resolves.toEqual({
      type: 'startgewicht_abgelehnt',
      error: { code: 'invalid_payload', retryable: false },
    });
    expect(goals()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(ownPerson()).toMatchObject({ calculationSex: null });
  });

  it('rollt Person, Fassungen und Outbox gemeinsam zurück, wenn die Meldung scheitert; erneut speichern trifft dasselbe Startgewicht', async () => {
    const { plan, weights, goals, weeklyPlans, operations, ownPerson, failReevaluation } = await setup();
    failReevaluation();

    await expect(plan.saveInitialPlan(draft)).rejects.toThrow('Auswertung gescheitert');

    expect(goals()).toEqual([]);
    expect(weeklyPlans()).toEqual([]);
    expect(operations()).toEqual([]);
    expect(ownPerson()).toMatchObject({ calculationSex: null });
    expect(weights.entries()).toHaveLength(1);
  });
});

describe('Ziele ändern (#134)', () => {
  async function planned() {
    const context = await setup();
    await context.plan.saveInitialPlan(draft);
    context.reports.splice(0);
    return context;
  }

  it('legt eine vollständige Zielversion ab morgen an und meldet die Tage von morgen bis heute + 13 mit planaenderung', async () => {
    const { plan, goals, operations, reports } = await planned();

    expect(plan.changeGoals({ ...draft, waterTargetMl: 2_000 })).toEqual({
      type: 'gespeichert',
      validFrom: '2026-10-15',
      goalVersionId: goalVersionId(philipp, day('2026-10-15')),
    });

    expect(goals().find((goal) => goal.validFrom === '2026-10-15')).toEqual(expect.objectContaining({
      id: goalVersionId(philipp, day('2026-10-15')),
      calorieBudgetMilliKcal: 1_620_000,
      basalMetabolicRateMilliKcal: 1_514_000,
      totalEnergyExpenditureMilliKcal: 2_120_000,
      lowerBoundMilliKcal: 1_514_000,
      deficitMilliKcal: 500_000,
      budgetSource: 'berechnet',
      calculationSex: 'weiblich',
      ageYears: 35,
      heightCm: 168,
      weightG: 80_000,
      activityLevel: 'wenig_aktiv',
      maintenanceReason: null,
      pace: 'entspannt',
      goalWeightG: 76_000,
      waterTargetMl: 2_000,
      weeklySportTargetMinutes: 150,
      serverVersion: null,
    }));
    expect(goals().find((goal) => goal.validFrom === '2026-10-14')).toMatchObject({ waterTargetMl: 1_500 });
    expect(operations().filter((operation) => operation.type === 'createGoalVersion').at(-1)).toMatchObject({
      businessKey: expect.stringMatching(`^zielversion:${philipp}:2026-10-15:`),
      payload: { validFrom: '2026-10-15', waterTargetMl: 2_000 },
      knownServerVersion: null,
    });
    expect(reports).toEqual([{ personId: philipp, localDates: october(15, 27), cause: 'planaenderung' }]);
  });

  it('prüft wie beim Erstplan und schreibt bei ungültigem Entwurf nichts', async () => {
    const { plan, goals, operations, reports } = await planned();
    const before = operations();

    expect(plan.changeGoals({ ...draft, waterTargetMl: 1_600, heightCm: 119 })).toEqual({ type: 'ungueltig', errors: ['height_out_of_range'] });
    expect(plan.changeGoals({ ...draft, waterTargetMl: 1_600 })).toEqual({ type: 'ungueltig', errors: ['water_target_not_on_step'] });
    expect(plan.changeGoals({ ...draft, pregnantOrBreastfeeding: true, manualBudgetKcal: 1_700 })).toEqual({
      type: 'ungueltig',
      errors: ['manual_budget_in_forced_maintenance'],
    });

    expect(goals()).toHaveLength(1);
    expect(operations()).toEqual(before);
    expect(reports).toEqual([]);
  });

  it('eine weitere Änderung am selben Tag ersetzt die noch nicht wirksame Fassung, mit der bekannten Serverversion', async () => {
    const { plan, goals, operations, database } = await planned();

    plan.changeGoals({ ...draft, waterTargetMl: 2_000 });
    database.transaction((tx) => sqliteOf(tx).update(goalVersion).set({ serverVersion: '9' }).where(eq(goalVersion.validFrom, '2026-10-15')).run());
    expect(plan.changeGoals({ ...draft, waterTargetMl: 2_500, pace: 'zuegiger' })).toMatchObject({ type: 'gespeichert', validFrom: '2026-10-15' });

    expect(goals().filter((goal) => goal.validFrom === '2026-10-15')).toEqual([
      expect.objectContaining({ waterTargetMl: 2_500, pace: 'zuegiger', deficitMilliKcal: 750_000, calorieBudgetMilliKcal: 1_520_000 }),
    ]);
    const changes = operations().filter((operation) => operation.type === 'createGoalVersion' && operation.payload.validFrom === '2026-10-15');
    expect(changes.map((operation) => operation.knownServerVersion)).toEqual([null, '9']);
    // Jede Änderung trägt ihren eigenen fachlichen Schlüssel; sonst endete die zweite als operation_conflict.
    expect(new Set(changes.map((operation) => 'businessKey' in operation && operation.businessKey)).size).toBe(2);
  });

  it('legt keine Fassung an, wenn die Werte ab morgen ohnehin gelten', async () => {
    const { plan, goals, operations, reports } = await planned();
    const before = operations();

    expect(plan.changeGoals(draft)).toEqual({ type: 'unveraendert', validFrom: '2026-10-15' });
    plan.changeGoals({ ...draft, waterTargetMl: 2_000 });
    expect(plan.changeGoals({ ...draft, waterTargetMl: 2_000 })).toEqual({ type: 'unveraendert', validFrom: '2026-10-15' });

    expect(goals()).toHaveLength(2);
    expect(operations()).toHaveLength(before.length + 1);
    expect(reports).toHaveLength(1);
  });

  it('übernimmt das Budget eines angenommenen Budgetvorschlags samt Herkunft, solange der Entwurf es unverändert nennt', async () => {
    const { plan, goals, database } = await planned();
    // Heute gilt ein Budget aus einem angenommenen Vorschlag, außerhalb des 10-kcal-Rasters (#151 legt es an).
    database.transaction((tx) => sqliteOf(tx).update(goalVersion)
      .set({ calorieBudgetMilliKcal: 1_765_000, budgetSource: 'budgetvorschlag' }).where(eq(goalVersion.validFrom, '2026-10-14')).run());

    expect(plan.changeGoals({ ...draft, manualBudgetKcal: 1_765, waterTargetMl: 2_000 })).toMatchObject({ type: 'gespeichert' });
    expect(goals().find((goal) => goal.validFrom === '2026-10-15')).toMatchObject({
      calorieBudgetMilliKcal: 1_765_000,
      budgetSource: 'budgetvorschlag',
      waterTargetMl: 2_000,
    });

    // Am selben Tag ein anderes Budget: Es ist ein manuelles und muss ins Raster.
    expect(plan.changeGoals({ ...draft, manualBudgetKcal: 1_775, waterTargetMl: 2_000 })).toEqual({ type: 'ungueltig', errors: ['manual_budget_not_on_step'] });
    expect(plan.changeGoals({ ...draft, manualBudgetKcal: 1_770, waterTargetMl: 2_000 })).toMatchObject({ type: 'gespeichert' });
    expect(goals().find((goal) => goal.validFrom === '2026-10-15')).toMatchObject({ calorieBudgetMilliKcal: 1_770_000, budgetSource: 'manuell' });
  });

  it('lehnt das Budget eines Vorschlags im erzwungenen Haltemodus ab', async () => {
    const { plan, database } = await planned();
    database.transaction((tx) => sqliteOf(tx).update(goalVersion)
      .set({ calorieBudgetMilliKcal: 1_765_000, budgetSource: 'budgetvorschlag' }).where(eq(goalVersion.validFrom, '2026-10-14')).run());

    expect(plan.changeGoals({ ...draft, manualBudgetKcal: 1_765, knownEatingDisorder: true })).toEqual({
      type: 'ungueltig',
      errors: ['manual_budget_in_forced_maintenance'],
    });
  });

  it('verändert bereits materialisierte Tagesziele nicht; der nächste Tag entsteht mit den neuen Werten', async () => {
    const { plan, clock, dailyGoalsOn } = await planned();
    const today = dailyGoalsOn('2026-10-14');

    plan.changeGoals({ ...draft, waterTargetMl: 2_000 });
    expect(dailyGoalsOn('2026-10-14')).toEqual(today);

    clock.advanceBy(24 * 60 * 60 * 1_000);
    plan.ensureDailyGoals();
    expect(dailyGoalsOn('2026-10-14')).toEqual(today);
    expect(dailyGoalsOn('2026-10-15').find((goal) => goal.baustein === 'wasserziel')?.snapshot).toMatchObject({ targetMl: 2_000 });
  });
});

describe('Wochenplan ändern (#134)', () => {
  async function planned() {
    const context = await setup();
    await context.plan.saveInitialPlan(draft);
    context.reports.splice(0);
    return context;
  }

  /** Zweimal Wiegen pro Woche, kein Sporttag, Gewogen statt Wasser am Sonntag. */
  const freeWeek = {
    montag: ['gewogen', 'ernaehrung_erfasst', 'wasserziel'],
    dienstag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
    mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
    donnerstag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
    freitag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
    samstag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
    sonntag: ['ernaehrung_erfasst', 'gewogen', 'im_kalorienbudget'],
  } as const;

  it('belegt jeden Wochentag frei, mit mehreren Wiegetagen und ohne Sporttag, ab morgen samt Meldung der Tage', async () => {
    const { plan, planReader, operations, reports } = await planned();

    expect(plan.changeWeeklyPlan(freeWeek)).toEqual({
      type: 'gespeichert',
      validFrom: '2026-10-15',
      weeklyPlanVersionId: weeklyPlanVersionId(philipp, day('2026-10-15')),
    });

    await expect(planReader.effectivePlan(philipp, day('2026-10-14'))).resolves.toMatchObject({ weeklyPlanDay: { validFrom: '2026-10-14' } });
    await expect(planReader.effectivePlan(philipp, day('2026-10-18'))).resolves.toMatchObject({
      weeklyPlanDay: { validFrom: '2026-10-15', bausteine: ['ernaehrung_erfasst', 'gewogen', 'im_kalorienbudget'] },
    });
    await expect(planReader.effectivePlan(philipp, day('2026-10-19'))).resolves.toMatchObject({
      weeklyPlanDay: { bausteine: ['gewogen', 'ernaehrung_erfasst', 'wasserziel'] },
    });
    expect(operations().at(-1)).toMatchObject({
      type: 'createWeeklyPlanVersion',
      businessKey: expect.stringMatching(`^wochenplan:${philipp}:2026-10-15:`),
      payload: { validFrom: '2026-10-15', days: freeWeek },
      knownServerVersion: null,
    });
    expect(reports).toEqual([{ personId: philipp, localDates: october(15, 27), cause: 'planaenderung' }]);
  });

  it('lehnt Wochentage ohne drei verschiedene Bausteine ab und schreibt nichts', async () => {
    const { plan, weeklyPlans, reports } = await planned();

    expect(plan.changeWeeklyPlan({ ...freeWeek, montag: ['gewogen', 'gewogen', 'wasserziel'], freitag: ['wasserziel', 'gewogen', 'wasserziel'] })).toEqual({
      type: 'ungueltig',
      errors: [{ weekday: 'montag', error: 'bausteine_not_distinct' }, { weekday: 'freitag', error: 'bausteine_not_distinct' }],
    });
    expect(weeklyPlans()).toHaveLength(1);
    expect(reports).toEqual([]);
  });

  it('ersetzt am selben Tag die noch nicht wirksame Fassung und legt ohne Änderung nichts an', async () => {
    const { plan, weeklyPlans, weeklyPlanDays } = await planned();

    plan.changeWeeklyPlan(freeWeek);
    plan.changeWeeklyPlan({ ...freeWeek, mittwoch: ['sporteinheit', 'wasserziel', 'gewogen'] });
    expect(plan.changeWeeklyPlan({ ...freeWeek, mittwoch: ['sporteinheit', 'wasserziel', 'gewogen'] })).toEqual({ type: 'unveraendert', validFrom: '2026-10-15' });

    expect(weeklyPlans()).toHaveLength(2);
    expect(weeklyPlanDays().filter((row) => row.weeklyPlanVersionId === weeklyPlanVersionId(philipp, day('2026-10-15')))).toHaveLength(7);
    expect(weeklyPlanDays().find((row) => row.weekday === 'mittwoch' && row.weeklyPlanVersionId === weeklyPlanVersionId(philipp, day('2026-10-15'))))
      .toMatchObject({ baustein1: 'sporteinheit', baustein3: 'gewogen' });
  });
});

describe('Einstellungsansicht (#134)', () => {
  it('liefert die heute gültigen Fassungen und ohne Änderung keine bevorstehende', async () => {
    const { plan } = await setup();
    await plan.saveInitialPlan(draft);

    expect(plan.settings()).toEqual({
      today: '2026-10-14',
      goal: { current: expect.objectContaining({ validFrom: '2026-10-14', waterTargetMl: 1_500, calorieBudgetMilliKcal: 1_620_000 }), upcoming: null },
      weeklyPlan: {
        current: { validFrom: '2026-10-14', days: expect.objectContaining({ montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] }) },
        upcoming: null,
      },
    });
  });

  it('liefert eine bevorstehende Fassung „ab morgen“ samt den geänderten Werten und Wochentagen', async () => {
    const { plan } = await setup();
    await plan.saveInitialPlan(draft);

    plan.changeGoals({ ...draft, waterTargetMl: 2_000, pace: 'zuegiger' });
    plan.changeWeeklyPlan({
      montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
      dienstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
      mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
      donnerstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
      freitag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
      samstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
      sonntag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
    });

    const settings = plan.settings();
    expect(settings.goal.current).toMatchObject({ validFrom: '2026-10-14', waterTargetMl: 1_500 });
    expect(settings.goal.upcoming).toEqual({
      version: expect.objectContaining({ validFrom: '2026-10-15', waterTargetMl: 2_000, pace: 'zuegiger' }),
      changed: expect.arrayContaining(['waterTargetMl', 'pace', 'deficitMilliKcal', 'calorieBudgetMilliKcal']),
    });
    expect(settings.goal.upcoming?.changed).toHaveLength(4);
    expect(settings.weeklyPlan.upcoming).toMatchObject({ validFrom: '2026-10-15', changedWeekdays: ['freitag'] });
  });

  it('zeigt die Änderung am Folgetag als gültige Fassung ohne bevorstehende', async () => {
    const { plan, clock } = await setup();
    await plan.saveInitialPlan(draft);
    plan.changeGoals({ ...draft, waterTargetMl: 2_000 });

    clock.advanceBy(24 * 60 * 60 * 1_000);

    expect(plan.settings()).toMatchObject({
      today: '2026-10-15',
      goal: { current: { validFrom: '2026-10-15', waterTargetMl: 2_000 }, upcoming: null },
      weeklyPlan: { current: { validFrom: '2026-10-14' }, upcoming: null },
    });
  });
});

describe('Dauerhafte Ablehnung durch den Server', () => {
  it('entfernt eine nie bestätigte Fassung samt ihrer Tage; der Plan ist danach wieder leer', async () => {
    const { plan, planReader, database, commands, goals, weeklyPlans, weeklyPlanDays, operations } = await setup();
    await plan.saveInitialPlan(draft);

    const pending = operations();
    database.transaction((tx) => {
      for (const operation of pending) {
        if (!('businessKey' in operation)) continue;
        commands.reconcileRejected(tx, operation, {
          type: 'permanently_rejected',
          operationId: operation.operationId,
          error: { code: 'invalid_payload', retryable: false },
          canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId },
        });
      }
    });

    expect(goals()).toEqual([]);
    expect(weeklyPlans()).toEqual([]);
    expect(weeklyPlanDays()).toEqual([]);
    await expect(planReader.effectivePlan(philipp, day('2026-10-14'))).resolves.toEqual({ type: 'leer', localDate: '2026-10-14' });
  });

  it('erzeugt keinen Fachbefehl über die lokale Befehls-Registry; das darf nur das Plan-Modul', async () => {
    const { commands } = await setup();

    expect(() => commands.execute('createGoalVersion', 'zielversion:x', {})).toThrow();
  });
});

describe('PlanReader', () => {
  async function savedPlan() {
    const context = await setup();
    await context.plan.saveInitialPlan(draft);
    return context;
  }

  it('liefert vor der ersten Fassung ausdrücklich den Leer-Zustand', async () => {
    const { planReader } = await setup();

    await expect(planReader.effectivePlan(philipp, day('2026-10-14'))).resolves.toEqual({ type: 'leer', localDate: '2026-10-14' });
  });

  it('liefert an valid_from die Zielversion und den Wochenplantag, am Tag davor den Leer-Zustand', async () => {
    const { planReader } = await savedPlan();

    await expect(planReader.effectivePlan(philipp, day('2026-10-13'))).resolves.toEqual({ type: 'leer', localDate: '2026-10-13' });
    await expect(planReader.effectivePlan(philipp, day('2026-10-14'))).resolves.toEqual({
      type: 'gueltig',
      localDate: '2026-10-14',
      goal: {
        id: goalVersionId(philipp, day('2026-10-14')),
        validFrom: '2026-10-14',
        calorieBudgetMilliKcal: 1_620_000,
        lowerBoundMilliKcal: 1_514_000,
        maintenanceReason: null,
        pace: 'entspannt',
        goalWeightG: 76_000,
        waterTargetMl: 1_500,
        weeklySportTargetMinutes: 150,
      },
      weeklyPlanDay: {
        weeklyPlanVersionId: weeklyPlanVersionId(philipp, day('2026-10-14')),
        validFrom: '2026-10-14',
        bausteine: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
      },
    });
  });

  it('folgt am Wochentagswechsel dem Wochenplantag des jeweiligen Tags', async () => {
    const { planReader } = await savedPlan();

    const bausteine = async (value: string) => {
      const effective = await planReader.effectivePlan(philipp, day(value));
      return effective.type === 'gueltig' ? effective.weeklyPlanDay.bausteine : null;
    };
    expect(await bausteine('2026-10-18')).toEqual(['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget']);
    expect(await bausteine('2026-10-19')).toEqual(['ernaehrung_erfasst', 'wasserziel', 'gewogen']);
    expect(await bausteine('2026-10-20')).toEqual(['ernaehrung_erfasst', 'wasserziel', 'sporteinheit']);
  });

  it('nimmt am Wechsel und danach je Tag die Fassung mit dem größten valid_from ≤ Tag', async () => {
    const { plan, planReader } = await savedPlan();

    plan.changeGoals({ ...draft, waterTargetMl: 2_500 });

    await expect(planReader.effectivePlan(philipp, day('2026-10-14'))).resolves.toMatchObject({ goal: { validFrom: '2026-10-14', waterTargetMl: 1_500 } });
    await expect(planReader.effectivePlan(philipp, day('2026-10-15'))).resolves.toMatchObject({ goal: { validFrom: '2026-10-15', waterTargetMl: 2_500 } });
    await expect(planReader.effectivePlan(philipp, day('2026-11-30'))).resolves.toMatchObject({ goal: { validFrom: '2026-10-15' } });
  });

  it('meldet einen vertragswidrigen Stand wie die Port-Prüfung als PortContractError', async () => {
    const { planReader, database } = await savedPlan();
    database.transaction((tx) => sqliteOf(tx).delete(weeklyPlanDay).where(eq(weeklyPlanDay.weekday, 'mittwoch')).run());

    await expect(planReader.effectivePlan(philipp, day('2026-10-14'))).rejects.toThrow(PortContractError);
    await expect(planReader.effectivePlan(philipp, day('2026-10-15'))).resolves.toMatchObject({ type: 'gueltig' });
  });

  it('kennt nur die Fassungen der genannten Person', async () => {
    const { planReader } = await savedPlan();

    await expect(planReader.effectivePlan(EntityId.parse(randomUUID()), day('2026-10-14'))).resolves.toEqual({ type: 'leer', localDate: '2026-10-14' });
  });
});
