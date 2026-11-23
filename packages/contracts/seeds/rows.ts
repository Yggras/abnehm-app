import type { SeedEntity } from './build.ts';
import type { SeedRow } from './manifest.ts';
import { seedClock, seedUtcOffsetMinutes } from './ids.ts';
import { EntityId, LocalDate, type BausteinKey, type MealKey } from '../src/base.ts';
import { dailyGoalCompletionId, dailyGoalKey, type DailyGoalSlot } from '../src/daily-goals.ts';
import { dailyBonusKey, energyBookingId } from '../src/energy.ts';
import { entryAmount, entryTotals, FoodFavoriteUpsert, foodFavoriteId, FoodRef, NutritionSnapshot, OwnFoodUpsert, PortionConversion } from '../src/nutrition.ts';

// Zeilenhelfer der Bereichsbeiträge: wiederkehrende Zeilenformen der Spezifikationen 1–3 in der
// kanonischen Form des Manifests. Der Baukasten (`build.ts`) kennt sie nicht; er setzt nur zusammen.

/** Tagesbezug einer Zeile: lokaler Tag in der Zone der festen Uhr samt Offset. */
export const seedDay = (localDate: string) => ({ local_date: localDate, time_zone: seedClock.timeZone, utc_offset_minutes: seedUtcOffsetMinutes });

/** Zeitstempel einer veränderlichen Zeile, die seit ihrer Anlage unverändert und nicht gelöscht ist. */
export const seedCreated = (at: string) => ({ created_at: at, updated_at: at, deleted_at: null });

/** Herkunft eines manuell erfassten Sport- oder Gewichtseintrags (Spezifikation 3). */
export const seedManualOrigin = { origin: 'manuell', external_key: null, source_app_id: null, source_app_name: null, hidden_at: null } as const;

export type SeedWeeklyPlan = Readonly<Record<string, readonly [BausteinKey, BausteinKey, BausteinKey]>>;

/**
 * Fachliche Felder einer Zielversion wie in `CreateGoalVersion` (Spezifikation 1, Abschnitt 4). Seeds
 * dürfen erfundene, nicht nachgerechnete Werte tragen (`solo`, `gekoppelt`); deshalb nur die Feldnamen.
 */
export type SeedGoalVersionValues = Readonly<{
  validFrom: string;
  calorieBudgetMilliKcal: number;
  basalMetabolicRateMilliKcal: number;
  totalEnergyExpenditureMilliKcal: number;
  lowerBoundMilliKcal: number;
  deficitMilliKcal: number | null;
  budgetSource: string;
  calculationSex: string;
  ageYears: number;
  heightCm: number;
  weightG: number;
  activityLevel: string;
  maintenanceReason: string | null;
  pace: string | null;
  goalWeightG: number;
  waterTargetMl: number;
  weeklySportTargetMinutes: number;
}>;

/** Zielversion einer Person (Spezifikation 1), seit #128 beim Sync angemeldet und damit im Änderungsprotokoll. */
export function seedGoalVersion({ id, personId, createdAt, values }: { id: string; personId: string; createdAt: string; values: SeedGoalVersionValues }): SeedEntity {
  return {
    table: 'goal_version',
    entityType: 'goal_version',
    ownerPersonId: personId,
    row: {
      id,
      person_id: personId,
      valid_from: values.validFrom,
      calorie_budget_milli_kcal: values.calorieBudgetMilliKcal,
      basal_metabolic_rate_milli_kcal: values.basalMetabolicRateMilliKcal,
      total_energy_expenditure_milli_kcal: values.totalEnergyExpenditureMilliKcal,
      lower_bound_milli_kcal: values.lowerBoundMilliKcal,
      deficit_milli_kcal: values.deficitMilliKcal,
      budget_source: values.budgetSource,
      calculation_sex: values.calculationSex,
      age_years: values.ageYears,
      height_cm: values.heightCm,
      weight_g: values.weightG,
      activity_level: values.activityLevel,
      maintenance_reason: values.maintenanceReason,
      pace: values.pace,
      goal_weight_g: values.goalWeightG,
      water_target_ml: values.waterTargetMl,
      weekly_sport_target_minutes: values.weeklySportTargetMinutes,
      ...seedCreated(createdAt),
    },
  };
}

