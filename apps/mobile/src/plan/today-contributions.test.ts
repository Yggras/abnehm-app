/** @jest-environment node */
import { eq } from 'drizzle-orm';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { dailyGoalId } from '@abnehm/contracts/daily-goals';

import { createDailyGoalRegistry } from '../daily-goals';
import { goalVersion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { TodaySlot, TodayState } from '../shell/today-registry';
import type { Plan } from '.';
import { berlin, createPlanTodayWorld, draft, philipp, wednesday, wednesdayNoon, type PlanTodayWorld, type PlanTodayWorldOptions } from './testing/today-world';

// Nachweis für #136: die „Heute“-Beiträge des Plan-Moduls (Spezifikation 1, Abschnitt 6) an der
// „Heute“-Registry aus #109. Plan-Modul und Persistenzdienst laufen echt über einer SQLite-Datei mit
// den Migrationen der App und der Testuhr; die Bausteine werten die Test-Evaluatoren aus #104 aus.

const instant = (value: string) => Instant.parse(value);
const day = (value: string) => LocalDate.parse(value);

const worlds: PlanTodayWorld[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const world of worlds.splice(0)) world.close();
});

async function setup(options?: PlanTodayWorldOptions) {
  const clock = createTestClock({ instant: wednesdayNoon, timeZone: berlin });
  const world = await createPlanTodayWorld(clock, options);
  worlds.push(world);
  const observe = <K extends TodaySlot>(key: K) => {
    const states: TodayState<K>[] = [];
    stops.push(world.registry.subscribe(key, (state) => states.push(state)));
    return { states, latest: () => states.at(-1) };
  };
  return { ...world, clock, goals: observe('momo.daily_goals'), budget: observe('nutrition.budget') };
}

const areaAction = (target: object) => ({ actionId: 'tagesziel.open_area', target });
const retry = { actionId: 'today.retry', target: { type: 'today' } };

