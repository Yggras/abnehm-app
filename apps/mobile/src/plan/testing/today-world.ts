import { randomUUID } from 'node:crypto';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCompletionEntity, type DailyGoalPersistence, type DailyGoalRegistry } from '../../daily-goals';
import { insertPersonForTest } from '../../daily-goals/testing/persisted';
import { createTestFactsStore, testBausteinEvaluators, testCheckInEvaluators, type TestDayFacts } from '../../daily-goals/testing/test-evaluators';
import { energyBookingEntity } from '../../energy';
import type { LocalDatabase } from '../../local-db';
import { createLocalDatabases } from '../../local-db/local-databases';
import { createBetterSqliteFiles } from '../../local-db/testing/better-sqlite';
import { createTodayRegistry, type TodayRegistry } from '../../shell/today-registry';
import { createSyncRegistry, createSyncWriter, personEntity } from '../../sync';
import { budgetSuggestionEntity, createPlan, goalVersionEntity, weeklyPlanVersionEntity, type InitialPlanDraft, type Plan } from '..';
import { createPlanToday, type BudgetNoticeReaders } from '../today-contributions';

// Testaufbau der „Heute“-Beiträge des Plan-Moduls (#136): echte SQLite-Datei mit den Migrationen der App,
// die Uhr des Tests, echtes Plan-Modul samt Persistenzdienst der Tagesziele und die Test-Evaluatoren aus
// #104, deren Fakten der Test setzt. Die Beiträge hängen an einer eigenen „Heute“-Registry; `refresh` stößt sie an
// wie im Betrieb der Minutentakt.

export const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
export const berlin = TimeZone.parse('Europe/Berlin');
/** Startzeit der Testuhr: Mittwoch, 14.10.2026, 12:00 in Berlin (UTC+2); Plätze Ernährung erfasst, Wasserziel, Im Kalorienbudget. */
export const wednesdayNoon = Instant.parse('2026-10-14T10:00:00.000Z');
export const wednesday = LocalDate.parse('2026-10-14');

/** Referenzfall der Recherche (Frau, 35, 168 cm, 80 kg, wenig aktiv, entspannt); Sport Di/Do/Sa, Wiegen montags. */
export const draft: InitialPlanDraft = {
  startWeightEntryId: EntityId.parse('1f3e5d7c-9b8a-4c6e-8f2d-1e3c5a7b9d01'),
  calculationSex: 'weiblich',
  birthDate: LocalDate.parse('1991-03-02'),
  heightCm: 168,
  weightG: 80_000,
  activityLevel: 'wenig_aktiv',
  pregnantOrBreastfeeding: false,
  knownEatingDisorder: false,
  goalWeightG: 76_000,
  pace: 'entspannt',
  manualBudgetKcal: null,
  waterTargetMl: 1500,
  weeklySportTargetMinutes: null,
  sportDays: ['dienstag', 'donnerstag', 'samstag'],
  weighDay: 'montag',
};

export type PlanTodayWorldOptions = Readonly<{
  /** Ohne eigene Person wie vor dem ersten Pull. */
  person?: boolean;
  /** Registry der Beiträge; ohne Angabe dieselbe wie im Persistenzdienst. */
  evaluator?: (registry: DailyGoalRegistry) => Pick<DailyGoalRegistry, 'evaluateDailyGoal'>;
  /** Hinweis-Leser statt der des Moduls, etwa bis #152 „Zielgewicht erreicht“ liefert; ohne Angabe die des Moduls über `Plan.today`. */
  notices?: BudgetNoticeReaders;
}>;

export type PlanTodayWorld = Readonly<{
  database: LocalDatabase;
  plan: Plan;
  persistence: DailyGoalPersistence;
  /** „Heute“-Registry mit `momo.daily_goals` und `nutrition.budget` dieses Plan-Moduls. */
  registry: TodayRegistry;
  /** Stößt beide Beiträge ohne Datenbankänderung an. */
  refresh(): void;
  /** Erstplan zur aktuellen Zeit der Uhr; er materialisiert den Tag wie Onboarding-Schritt 8. */
  saveInitialPlan(changes?: Partial<InitialPlanDraft>): Promise<void>;
  /** Eine Eingabe eines Bereichs: setzt seine Tagesfakten und meldet den Tag in derselben Transaktion. */
  enter(localDate: LocalDate, facts: Partial<TestDayFacts>): void;
  close(): void;
}>;

/** Neue Welt über der Uhr des Tests, in der Regel der Testuhr; `close` sperrt die Datenbank und löscht ihre Datei. */
export async function createPlanTodayWorld(
  clock: Clock,
  { person = true, evaluator = (registry) => registry, notices }: PlanTodayWorldOptions = {},
): Promise<PlanTodayWorld> {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_a');
  if (person) database.transaction((tx) => insertPersonForTest(tx, philipp));
  const newId = () => EntityId.parse(randomUUID());
  const facts = createTestFactsStore();
  const dailyGoals = createDailyGoalRegistry({
    bausteine: Object.values(testBausteinEvaluators(facts.read)),
    checkIns: Object.values(testCheckInEvaluators(facts.read)),
  });
  const writer = createSyncWriter({
    registry: createSyncRegistry([personEntity, goalVersionEntity, weeklyPlanVersionEntity, budgetSuggestionEntity, dailyGoalCompletionEntity, energyBookingEntity]),
    clock,
    newId,
  });
  const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: dailyGoals, clock, writer, dispatcher });
  const plan = createPlan({
    database,
    clock,
    writer,
    newId,
    persistence,
    weightRecorder: { recordManualWeight: async (input) => ({ type: 'recorded', entryId: input.entryId, localDate: LocalDate.parse(clock.read().localDate) }) },
  });
  persistence.registerMissingDaysHook(plan.materializeMissingDays);

  const updates = new Set<() => void>();
  const refresh = (update: () => void) => {
    updates.add(update);
    return () => updates.delete(update);
  };
  const today = notices === undefined
    ? plan.today(evaluator(dailyGoals))
    : createPlanToday({ database, clock, dailyGoals: evaluator(dailyGoals) }, notices);
  const registry = createTodayRegistry();
  registry.register('ziele', 'momo.daily_goals', today.dailyGoals(refresh));
  registry.register('ziele', 'nutrition.budget', today.budget(refresh));

  return {
    database,
    plan,
    persistence,
    registry,
    refresh() {
      for (const update of updates) update();
    },
    async saveInitialPlan(changes = {}) {
      const saved = await plan.saveInitialPlan({ ...draft, ...changes });
      if (saved.type !== 'gespeichert') throw new Error(`Erstplan nicht gespeichert: ${saved.type}`);
    },
    enter(localDate, dayFacts) {
      database.transaction((tx) => {
        facts.set(philipp, localDate, dayFacts);
        persistence.reevaluateDailyGoals(tx, philipp, [localDate], 'eingabe');
      });
    },
    close() {
      databases.lock();
      files.remove();
    },
  };
}