/** Wochenplanversion einer Person samt ihrer sieben Tage (Spezifikation 1). */
export function seedWeeklyPlan(options: { id: string; personId: string; validFrom: string; createdAt: string; plan: SeedWeeklyPlan }): SeedEntity {
  return {
    table: 'weekly_plan_version',
    // Seit #128 beim Sync angemeldet: Die Fassung steht im Änderungsprotokoll.
    entityType: 'weekly_plan_version',
    ownerPersonId: options.personId,
    row: { id: options.id, person_id: options.personId, valid_from: options.validFrom, ...seedCreated(options.createdAt) },
    children: {
      weekly_plan_day: Object.entries(options.plan).map(([weekday, [baustein1, baustein2, baustein3]]) => ({
        weekly_plan_version_id: options.id,
        person_id: options.personId,
        weekday,
        baustein_1: baustein1,
        baustein_2: baustein2,
        baustein_3: baustein3,
      })),
    },
  };
}

/** Die drei Tagesziele eines Tags nach dem Wochenplantag, mit den Schwellen aus der Zielversion (Spezifikation 1). */
export function seedDailyGoals(options: {
  personId: string;
  ids: readonly [string, string, string];
  localDate: string;
  dayEndsAt: string;
  createdAt: string;
  bausteine: readonly [BausteinKey, BausteinKey, BausteinKey];
  thresholds: Readonly<Partial<Record<BausteinKey, Readonly<Record<string, number>>>>>;
}): SeedEntity[] {
  return options.bausteine.map((baustein, index) => {
    const slot = index + 1;
    return {
      table: 'daily_goal',
      ownerPersonId: options.personId,
      row: {
        id: options.ids[index] as string,
        person_id: options.personId,
        ...seedDay(options.localDate),
        slot,
        baustein,
        snapshot: {
          type: baustein,
          personId: options.personId,
          localDate: options.localDate,
          slot,
          timeZone: seedClock.timeZone,
          dayEndsAt: options.dayEndsAt,
          ...options.thresholds[baustein],
        },
        day_ends_at: options.dayEndsAt,
        created_at: options.createdAt,
      },
    };
  });
}

/** Quellenangabe jedes BLS-Snapshots (Spezifikation 2, Abschnitt 3). */
const blsAttribution = 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0';

/**
 * Ernährungseintrag aus der Suche mit BLS-Snapshot je 100 g (Spezifikation 2, Abschnitte 2 und 6). Menge
 * und Summen folgen aus den Rechenregeln des Vertragsmoduls, so wie die App sie beim Erfassen bildet.
 */
export function seedBlsEntry(options: {
  id: string;
  personId: string;
  at: string;
  localDate: string;
  meal: MealKey;
  food: Readonly<{ key: string; name: string; milliKcal: number; proteinMg: number; carbsMg: number; fatMg: number }>;
  grams: number;
}): SeedEntity {
  const { key, ...values } = options.food;
  const snapshot = NutritionSnapshot.parse({ ...values, baseUnit: 'g', referenceAmount: 100_000, portions: [], source: 'bls', attribution: blsAttribution });
  const amount = entryAmount(snapshot, 'g', options.grams * 1_000);
  if (amount.type === 'problem') throw new Error(`Seed-Menge ${options.grams} g: ${amount.problem}`);
  const totals = entryTotals(snapshot, amount.amount);
  return {
    table: 'nutrition_entry',
    // Seit #155 beim Sync angemeldet: Die Einträge stehen im Änderungsprotokoll.
    entityType: 'nutrition_entry',
    ownerPersonId: options.personId,
    row: {
      id: options.id,
      person_id: options.personId,
      consumed_at: options.at,
      ...seedDay(options.localDate),
      meal: options.meal,
      capture_method: 'suche',
      food_ref_type: 'bls',
      food_ref_key: key,
      base_amount: amount.amount.baseAmount,
      display_unit: amount.amount.displayUnit,
      display_amount_milli: amount.amount.displayAmountMilli,
      snapshot_name: snapshot.name,
      snapshot_base_unit: snapshot.baseUnit,
      snapshot_reference_amount: snapshot.referenceAmount,
      snapshot_milli_kcal: snapshot.milliKcal,
      snapshot_protein_mg: snapshot.proteinMg,
      snapshot_carbs_mg: snapshot.carbsMg,
      snapshot_fat_mg: snapshot.fatMg,
      snapshot_portions: [],
      snapshot_source: 'bls',
      snapshot_attribution: blsAttribution,
      total_milli_kcal: totals.milliKcal,
      total_protein_mg: totals.proteinMg,
      total_carbs_mg: totals.carbsMg,
      total_fat_mg: totals.fatMg,
      meal_photo_id: null,
      ...seedCreated(options.at),
    },
  };
}