describe('momo.daily_goals', () => {
  it('lädt ohne eigene Person und ohne materialisierte Tagesziele eines gültigen Plans', async () => {
    const withoutPerson = await setup({ person: false });
    expect(withoutPerson.goals.latest()).toEqual({ type: 'loading' });

    const { goals, plan, clock, refresh, saveInitialPlan } = await setup();
    await saveInitialPlan();
    // Morgen gilt derselbe Plan, die Tagesziele entstehen aber erst mit dem nächsten Auslöser.
    clock.set(instant('2026-10-15T05:00:00.000Z'));
    refresh();
    expect(goals.latest()).toEqual({ type: 'loading' });

    plan.ensureDailyGoals();
    expect(goals.latest()).toMatchObject({ type: 'ready' });
  });

  it('ist ohne gültigen Plan leer: Vor dem ersten Plan entsteht nie ein Tagesziel', async () => {
    const { goals } = await setup();

    expect(goals.latest()).toEqual({ type: 'empty', reasonKey: 'ohne_zielversion' });
  });

  it('liefert genau drei nach Platz geordnete Tagesziele mit Zustand, Tagesende, Fortschritt, Erfüllung, messageKey und Aktion zum Bereich', async () => {
    const { goals, saveInitialPlan } = await setup();
    await saveInitialPlan();

    const state = goals.latest();
    expect(state?.type).toBe('ready');
    if (state?.type !== 'ready') return;
    expect(state.data.map((goal) => goal.slot)).toEqual([1, 2, 3]);
    expect(state.data[0]).toEqual({
      slot: 1,
      evaluation: {
        type: 'evaluated',
        currentState: 'offen',
        dayClosed: false,
        progress: { type: 'ernaehrung_erfasst', recordedMealCategories: 0, minimumMealCategories: 2 },
        messageKey: 'tagesziel.ernaehrung_erfasst.offen',
        values: { recordedMealCategories: 0, minimumMealCategories: 2 },
        completion: { type: 'nie' },
      },
      action: areaAction({ type: 'log' }),
    });
    expect(state.data[1]).toMatchObject({
      evaluation: { currentState: 'offen', progress: { type: 'wasserziel', countedMl: 0, targetMl: 1500 } },
      action: areaAction({ type: 'capture.water' }),
    });
    expect(state.data[2]).toMatchObject({
      evaluation: { currentState: 'tagesende', dayClosed: false, progress: { type: 'im_kalorienbudget', intakeKcal: 0 } },
      action: areaAction({ type: 'log' }),
    });
  });

  it('öffnet je Baustein seinen Bereich: Sport am Sporttag, Gewicht am Wiegetag', async () => {
    const { goals, clock, plan, saveInitialPlan } = await setup();
    await saveInitialPlan();

    clock.set(instant('2026-10-15T05:00:00.000Z'));
    plan.ensureDailyGoals();
    expect(goals.latest()).toMatchObject({ type: 'ready', data: [{}, {}, { evaluation: { progress: { type: 'sporteinheit' } }, action: areaAction({ type: 'capture.sport' }) }] });

    clock.set(instant('2026-10-19T05:00:00.000Z'));
    plan.ensureDailyGoals();
    expect(goals.latest()).toMatchObject({ type: 'ready', data: [{}, {}, { evaluation: { progress: { type: 'gewogen' } }, action: areaAction({ type: 'capture.weight' }) }] });
  });

  it('folgt jedem Commit und zeigt nach einer Korrektur den aktuellen Zustand samt festgehaltener Erfüllung', async () => {
    const { goals, enter, saveInitialPlan } = await setup();
    await saveInitialPlan();

    enter(wednesday, { countedMl: 1500 });
    expect(goals.latest()).toMatchObject({
      type: 'ready',
      data: [{}, { evaluation: { currentState: 'erfuellt', completion: { type: 'festgehalten', firstCompletedAt: wednesdayNoon } } }, {}],
    });

    enter(wednesday, { countedMl: 0 });
    expect(goals.latest()).toMatchObject({
      type: 'ready',
      data: [{}, { evaluation: { currentState: 'offen', completion: { type: 'festgehalten', firstCompletedAt: wednesdayNoon } } }, {}],
    });
  });

  it('wechselt auf Anstoß zum nächsten Tag und entscheidet „Im Kalorienbudget“ ab dem Tagesende', async () => {
    const { goals, clock, refresh, plan, saveInitialPlan } = await setup();
    await saveInitialPlan();

    // Reise nach Westen: In New York ist noch der 14., das Tagesende in Berlin ist aber erreicht.
    clock.set(instant('2026-10-14T23:00:00.000Z'));
    clock.setTimeZone(TimeZone.parse('America/New_York'));
    refresh();
    expect(goals.latest()).toMatchObject({ type: 'ready', data: [{}, {}, { evaluation: { currentState: 'offen', dayClosed: true } }] });

    clock.set(instant('2026-10-15T05:00:00.000Z'));
    refresh();
    expect(goals.latest()).toEqual({ type: 'loading' });
    plan.ensureDailyGoals();
    expect(goals.latest()).toMatchObject({ type: 'ready', data: [{}, {}, { evaluation: { progress: { type: 'sporteinheit' } } }] });
  });

  it('ergibt bei einem Vertragsfehler error mit Wiederholen', async () => {
    const { goals, saveInitialPlan } = await setup({ evaluator: () => createDailyGoalRegistry({ bausteine: [], checkIns: [] }) });
    await saveInitialPlan();

    expect(goals.latest()).toEqual({ type: 'error', code: 'unknown_catalog_key', retryAction: retry });
  });
});

