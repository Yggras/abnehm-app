import { describe, expect, it } from 'vitest';

import { budgetvorschlagBudget, budgetvorschlagReadings, seedDays, seedIds, seedManifests } from '../seeds/index.ts';
import type { SeedRow } from '../seeds/manifest.ts';
import { EntityId, LocalDate } from '../src/base.ts';
import { budgetSuggestionId, BudgetSuggestionUpsert, CreateGoalVersion } from '../src/plan.ts';
import { weightTrend } from '../src/tracker-rules.ts';

// Nachweis für #150: die Seed-Szenarien „Budgetvorschlag fällig“ (Spezifikation 1, Abschnitt 12). Ihr
// Ausgangszustand erfüllt jede Voraussetzung der Prüfung aus Abschnitt 7, mit Abstand zu den Schwellen; der
// Sollzustand nennt den offenen Vorschlag samt Upsert. Dass das Plan-Modul ihn mit den Fixture-Adaptern aus
// #104 erreicht, prüft `apps/mobile/src/plan/budget-suggestion-seeds.test.ts`; mit den echten Readern und
// idempotent wiederholt `apps/backend/test/seed-manifeste-app.test.ts`.

const scenarios = ['budgetvorschlag-senken', 'budgetvorschlag-anheben'] as const;
const iphone = 'philipp-iphone';

const rows = (key: (typeof scenarios)[number], table: string, state: 'initial' | 'target' = 'initial'): SeedRow[] =>
  seedManifests[key][state].devices[iphone]!.rows[table] ?? [];

/** Die Tage vom ersten bis zum letzten Tag einschließlich. */
function daysFrom(from: string, to: string): number {
  return (Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8))) / 86_400_000;
}

const sections = [['2026-09-23', '2026-09-29'], ['2026-09-30', '2026-10-06'], ['2026-10-07', '2026-10-13']] as const;