/** Eigenes Lebensmittel (Spezifikation 2, Abschnitt 3), seit #157 beim Sync angemeldet; die Werte prüft der Vertrag. */
export function seedOwnFood(options: { id: string; personId: string; at: string; food: OwnFoodUpsert }): SeedEntity {
  const food = OwnFoodUpsert.parse(options.food);
  return {
    table: 'own_food',
    entityType: 'own_food',
    ownerPersonId: options.personId,
    row: {
      id: options.id,
      person_id: options.personId,
      name: food.name,
      base_unit: food.baseUnit,
      reference_amount: food.referenceAmount,
      milli_kcal: food.milliKcal,
      protein_mg: food.proteinMg,
      carbs_mg: food.carbsMg,
      fat_mg: food.fatMg,
      portions: food.portions,
      origin_type: food.origin?.type ?? null,
      origin_key: food.origin?.key ?? null,
      ...seedCreated(options.at),
    },
  };
}

/**
 * Ein Eintrag des lokalen Open-Food-Facts-Caches (Spezifikation 2, Abschnitt 3; #160): nur auf dem Gerät, nie
 * synchronisiert. Werte je 100 g bzw. 100 ml; `null` fehlt bei OFF und macht das Produkt unvollständig.
 */
export function seedOffCacheRow(options: {
  barcode: string;
  name: string;
  brand: string | null;
  baseUnit: 'g' | 'ml';
  milliKcal: number | null;
  proteinMg: number | null;
  carbsMg: number | null;
  fatMg: number | null;
  portions: readonly PortionConversion[];
  fetchedAt: string;
}): SeedRow {
  return {
    barcode: FoodRef.parse({ type: 'off', key: options.barcode }).key,
    name: options.name,
    brand: options.brand,
    base_unit: options.baseUnit,
    milli_kcal_per_100: options.milliKcal,
    protein_mg_per_100: options.proteinMg,
    carbs_mg_per_100: options.carbsMg,
    fat_mg_per_100: options.fatMg,
    portions: options.portions.map((portion) => PortionConversion.parse(portion)),
    fetched_at: options.fetchedAt,
  };
}

/**
 * Markierter Lebensmittelfavorit (Spezifikation 2, Abschnitt 7), seit #158 beim Sync angemeldet. Die ID
 * folgt deterministisch aus Person und Lebensmittelreferenz; Referenz und Fassung prüft der Vertrag.
 */
export function seedFoodFavorite(options: { personId: string; at: string; favorite: FoodFavoriteUpsert }): SeedEntity {
  const favorite = FoodFavoriteUpsert.parse(options.favorite);
  return {
    table: 'food_favorite',
    entityType: 'food_favorite',
    ownerPersonId: options.personId,
    row: {
      id: foodFavoriteId(EntityId.parse(options.personId), favorite.foodRef),
      person_id: options.personId,
      food_ref_type: favorite.foodRef.type,
      food_ref_key: favorite.foodRef.key,
      snapshot: favorite.snapshot,
      removed_at: favorite.removedAt,
      ...seedCreated(options.at),
    },
  };
}

/** Manuell erfasster Wassereintrag (Spezifikation 3), seit #171 beim Sync angemeldet. */
export function seedWaterEntry(options: { id: string; personId: string; amountMl: number; loggedAt: string; localDate: string }): SeedEntity {
  return {
    table: 'water_entry',
    entityType: 'water_entry',
    ownerPersonId: options.personId,
    row: {
      id: options.id,
      person_id: options.personId,
      amount_ml: options.amountMl,
      origin: 'manuell',
      logged_at: options.loggedAt,
      ...seedDay(options.localDate),
      ...seedCreated(options.loggedAt),
    },
  };
}