describe('nutrition.budget', () => {
  /** Kalorienbudget der heute gültigen Zielversion in ganzen kcal. */
  const budgetOf = (plan: Plan) => Math.floor(plan.settings().goal.current!.calorieBudgetMilliKcal / 1_000);

  it('lädt ohne eigene Person und ist ohne gültigen Plan leer', async () => {
    expect((await setup({ person: false })).budget.latest()).toEqual({ type: 'loading' });
    expect((await setup()).budget.latest()).toEqual({ type: 'empty', reasonKey: 'ohne_zielversion' });
  });

  it('liefert das Budget aus dem Tagesziel-Snapshot des Tags, auch wenn die Zielversion inzwischen abweicht', async () => {
    const { budget, database, plan, saveInitialPlan } = await setup();
    await saveInitialPlan();
    const snapshotBudget = budgetOf(plan);
    expect(budget.latest()).toEqual({ type: 'ready', data: { budgetKcal: snapshotBudget, maintenanceReason: null } });

    // Eine kanonische Fassung vom Server ändert die Zielversion des Tags; der Snapshot bleibt.
    database.transaction((tx) => sqliteOf(tx).update(goalVersion).set({ calorieBudgetMilliKcal: 1_900_000 }).where(eq(goalVersion.personId, philipp)).run());
    expect(budget.latest()).toEqual({ type: 'ready', data: { budgetKcal: snapshotBudget, maintenanceReason: null } });
  });

  it('nimmt das Budget aus dem PlanReader, wenn der Tag kein „Im Kalorienbudget“ hat oder noch nicht materialisiert ist', async () => {
    const { budget, clock, plan, refresh, saveInitialPlan } = await setup();
    await saveInitialPlan();
    expect(plan.changeGoals({ ...draft, manualBudgetKcal: 1700 })).toMatchObject({ type: 'gespeichert' });

    // Donnerstag ist Sporttag: Platz 3 ist die Sporteinheit.
    clock.set(instant('2026-10-15T05:00:00.000Z'));
    refresh();
    expect(budget.latest()).toEqual({ type: 'ready', data: { budgetKcal: 1700, maintenanceReason: null } });
    plan.ensureDailyGoals();
    expect(budget.latest()).toEqual({ type: 'ready', data: { budgetKcal: 1700, maintenanceReason: null } });
  });

  it('meldet den Haltemodus samt Grund', async () => {
    const { budget, saveInitialPlan } = await setup();
    await saveInitialPlan({ pace: null, goalWeightG: null });

    expect(budget.latest()).toMatchObject({ type: 'ready', data: { maintenanceReason: 'gewaehlt' } });
  });

  it('trägt höchstens einen Hinweis; „Zielgewicht erreicht“ geht vor dem Budgetvorschlag', async () => {
    const suggestionId = dailyGoalId(philipp, day('2026-10-14'), 1);
    const shown = { goalWeightReached: false, budgetSuggestion: false };
    const goalReached = { type: 'goal_weight_reached', action: { actionId: 'plan.open_goal_reached', target: { type: 'plan.goal_reached' } } } as const;
    const suggestion = {
      type: 'budget_suggestion',
      suggestionId,
      suggestedBudgetKcal: 1470,
      action: { actionId: 'plan.open_budget_suggestion', target: { type: 'plan.budget_suggestion', suggestionId } },
    } as const;
    const { budget, database, saveInitialPlan } = await setup({
      notices: {
        goalWeightReached: () => (shown.goalWeightReached ? goalReached : null),
        budgetSuggestion: () => (shown.budgetSuggestion ? suggestion : null),
      },
    });
    await saveInitialPlan();
    const noticeNow = () => {
      database.transaction(() => {});
      const state = budget.latest();
      return state?.type === 'ready' ? state.data.notice : 'kein ready';
    };

    expect(noticeNow()).toBeUndefined();
    shown.budgetSuggestion = true;
    expect(noticeNow()).toEqual(suggestion);
    shown.goalWeightReached = true;
    expect(noticeNow()).toEqual(goalReached);
    shown.budgetSuggestion = false;
    expect(noticeNow()).toEqual(goalReached);
  });

  it('ergibt bei einem Vertragsfehler der Zielversion error mit Wiederholen', async () => {
    const { budget, database, saveInitialPlan } = await setup();
    await saveInitialPlan();

    // Ein Zielgewicht von 10 kg lässt die Datenbank zu, der Vertrag des `PlanReader` aber nicht.
    database.transaction((tx) => sqliteOf(tx).update(goalVersion).set({ goalWeightG: 10_000 }).where(eq(goalVersion.personId, philipp)).run());
    expect(budget.latest()).toEqual({ type: 'error', code: 'invalid_payload', retryAction: retry });
  });
});
