import { describe, expect, it } from 'vitest';

import { seedDayEnds } from '../seeds/ids.ts';
import { seedClock, seedDays, seedIds, seedManifests, type SeedRow, type SeedScenarioKey } from '../seeds/index.ts';
import { DailyGoalSnapshot } from '../src/daily-goals.ts';
import { dailyIntakeKcal } from '../src/nutrition.ts';
import { minimumMealCategoriesPerDay } from '../src/plan.ts';

// Nachweis für #166 auf Manifest-Ebene: Die Randzustände der Ernährung beschreiben, was sie heißen.
// Dass Server und Geräte sie über die echten Operationen und die echten Evaluatoren der Ernährung so
// erreichen, prüfen `apps/backend/test/seed-manifeste-app.test.ts` und, fachlich,
// `apps/backend/test/seed-randzustaende-app.test.ts`.

const iphone = 'philipp-iphone';

const rowsOf = (scenario: SeedScenarioKey, state: 'initial' | 'target', table: string, side: 'server' | typeof iphone = iphone): SeedRow[] => {
  const manifest = seedManifests[scenario];
  return (side === 'server' ? manifest[state].server[table] : manifest[state].devices[side]!.rows[table]) ?? [];
};
/** Nicht gelöschte Ernährungseinträge von heute. */
const mealsToday = (rows: readonly SeedRow[]) => rows.filter((row) => row.local_date === seedDays.heute && row.deleted_at === null);
const mealCount = (rows: readonly SeedRow[]) => new Set(mealsToday(rows).map((row) => row.meal)).size;
const intakeKcal = (rows: readonly SeedRow[]) => dailyIntakeKcal(mealsToday(rows).map((row) => Number(row.total_milli_kcal)));
const goalsToday = (scenario: SeedScenarioKey) => rowsOf(scenario, 'initial', 'daily_goal', 'server').filter((goal) => goal.local_date === seedDays.heute);

const ernaehrung = ['ernaehrung-offen', 'ernaehrung-teilweise', 'ernaehrung-erfuellt', 'ernaehrung-nach-erfuellung-korrigiert'] as const;
const kalorienbudget = ['kalorienbudget-unter-untergrenze', 'kalorienbudget-im-budget', 'kalorienbudget-ueber-budget'] as const;

