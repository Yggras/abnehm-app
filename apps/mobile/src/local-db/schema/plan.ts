import { sql } from 'drizzle-orm';
import { check, foreignKey, primaryKey, sqliteTable, unique } from 'drizzle-orm/sqlite-core';

import { BausteinKey, Weekday } from '@abnehm/contracts/base';
import type { DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';

import { person } from './accounts';
import { day, id, immutable, instant, json, localDate, mutable, oneOf, ref, small, text, whole } from './columns';

// Ziele, Wochenplan und Tagesziele (Spezifikation 0, Abschnitte 3 und 8; Spezifikation 1,
// Abschnitte 4, 5 und 7). Energie in `milli_kcal`, Gewicht in g, Wasser in ml, Sport in Minuten.

export const goalVersion = sqliteTable(
  'goal_version',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    validFrom: localDate('valid_from').notNull(),
    calorieBudgetMilliKcal: whole('calorie_budget_milli_kcal').notNull(),
    basalMetabolicRateMilliKcal: whole('basal_metabolic_rate_milli_kcal').notNull(),
    totalEnergyExpenditureMilliKcal: whole('total_energy_expenditure_milli_kcal').notNull(),
    lowerBoundMilliKcal: whole('lower_bound_milli_kcal').notNull(),
    deficitMilliKcal: whole('deficit_milli_kcal'),
    budgetSource: text('budget_source').notNull(),
    calculationSex: text('calculation_sex').notNull(),
    ageYears: small('age_years').notNull(),
    heightCm: small('height_cm').notNull(),
    weightG: whole('weight_g').notNull(),
    activityLevel: text('activity_level').notNull(),
    maintenanceReason: text('maintenance_reason'),
    pace: text('pace'),
    goalWeightG: whole('goal_weight_g').notNull(),
    waterTargetMl: whole('water_target_ml').notNull(),
    weeklySportTargetMinutes: whole('weekly_sport_target_minutes').notNull(),
    ...mutable(),
  },
  (t) => [
    unique('goal_version_valid_from_uq').on(t.personId, t.validFrom),
    check('goal_version_budget_source_check', oneOf(t.budgetSource, ['berechnet', 'manuell', 'budgetvorschlag'])),
    check('goal_version_calculation_sex_check', oneOf(t.calculationSex, ['maennlich', 'weiblich'])),
    check('goal_version_activity_level_check', oneOf(t.activityLevel, ['wenig_aktiv', 'maessig_aktiv', 'aktiv'])),
    check('goal_version_maintenance_reason_check', oneOf(t.maintenanceReason, ['sicherheits_check', 'gewaehlt'])),
    check('goal_version_pace_check', oneOf(t.pace, ['entspannt', 'zuegiger'])),
    check('goal_version_maintenance_check', sql`(${t.maintenanceReason} is null) = (${t.pace} is not null)`),
    check('goal_version_deficit_check', sql`(${t.deficitMilliKcal} is null) = (${t.pace} is null)`),
    check(
      'goal_version_energy_check',
      sql`${t.lowerBoundMilliKcal} > 0 and ${t.calorieBudgetMilliKcal} >= ${t.lowerBoundMilliKcal} and ${t.basalMetabolicRateMilliKcal} > 0 and ${t.totalEnergyExpenditureMilliKcal} > 0`,
    ),
    check(
      'goal_version_targets_check',
      sql`${t.goalWeightG} > 0 and ${t.weightG} > 0 and ${t.waterTargetMl} > 0 and ${t.weeklySportTargetMinutes} > 0`,
    ),
  ],
);

export const weeklyPlanVersion = sqliteTable(
  'weekly_plan_version',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    validFrom: localDate('valid_from').notNull(),
    ...mutable(),
  },
  (t) => [unique('weekly_plan_version_valid_from_uq').on(t.personId, t.validFrom), unique('weekly_plan_version_owner_uq').on(t.id, t.personId)],
);