describe('Seed-Szenarien „Budgetvorschlag fällig“ (#150)', () => {
  it.each(scenarios)('%s: eine Zielversion aus dem Zielrechner seit dem 16.09., nicht im Haltemodus', (key) => {
    const goals = rows(key, 'goal_version');
    expect(goals).toHaveLength(1);
    const [goal] = goals;
    expect(goal).toMatchObject({ valid_from: '2026-09-16', pace: 'entspannt', maintenance_reason: null, calorie_budget_milli_kcal: budgetvorschlagBudget.previousMilliKcal });
    // 21 Tage vor heute liegt der 23.09.: Die Fassung gilt seit 28 Tagen, ihr Budget ebenso.
    expect(daysFrom(String(goal!.valid_from), seedDays.heute)).toBe(28);
    const payload = Object.fromEntries(Object.entries(goal!).filter(([column]) => !['id', 'person_id', 'created_at', 'updated_at', 'deleted_at', 'server_version'].includes(column))
      .map(([column, value]) => [column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value]));
    expect(CreateGoalVersion.safeParse(payload).error?.issues ?? []).toEqual([]);
    expect(budgetvorschlagBudget.senkenMilliKcal).toBeGreaterThanOrEqual(Number(goal!.lower_bound_milli_kcal));
    expect(budgetvorschlagBudget.anhebenMilliKcal).toBeLessThanOrEqual(Number(goal!.total_energy_expenditure_milli_kcal));
  });

  it.each(scenarios)('%s: drei Tagesgewichte je Abschnitt, die Fixture-Eingaben entsprechen den Gewichtseinträgen', (key) => {
    const weighings = rows(key, 'weight_entry').map((row) => ({ localDate: String(row.local_date), weightG: Number(row.weight_g) }));
    expect(weighings).toEqual(budgetvorschlagReadings(key).dayWeights);
    for (const [from, to] of sections) expect(weighings.filter(({ localDate }) => localDate >= from && localDate <= to)).toHaveLength(3);
  });

  it('der Trendverlust liegt deutlich unter 0,5 × bzw. über 1,5 × Soll (0,5 kg/Woche bei „entspannt“)', () => {
    const lossPerWeek = (key: (typeof scenarios)[number]) => {
      const window = weightTrend(budgetvorschlagReadings(key).dayWeights).filter(({ localDate }) => localDate >= '2026-09-23' && localDate <= '2026-10-13');
      const first = window[0]!;
      const last = window.at(-1)!;
      return ((first.trendG - last.trendG) / daysFrom(first.localDate, last.localDate)) * 7;
    };
    expect(lossPerWeek('budgetvorschlag-senken')).toBeLessThan(250 / 2);
    expect(lossPerWeek('budgetvorschlag-anheben')).toBeGreaterThan(750 + 200);
  });

  it.each(scenarios)('%s: zwölf erfasste Tage mit zwei Mahlzeitenkategorien, zehn davon im Budget; die Fixture-Eingaben entsprechen den Einträgen', (key) => {
    const byDay = new Map<string, { intakeMilliKcal: number; meals: Set<string> }>();
    for (const row of rows(key, 'nutrition_entry')) {
      const day = byDay.get(String(row.local_date)) ?? { intakeMilliKcal: 0, meals: new Set<string>() };
      day.intakeMilliKcal += Number(row.total_milli_kcal);
      day.meals.add(String(row.meal));
      byDay.set(String(row.local_date), day);
    }
    const fromRows = Object.fromEntries([...byDay].map(([localDate, day]) => [localDate, { intakeMilliKcal: day.intakeMilliKcal, recordedMealCategories: day.meals.size }]));
    expect(fromRows).toEqual(budgetvorschlagReadings(key).intake);
    const days = Object.entries(fromRows);
    expect(days.every(([localDate]) => localDate >= '2026-09-23' && localDate <= '2026-10-13')).toBe(true);
    expect(days.filter(([, day]) => day.recordedMealCategories >= 2)).toHaveLength(12);
    expect(days.filter(([, day]) => day.intakeMilliKcal <= budgetvorschlagBudget.previousMilliKcal)).toHaveLength(10);
  });

  it.each([
    ['budgetvorschlag-senken', 'senken', budgetvorschlagBudget.senkenMilliKcal, seedIds.operation.budgetvorschlag.senken],
    ['budgetvorschlag-anheben', 'anheben', budgetvorschlagBudget.anhebenMilliKcal, seedIds.operation.budgetvorschlag.anheben],
  ] as const)('%s: der Sollzustand nennt den offenen Vorschlag, seinen Upsert und den Tag der Prüfung; der Server bleibt', (key, direction, suggested, operationId) => {
    const manifest = seedManifests[key];
    const id = budgetSuggestionId(EntityId.parse(seedIds.person.philipp), LocalDate.parse('2026-10-13'));
    const payload = { periodFrom: '2026-09-23', periodTo: '2026-10-13', previousBudgetMilliKcal: 2_510_000, suggestedBudgetMilliKcal: suggested, direction, status: 'offen' };

    expect(rows(key, 'budget_suggestion')).toEqual([]);
    expect(rows(key, 'budget_suggestion', 'target')).toEqual([expect.objectContaining({ id, status: 'offen', direction, suggested_budget_milli_kcal: suggested, server_version: null })]);
    expect(BudgetSuggestionUpsert.safeParse(payload).success).toBe(true);
    expect(manifest.target.devices[iphone]!.outbox).toEqual([expect.objectContaining({ type: 'upsert_entity', operationId, entityType: 'budget_suggestion', entityId: id, payload })]);
    expect(rows(key, 'device_state', 'target')).toEqual([{ key: 'plan.budgetvorschlag_geprueft_am', value: seedDays.heute, updated_at: manifest.clock.instant }]);
    expect(manifest.target.server).toEqual(manifest.initial.server);
    expect(manifest.steps).toEqual([{ type: 'budgetvorschlag_pruefen', installation: iphone, operationIds: [operationId] }]);
  });
});