describe('Randzustände der Ernährung (#166)', () => {
  it.each([...ernaehrung, ...kalorienbudget])('%s: Philipp allein mit fester Uhr, ohne Wasser und Sport von heute, mit gültigen Snapshots', (scenario) => {
    const manifest = seedManifests[scenario];
    expect(manifest.clock).toEqual(seedClock);
    expect(manifest.accounts.map(({ key }) => key)).toEqual(['philipp']);
    expect(manifest.installations.map(({ key }) => key)).toEqual([iphone]);
    for (const table of ['water_entry', 'sport_entry']) {
      expect(rowsOf(scenario, 'initial', table, 'server').filter((row) => row.local_date === seedDays.heute)).toEqual([]);
    }
    for (const goal of goalsToday(scenario)) expect(DailyGoalSnapshot.safeParse(goal.snapshot).success).toBe(true);
  });

  it.each(ernaehrung)('%s: „Ernährung erfasst“ heute auf Platz 1 mit der Schwelle der Materialisierung', (scenario) => {
    const [first] = goalsToday(scenario);
    expect(first).toMatchObject({ slot: 1, baustein: 'ernaehrung_erfasst', snapshot: { minimumMealCategories: minimumMealCategoriesPerDay } });
  });

  it.each([
    ['ernaehrung-offen', 0],
    ['ernaehrung-teilweise', 1],
  ] as const)('%s: %i Mahlzeiten; die App-Öffnung legt nichts an', (scenario, meals) => {
    const manifest = seedManifests[scenario];
    expect(mealCount(rowsOf(scenario, 'initial', 'nutrition_entry', 'server'))).toBe(meals);
    expect(manifest.steps).toEqual([{ type: 'tagesziele_auswerten', installation: iphone, localDates: [seedDays.heute], cause: 'app_oeffnung', operationIds: [] }]);
    expect(manifest.target).toEqual(manifest.initial);
  });

  it('ernaehrung-erfuellt: zwei Mahlzeiten; die App-Öffnung erfüllt Platz 1 lokal und schreibt den Fachbefehl', () => {
    const manifest = seedManifests['ernaehrung-erfuellt'];
    expect(mealCount(rowsOf('ernaehrung-erfuellt', 'initial', 'nutrition_entry', 'server'))).toBe(2);
    expect(rowsOf('ernaehrung-erfuellt', 'initial', 'daily_goal_completion', 'server')).toEqual([]);
    expect(manifest.target.server).toEqual(manifest.initial.server);
    expect(rowsOf('ernaehrung-erfuellt', 'target', 'daily_goal_completion')).toEqual([
      expect.objectContaining({ slot: 1, baustein: 'ernaehrung_erfasst', first_completed_at: seedClock.instant, server_version: null }),
    ]);
    expect(rowsOf('ernaehrung-erfuellt', 'target', 'energy_booking').map((row) => row.type)).toEqual(['daily_goal_credit']);
    expect(manifest.target.devices[iphone]!.outbox.map(({ type, operationId }) => [type, operationId])).toEqual([['completeDailyGoal', seedIds.operation.ernaehrungErfuellt[0]]]);
  });

  it('ernaehrung-nach-erfuellung-korrigiert: Der Sync übernimmt das gelöschte Mittagessen, Erfüllung und +1 bleiben', () => {
    const scenario = 'ernaehrung-nach-erfuellung-korrigiert';
    expect(seedManifests[scenario].steps).toEqual([{ type: 'sync', installation: iphone }]);
    expect(mealCount(rowsOf(scenario, 'initial', 'nutrition_entry'))).toBe(2);
    expect(mealCount(rowsOf(scenario, 'initial', 'nutrition_entry', 'server'))).toBe(1);
    expect(mealCount(rowsOf(scenario, 'target', 'nutrition_entry'))).toBe(1);
    for (const table of ['daily_goal_completion', 'energy_booking']) {
      expect(rowsOf(scenario, 'target', table)).toEqual(rowsOf(scenario, 'initial', table));
    }
    expect(rowsOf(scenario, 'target', 'daily_goal_completion')).toEqual([expect.objectContaining({ slot: 1, first_completed_at: '2026-10-14T11:00:00.000Z' })]);
    expect(rowsOf(scenario, 'target', 'energy_booking').map((row) => row.type)).toEqual(['daily_goal_credit']);
  });

  it.each([
    ['kalorienbudget-unter-untergrenze', 1_881, false],
    ['kalorienbudget-im-budget', 2_010, true],
    ['kalorienbudget-ueber-budget', 2_418, false],
  ] as const)('%s: %i kcal vor dem Tagesende; der Tagesabschluss danach erfüllt das Budget: %s', (scenario, kcal, completes) => {
    const manifest = seedManifests[scenario];
    const [budget] = goalsToday(scenario);
    expect(budget).toMatchObject({ slot: 1, baustein: 'im_kalorienbudget', snapshot: { budgetKcal: 2_417, lowerBoundKcal: 1_882, dayEndsAt: seedDayEnds.heute } });
    expect(intakeKcal(rowsOf(scenario, 'initial', 'nutrition_entry', 'server'))).toBe(kcal);
    expect(Date.parse(seedClock.instant)).toBeLessThan(Date.parse(seedDayEnds.heute));

    expect(manifest.steps).toEqual([expect.objectContaining({ type: 'tagesziele_auswerten', localDates: [seedDays.heute], cause: 'tagesabschluss' })]);
    const [step] = manifest.steps;
    expect(Date.parse(step?.type === 'tagesziele_auswerten' ? (step.at ?? '') : '')).toBeGreaterThan(Date.parse(seedDayEnds.heute));

    if (!completes) {
      expect(manifest.target).toEqual(manifest.initial);
      return;
    }
    expect(rowsOf(scenario, 'target', 'daily_goal_completion')).toEqual([
      expect.objectContaining({ slot: 1, baustein: 'im_kalorienbudget', first_completed_at: '2026-10-14T22:30:00.000Z', server_version: null }),
    ]);
    expect(manifest.target.devices[iphone]!.outbox.map(({ type, operationId }) => [type, operationId])).toEqual([['completeDailyGoal', seedIds.operation.kalorienbudgetInnerhalb[0]]]);
  });
});