/** Manuell erfasster Sporteintrag (Spezifikation 3), weder ersetzt noch reaktiviert; seit #173 beim Sync angemeldet. */
export function seedSportEntry(options: {
  id: string;
  personId: string;
  activity: string;
  startedAt: string;
  minutes: number;
  createdAt: string;
  localDate: string;
}): SeedEntity {
  return {
    table: 'sport_entry',
    entityType: 'sport_entry',
    ownerPersonId: options.personId,
    row: {
      id: options.id,
      person_id: options.personId,
      activity_type: options.activity,
      override_activity_type: null,
      started_at: options.startedAt,
      duration_minutes: options.minutes,
      active_milli_kcal: null,
      ...seedManualOrigin,
      replaced_by_entry_id: null,
      reactivated_at: null,
      ...seedDay(options.localDate),
      ...seedCreated(options.createdAt),
    },
  };
}

/**
 * KI-Schätzung aus einem Foto, dessen Foto nicht behalten wurde (Spezifikation 2, Abschnitt 6): Snapshot
 * je 100 g, Menge und Summen nach den Rechenregeln des Vertragsmoduls. Name und Werte sind erfunden, wie
 * eine Schätzung; sie stammen aus keiner Nährwertdatenbank.
 */
export function seedKiEntry(options: {
  id: string;
  personId: string;
  at: string;
  localDate: string;
  meal: MealKey;
  name: string;
  per100g: Readonly<{ milliKcal: number; proteinMg: number; carbsMg: number; fatMg: number }>;
  grams: number;
}): SeedEntity {
  const snapshot = NutritionSnapshot.parse({
    name: options.name,
    ...options.per100g,
    baseUnit: 'g',
    referenceAmount: 100_000,
    portions: [],
    source: 'ki',
    attribution: null,
  });
  const amount = entryAmount(snapshot, 'g', options.grams * 1_000);
  if (amount.type === 'problem') throw new Error(`Seed-Menge ${options.grams} g: ${amount.problem}`);
  const totals = entryTotals(snapshot, amount.amount);
  return {
    table: 'nutrition_entry',
    entityType: 'nutrition_entry',
    ownerPersonId: options.personId,
    row: {
      id: options.id,
      person_id: options.personId,
      consumed_at: options.at,
      ...seedDay(options.localDate),
      meal: options.meal,
      capture_method: 'foto',
      food_ref_type: null,
      food_ref_key: null,
      base_amount: amount.amount.baseAmount,
      display_unit: amount.amount.displayUnit,
      display_amount_milli: amount.amount.displayAmountMilli,
      snapshot_name: snapshot.name,
      snapshot_base_unit: snapshot.baseUnit,
      snapshot_reference_amount: snapshot.referenceAmount,
      snapshot_milli_kcal: snapshot.milliKcal,
      snapshot_protein_mg: snapshot.proteinMg,
      snapshot_carbs_mg: snapshot.carbsMg,
      snapshot_fat_mg: snapshot.fatMg,
      snapshot_portions: [],
      snapshot_source: 'ki',
      snapshot_attribution: null,
      total_milli_kcal: totals.milliKcal,
      total_protein_mg: totals.proteinMg,
      total_carbs_mg: totals.carbsMg,
      total_fat_mg: totals.fatMg,
      meal_photo_id: null,
      ...seedCreated(options.at),
    },
  };
}

/**
 * Tageszielerfüllung samt `+1`-Gutschrift, wie sie der Fachbefehl `completeDailyGoal` anlegt (#105): IDs
 * und Schlüssel aus Person, Tag und Platz. `at` ist der Erfüllungszeitpunkt des Geräts; `createdAt` setzt
 * der Server mit seiner Uhr, wenn er den Befehl annimmt (#116), sonst gilt `at`.
 */
