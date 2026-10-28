import { BausteinKey, EntityId, LocalDate, Weekday } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';
import { seedManifests, type SeedManifest, type SeedRow } from '@abnehm/contracts/seeds';

import { fakeAreaPorts, fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';

// PlanReader-Attrappe der Test-Artefakte (#171). Bis Spezifikation 1 ihren `PlanReader` anmeldet,
// liefert sie Zielversion und Wochenplan aus den Seed-Manifesten, je Person und ohne Zustand: So gilt
// sie auch nach einem Neustart der App. Sie ist der Fake-Port aus #104 samt Vertragsprüfung und liest
// keine Tabellen eines anderen Bereichs. Es gibt sie nur im Development- und im E2E-Build.

const label = 'PlanReader-Attrappe';

/** PlanReader über die Zielversionen und Wochenpläne aller Manifeste; dieselbe ID muss überall gleich sein. */
export function seedPlanReader(manifests: readonly SeedManifest[] = Object.values(seedManifests)): PlanReader {
  const goals = unique(manifests.flatMap((manifest) => manifest.initial.server.goal_version ?? []));
  const plans = unique(manifests.flatMap((manifest) => manifest.initial.server.weekly_plan_version ?? []));
  const days = manifests.flatMap((manifest) => manifest.initial.server.weekly_plan_day ?? []);
  return fakeAreaPorts({
    planReader: fakePlanReader({ goals: goals.map(goalOf), weeklyPlans: plans.map((plan) => weeklyPlanOf(plan, days)) }),
  }).planReader;
}

function unique(rows: readonly SeedRow[]): SeedRow[] {
  const byId = new Map<string, SeedRow>();
  for (const row of rows) {
    const known = byId.get(String(row.id));
    if (known !== undefined && JSON.stringify(known) !== JSON.stringify(row)) {
      throw new Error(`${label}: Zeile ${String(row.id)} weicht zwischen Seed-Manifesten ab`);
    }
    byId.set(String(row.id), row);
  }
  return [...byId.values()];
}

function goalOf(row: SeedRow): FakeGoalVersion {
  return {
    id: EntityId.parse(row.id),
    personId: EntityId.parse(row.person_id),
    validFrom: LocalDate.parse(row.valid_from),
    calorieBudgetMilliKcal: row.calorie_budget_milli_kcal as number,
    lowerBoundMilliKcal: row.lower_bound_milli_kcal as number,
    maintenanceReason: row.maintenance_reason as FakeGoalVersion['maintenanceReason'],
    pace: row.pace as FakeGoalVersion['pace'],
    goalWeightG: row.goal_weight_g as number,
    waterTargetMl: row.water_target_ml as number,
    weeklySportTargetMinutes: row.weekly_sport_target_minutes as number,
  };
}

function weeklyPlanOf(row: SeedRow, days: readonly SeedRow[]): FakeWeeklyPlanVersion {
  const ownDays = days.filter((day) => day.weekly_plan_version_id === row.id);
  return {
    id: EntityId.parse(row.id),
    personId: EntityId.parse(row.person_id),
    validFrom: LocalDate.parse(row.valid_from),
    days: Object.fromEntries(
      Weekday.options.map((weekday) => {
        const day = ownDays.find((candidate) => candidate.weekday === weekday);
        if (day === undefined) throw new Error(`${label}: Wochenplan ${String(row.id)} ohne ${weekday}`);
        return [weekday, [BausteinKey.parse(day.baustein_1), BausteinKey.parse(day.baustein_2), BausteinKey.parse(day.baustein_3)]];
      }),
    ) as FakeWeeklyPlanVersion['days'],
  };
}
