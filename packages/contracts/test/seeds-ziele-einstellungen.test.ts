import { describe, expect, it } from 'vitest';

import { seedDays, seedIds, seedManifests, type SeedScenarioKey } from '../seeds/index.ts';
import type { SeedRow } from '../seeds/manifest.ts';
import { LocalDate } from '../src/base.ts';
import { ageOn, calculateGoals } from '../src/goal-calculator.ts';
import { ActivityLevel, CalculationSex } from '../src/person.ts';
import { Pace } from '../src/ports.ts';
import { CreateGoalVersion } from '../src/plan.ts';

// Nachweis für #147: die Seed-Szenarien der Einstellungsseite „Ziele“ (Spezifikation 1, Abschnitt 12).
// Jede Zielversion passt zu ihren Eingaben im Zielrechner, wie der Server sie prüft; Person, Fassungen und
// Wiegungen zeigen den Zustand, den das Szenario verspricht. Dass Server und iPhone die Manifeste
// idempotent herstellen und erreichen, prüft `apps/backend/test/seed-manifeste-app.test.ts`.

const scenarios = [
  'solo-haltemodus-schwanger',
  'solo-haltemodus-essstoerung',
  'solo-haltemodus-untergewicht',
  'solo-budget-angehoben',
  'solo-ziele-ab-morgen',
] as const satisfies readonly SeedScenarioKey[];

const rows = (key: SeedScenarioKey, table: string): SeedRow[] => seedManifests[key].initial.devices['philipp-iphone']!.rows[table] ?? [];
const person = (key: SeedScenarioKey) => rows(key, 'person')[0]!;
const goals = (key: SeedScenarioKey) => [...rows(key, 'goal_version')].sort((a, b) => String(a.valid_from).localeCompare(String(b.valid_from)));

/** Die Zielversion als Nutzlast von `createGoalVersion`. */
const payloadOf = (row: SeedRow) => ({
  validFrom: row.valid_from, calorieBudgetMilliKcal: row.calorie_budget_milli_kcal, basalMetabolicRateMilliKcal: row.basal_metabolic_rate_milli_kcal,
  totalEnergyExpenditureMilliKcal: row.total_energy_expenditure_milli_kcal, lowerBoundMilliKcal: row.lower_bound_milli_kcal,
  deficitMilliKcal: row.deficit_milli_kcal, budgetSource: row.budget_source, calculationSex: row.calculation_sex, ageYears: row.age_years,
  heightCm: row.height_cm, weightG: row.weight_g, activityLevel: row.activity_level, maintenanceReason: row.maintenance_reason, pace: row.pace,
  goalWeightG: row.goal_weight_g, waterTargetMl: row.water_target_ml, weeklySportTargetMinutes: row.weekly_sport_target_minutes,
});

/** Nachrechnung mit den Sicherheitsangaben der Person, wie die Einstellungsseite sie zeigt. */
function recalculated(key: SeedScenarioKey, row: SeedRow) {
  const own = person(key);
  const validFrom = LocalDate.parse(String(row.valid_from));
  const calculation = calculateGoals({
    calculationDate: validFrom,
    calculationSex: CalculationSex.parse(row.calculation_sex),
    ageYears: ageOn(LocalDate.parse(String(own.birth_date)), validFrom),
    heightCm: Number(row.height_cm),
    weightG: Number(row.weight_g),
    weightTrendG: null,
    activityLevel: ActivityLevel.parse(row.activity_level),
    pregnantOrBreastfeeding: own.pregnant_or_breastfeeding === true,
    knownEatingDisorder: own.known_eating_disorder === true,
    goalWeightG: Number(row.goal_weight_g),
    pace: Pace.nullable().parse(row.pace),
    manualBudgetKcal: null,
    waterTargetMl: Number(row.water_target_ml),
    weeklySportTargetMinutes: Number(row.weekly_sport_target_minutes),
  });
  if (calculation.type === 'ungueltig') throw new Error(calculation.errors.join(', '));
  return calculation;
}

describe('Seed-Szenarien der Einstellungsseite „Ziele“ (#147)', () => {
  it.each(scenarios)('%s: Jede Zielversion passt zu ihren Eingaben, auf Server und iPhone gleich', (key) => {
    for (const row of goals(key)) expect(CreateGoalVersion.safeParse(payloadOf(row)).error?.issues ?? []).toEqual([]);
    expect(seedManifests[key].initial.server.goal_version).toEqual(expect.arrayContaining(goals(key).map((row) => expect.objectContaining({ id: row.id }))));
    expect(seedManifests[key].target).toEqual(seedManifests[key].initial);
  });

  it.each([
    ['solo-haltemodus-schwanger', 'schwanger_oder_stillend'],
    ['solo-haltemodus-essstoerung', 'essstoerung'],
    ['solo-haltemodus-untergewicht', 'untergewicht'],
  ] as const)('%s: erzwungener Haltemodus wegen %s', (key, trigger) => {
    const [goal] = goals(key);
    expect(goals(key)).toHaveLength(1);
    expect(goal).toMatchObject({ maintenance_reason: 'sicherheits_check', pace: null, deficit_milli_kcal: null });
    expect(recalculated(key, goal!).safetyTriggers).toEqual([trigger]);
  });

  it('solo-haltemodus-untergewicht: Die Wiegungen passen zum Gewicht der Berechnung', () => {
    expect(rows('solo-haltemodus-untergewicht', 'weight_entry').map((row) => row.weight_g)).toEqual([60_400, 60_000]);
  });

  it('solo-budget-angehoben: Die Rechnung lag unter der Untergrenze, das Budget ist angehoben', () => {
    const [goal] = goals('solo-budget-angehoben');
    expect(goal).toMatchObject({ calorie_budget_milli_kcal: 1_870_000, lower_bound_milli_kcal: 1_863_000, budget_source: 'berechnet', pace: 'zuegiger' });
    expect(recalculated('solo-budget-angehoben', goal!).budgetRaisedToLowerBound).toBe(true);
    expect(person('solo-budget-angehoben')).toMatchObject({ activity_level: 'wenig_aktiv' });
  });

  it('solo-ziele-ab-morgen: Die Fassung ab morgen ändert Tempo, Wasser und Sport und ist noch nicht wirksam', () => {
    const [today, tomorrow] = goals('solo-ziele-ab-morgen');
    expect(today).toMatchObject({ id: seedIds.goalVersion.philipp, valid_from: seedDays.zielstart, pace: 'entspannt', water_target_ml: 2_500 });
    expect(tomorrow).toMatchObject({ valid_from: '2026-10-15', pace: 'zuegiger', water_target_ml: 2_750, weekly_sport_target_minutes: 180 });
    // Wirksam wäre sie erst mit einem Tagesziel ab ihrem `valid_from` (Spezifikation 1, Abschnitt 4).
    expect(rows('solo-ziele-ab-morgen', 'daily_goal').every((row) => String(row.local_date) < '2026-10-15')).toBe(true);
  });

  it('die Tagesziele von heute passen zum Wasserziel der heute gültigen Fassung', () => {
    for (const key of scenarios) {
      const water = rows(key, 'daily_goal').find((row) => row.baustein === 'wasserziel');
      expect(water?.snapshot, key).toMatchObject({ targetMl: goals(key)[0]!.water_target_ml });
    }
  });
});
