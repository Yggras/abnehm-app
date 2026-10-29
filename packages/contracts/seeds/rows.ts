import type { SeedEntity } from './build.ts';
import { seedClock, seedUtcOffsetMinutes } from './ids.ts';
import type { BausteinKey, MealKey } from '../src/base.ts';
import { entryAmount, entryTotals, NutritionSnapshot } from '../src/nutrition.ts';

// Zeilenhelfer der Bereichsbeiträge: wiederkehrende Zeilenformen der Spezifikationen 1–3 in der
// kanonischen Form des Manifests. Der Baukasten (`build.ts`) kennt sie nicht; er setzt nur zusammen.

/** Tagesbezug einer Zeile: lokaler Tag in der Zone der festen Uhr samt Offset. */
export const seedDay = (localDate: string) => ({ local_date: localDate, time_zone: seedClock.timeZone, utc_offset_minutes: seedUtcOffsetMinutes });

/** Zeitstempel einer veränderlichen Zeile, die seit ihrer Anlage unverändert und nicht gelöscht ist. */
export const seedCreated = (at: string) => ({ created_at: at, updated_at: at, deleted_at: null });

/** Herkunft eines manuell erfassten Sport- oder Gewichtseintrags (Spezifikation 3). */
export const seedManualOrigin = { origin: 'manuell', external_key: null, source_app_id: null, source_app_name: null, hidden_at: null } as const;

export type SeedWeeklyPlan = Readonly<Record<string, readonly [BausteinKey, BausteinKey, BausteinKey]>>;

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