export function seedCompletion(options: {
  personId: string;
  dailyGoalId: string;
  localDate: string;
  slot: DailyGoalSlot;
  baustein: BausteinKey;
  at: string;
  createdAt?: string;
}): SeedEntity[] {
  const { personId, localDate, slot, at } = options;
  const createdAt = options.createdAt ?? at;
  const key = dailyGoalKey(EntityId.parse(personId), LocalDate.parse(localDate), slot);
  const id = dailyGoalCompletionId(key);
  return [
    {
      table: 'daily_goal_completion',
      entityType: 'daily_goal_completion',
      ownerPersonId: personId,
      row: {
        id,
        daily_goal_id: options.dailyGoalId,
        person_id: personId,
        local_date: localDate,
        slot,
        baustein: options.baustein,
        first_completed_at: at,
        completion_key: key,
        created_at: createdAt,
      },
    },
    {
      table: 'energy_booking',
      entityType: 'energy_booking',
      ownerPersonId: personId,
      row: {
        id: energyBookingId(key),
        person_id: personId,
        type: 'daily_goal_credit',
        amount: 1,
        local_date: localDate,
        booking_key: key,
        trigger: { dailyGoalCompletionId: id, slot },
        daily_goal_completion_id: id,
        island_object_id: null,
        community_project_id: null,
        original_booking_id: null,
        created_at: createdAt,
      },
    },
  ];
}

/** `+1`-Tagesbonus für die drei Erfüllungen eines Tags, wie ihn der Fachbefehl `grantDailyBonus` anlegt (#105). */
export function seedDailyBonus(options: { personId: string; localDate: string; at: string }): SeedEntity {
  const personId = EntityId.parse(options.personId);
  const localDate = LocalDate.parse(options.localDate);
  const key = dailyBonusKey(personId, localDate);
  const slots: readonly DailyGoalSlot[] = [1, 2, 3];
  return {
    table: 'energy_booking',
    entityType: 'energy_booking',
    ownerPersonId: personId,
    row: {
      id: energyBookingId(key),
      person_id: personId,
      type: 'daily_bonus_credit',
      amount: 1,
      local_date: localDate,
      booking_key: key,
      trigger: { dailyGoalCompletionIds: slots.map((slot) => dailyGoalCompletionId(dailyGoalKey(personId, localDate, slot))) },
      daily_goal_completion_id: null,
      island_object_id: null,
      community_project_id: null,
      original_booking_id: null,
      created_at: options.at,
    },
  };
}

/** Herkunft eines importierten Eintrags (Spezifikation 3, Abschnitt 6); in den Seeds schreibt immer Fitbit nach Apple Health bzw. Health Connect (#181). */
export type SeedImport = Readonly<{ origin: 'apple_health' | 'health_connect'; externalKey: string; hiddenAt?: string }>;

const seedImportOrigin = ({ origin, externalKey, hiddenAt }: SeedImport) =>
  ({ origin, external_key: externalKey, source_app_id: 'com.fitbit.FitbitMobile', source_app_name: 'Fitbit', hidden_at: hiddenAt ?? null });

/** Ein importiertes Training (#181); `at` ist der Import, `updatedAt` etwa das Ausblenden. */
export function seedImportedSportEntry(options: {
  id: string;
  person: string;
  activity: string;
  startedAt: string;
  minutes: number;
  milliKcal: number;
  localDate: string;
  at: string;
  updatedAt?: string;
  from: SeedImport;
}): SeedEntity {
  return {
    table: 'sport_entry',
    entityType: 'sport_entry',
    ownerPersonId: options.person,
    row: {
      id: options.id,
      person_id: options.person,
      activity_type: options.activity,
      override_activity_type: null,
      started_at: options.startedAt,
      duration_minutes: options.minutes,
      active_milli_kcal: options.milliKcal,
      ...seedImportOrigin(options.from),
      replaced_by_entry_id: null,
      reactivated_at: null,
      ...seedDay(options.localDate),
      ...seedCreated(options.at),
      updated_at: options.updatedAt ?? options.at,
    },
  };
}

/** Ein Gewichtseintrag, manuell oder als Waagenwert importiert (#181). */
export function seedWeightEntry(options: { id: string; person: string; weightG: number; at: string; localDate: string; from?: SeedImport }): SeedEntity {
  return {
    table: 'weight_entry',
    entityType: 'weight_entry',
    ownerPersonId: options.person,
    row: {
      id: options.id,
      person_id: options.person,
      weight_g: options.weightG,
      measured_at: options.at,
      ...(options.from === undefined ? seedManualOrigin : seedImportOrigin(options.from)),
      ...seedDay(options.localDate),
      ...seedCreated(options.at),
    },
  };
}