export const weeklyPlanDay = sqliteTable(
  'weekly_plan_day',
  {
    weeklyPlanVersionId: ref('weekly_plan_version_id').notNull(),
    personId: ref('person_id').notNull(),
    weekday: text('weekday').notNull(),
    baustein1: text('baustein_1').notNull(),
    baustein2: text('baustein_2').notNull(),
    baustein3: text('baustein_3').notNull(),
  },
  (t) => [
    primaryKey({ name: 'weekly_plan_day_pk', columns: [t.weeklyPlanVersionId, t.weekday] }),
    foreignKey({
      name: 'weekly_plan_day_version_fk',
      columns: [t.weeklyPlanVersionId, t.personId],
      foreignColumns: [weeklyPlanVersion.id, weeklyPlanVersion.personId],
    }),
    check('weekly_plan_day_weekday_check', oneOf(t.weekday, Weekday.options)),
    check(
      'weekly_plan_day_bausteine_check',
      sql`${oneOf(t.baustein1, BausteinKey.options)} and ${oneOf(t.baustein2, BausteinKey.options)} and ${oneOf(t.baustein3, BausteinKey.options)} and ${t.baustein1} <> ${t.baustein2} and ${t.baustein1} <> ${t.baustein3} and ${t.baustein2} <> ${t.baustein3}`,
    ),
  ],
);

export const budgetSuggestion = sqliteTable(
  'budget_suggestion',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    periodFrom: localDate('period_from').notNull(),
    periodTo: localDate('period_to').notNull(),
    previousBudgetMilliKcal: whole('previous_budget_milli_kcal').notNull(),
    suggestedBudgetMilliKcal: whole('suggested_budget_milli_kcal').notNull(),
    direction: text('direction').notNull(),
    status: text('status').notNull(),
    ...mutable(),
  },
  (t) => [
    unique('budget_suggestion_period_uq').on(t.personId, t.periodTo),
    check('budget_suggestion_direction_check', oneOf(t.direction, ['senken', 'anheben'])),
    check('budget_suggestion_status_check', oneOf(t.status, ['offen', 'angenommen', 'abgelehnt', 'ueberholt'])),
    check(
      'budget_suggestion_amount_check',
      sql`${t.suggestedBudgetMilliKcal} > 0 and (${t.direction} = 'senken') = (${t.suggestedBudgetMilliKcal} < ${t.previousBudgetMilliKcal}) and ${t.suggestedBudgetMilliKcal} <> ${t.previousBudgetMilliKcal}`,
    ),
    check('budget_suggestion_period_check', sql`${t.periodFrom} <= ${t.periodTo}`),
  ],
);

export const dailyGoal = sqliteTable(
  'daily_goal',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id, { onDelete: 'restrict' }),
    ...day(),
    slot: small('slot').notNull(),
    baustein: text('baustein').notNull(),
    snapshot: json<DailyGoalSnapshot>('snapshot').notNull(),
    dayEndsAt: instant('day_ends_at').notNull(),
    ...immutable(),
  },
  (t) => [
    unique('daily_goal_slot_uq').on(t.personId, t.localDate, t.slot),
    unique('daily_goal_baustein_uq').on(t.personId, t.localDate, t.baustein),
    unique('daily_goal_identity_uq').on(t.id, t.personId, t.localDate, t.slot, t.baustein),
    check('daily_goal_slot_check', sql`${t.slot} between 1 and 3`),
    check('daily_goal_baustein_check', oneOf(t.baustein, BausteinKey.options)),
  ],
);

export const dailyGoalCompletion = sqliteTable(
  'daily_goal_completion',
  {
    id: id(),
    dailyGoalId: ref('daily_goal_id').notNull(),
    personId: ref('person_id').notNull(),
    localDate: localDate('local_date').notNull(),
    slot: small('slot').notNull(),
    baustein: text('baustein').notNull(),
    firstCompletedAt: instant('first_completed_at').notNull(),
    completionKey: text('completion_key').notNull(),
    ...immutable(),
  },
  (t) => [
    unique('daily_goal_completion_goal_uq').on(t.dailyGoalId),
    unique('daily_goal_completion_key_uq').on(t.completionKey),
    foreignKey({
      name: 'daily_goal_completion_goal_fk',
      columns: [t.dailyGoalId, t.personId, t.localDate, t.slot, t.baustein],
      foreignColumns: [dailyGoal.id, dailyGoal.personId, dailyGoal.localDate, dailyGoal.slot, dailyGoal.baustein],
    }).onDelete('restrict'),
  ],
);
