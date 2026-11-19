import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, primaryKey, unique, uniqueIndex } from 'drizzle-orm/pg-core';

import { MealKey } from '@abnehm/contracts/base';
import { BaseUnit, CaptureMethod, DisplayUnit, FoodRefType, SnapshotSource, type PortionConversion } from '@abnehm/contracts/nutrition';

import { person } from './accounts.ts';
import { day, flag, id, instant, json, mutable, oneOf, ref, text, whole } from './columns.ts';

// Ernährung und Fotos (Spezifikation 0, Abschnitt 8; Spezifikation 2, Abschnitte 2, 3, 7–9 und 11).
// Energie in `milli_kcal`, Nährstoffe und Lebensmittelmasse in mg, Volumen in ml. Die Bezugsmenge
// und die verzehrte Basismenge stehen in der Basiseinheit des Lebensmittels (g → mg, ml → ml).
// Einheiten, Quellen und Lebensmittelreferenzen kommen aus dem Vertragsmodul (`@abnehm/contracts/nutrition`).

/** Vollständige Lebensmittelfassung einer Favoritenzeile, an der Anwendungsgrenze per Zod geprüft. */
export type NutritionSnapshotJson = Record<string, unknown>;

export const ownFood = pgTable(
  'own_food',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    name: text('name').notNull(),
    baseUnit: text('base_unit').notNull(),
    referenceAmount: whole('reference_amount').notNull(),
    milliKcal: whole('milli_kcal').notNull(),
    proteinMg: whole('protein_mg').notNull(),
    carbsMg: whole('carbs_mg').notNull(),
    fatMg: whole('fat_mg').notNull(),
    portions: json<PortionConversion[]>('portions').notNull(),
    /** Herkunftsreferenz, wenn das Lebensmittel eine BLS- oder OFF-Quelle überdeckt. */
    originType: text('origin_type'),
    originKey: text('origin_key'),
    ...mutable(),
  },
  (t) => [
    uniqueIndex('own_food_barcode_uq').on(t.personId, t.originKey).where(sql`${t.originType} = 'off'`),
    check('own_food_base_unit_check', oneOf(t.baseUnit, BaseUnit.options)),
    check('own_food_origin_type_check', oneOf(t.originType, ['bls', 'off'])),
    check('own_food_origin_check', sql`(${t.originType} is null) = (${t.originKey} is null)`),
    check(
      'own_food_values_check',
      sql`${t.referenceAmount} > 0 and ${t.milliKcal} >= 0 and ${t.proteinMg} >= 0 and ${t.carbsMg} >= 0 and ${t.fatMg} >= 0`,
    ),
    // Makros zusammen höchstens Bezugsmenge (Spezifikation 2, Abschnitt 2); beide in mg nur bei Basiseinheit g.
    check('own_food_macros_check', sql`${t.baseUnit} <> 'g' or ${t.proteinMg} + ${t.carbsMg} + ${t.fatMg} <= ${t.referenceAmount}`),
  ],
);

export const foodFavorite = pgTable(
  'food_favorite',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    foodRefType: text('food_ref_type').notNull(),
    foodRefKey: text('food_ref_key').notNull(),
    snapshot: json<NutritionSnapshotJson>('snapshot').notNull(),
    /** Entfernte Markierung; kein Tombstone, weil die ID deterministisch ist (#158). */
    removedAt: instant('removed_at'),
    ...mutable(),
  },
  (t) => [
    unique('food_favorite_ref_uq').on(t.personId, t.foodRefType, t.foodRefKey),
    check('food_favorite_ref_type_check', oneOf(t.foodRefType, FoodRefType.options)),
  ],
);

export const mealFavorite = pgTable(
  'meal_favorite',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    name: text('name').notNull(),
    ...mutable(),
  },
  (t) => [unique('meal_favorite_owner_uq').on(t.id, t.personId)],
);

/** Geordneter Bestandteil eines Mahlzeitenfavoriten; geschrieben nur mit dem Favoriten (`saveMealFavorite`). */
export const mealFavoriteItem = pgTable(
  'meal_favorite_item',
  {
    mealFavoriteId: ref('meal_favorite_id').notNull(),
    personId: ref('person_id').notNull(),
    position: whole('position').notNull(),
    foodRefType: text('food_ref_type').notNull(),
    foodRefKey: text('food_ref_key').notNull(),
    baseAmount: whole('base_amount').notNull(),
    displayUnit: text('display_unit').notNull(),
    displayAmountMilli: whole('display_amount_milli').notNull(),
    snapshot: json<NutritionSnapshotJson>('snapshot').notNull(),
  },
  (t) => [
    primaryKey({ name: 'meal_favorite_item_pk', columns: [t.mealFavoriteId, t.position] }),
    foreignKey({
      name: 'meal_favorite_item_favorite_fk',
      columns: [t.mealFavoriteId, t.personId],
      foreignColumns: [mealFavorite.id, mealFavorite.personId],
    }),
    check('meal_favorite_item_ref_type_check', oneOf(t.foodRefType, FoodRefType.options)),
    check('meal_favorite_item_display_unit_check', oneOf(t.displayUnit, DisplayUnit.options)),
    check(
      'meal_favorite_item_amount_check',
      sql`${t.position} >= 0 and ${t.baseAmount} > 0 and ${t.displayAmountMilli} > 0`,
    ),
  ],
);

/** Metadaten eines Mahlzeitenfotos; die Datei liegt nur im Serverspeicher. */
export const mealPhoto = pgTable(
  'meal_photo',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    imageKey: text('image_key').notNull(),
    capturedAt: instant('captured_at').notNull(),
    sharedWithPartner: flag('shared_with_partner').notNull(),
    ...mutable(),
  },
  (t) => [unique('meal_photo_owner_uq').on(t.id, t.personId)],
);

/**
 * Ernährungseintrag mit vollständigem Nährwert-Snapshot und mitgespeicherten Summen der verzehrten
 * Menge. KI-Bestandteile haben keine Lebensmittelreferenz; jede Referenz entspricht der Quelle.
 */
export const nutritionEntry = pgTable(
  'nutrition_entry',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    consumedAt: instant('consumed_at').notNull(),
    ...day(),
    meal: text('meal').notNull(),
    captureMethod: text('capture_method').notNull(),
    foodRefType: text('food_ref_type'),
    foodRefKey: text('food_ref_key'),
    baseAmount: whole('base_amount').notNull(),
    displayUnit: text('display_unit').notNull(),
    displayAmountMilli: whole('display_amount_milli').notNull(),
    snapshotName: text('snapshot_name').notNull(),
    snapshotBaseUnit: text('snapshot_base_unit').notNull(),
    snapshotReferenceAmount: whole('snapshot_reference_amount').notNull(),
    snapshotMilliKcal: whole('snapshot_milli_kcal').notNull(),
    snapshotProteinMg: whole('snapshot_protein_mg').notNull(),
    snapshotCarbsMg: whole('snapshot_carbs_mg').notNull(),
    snapshotFatMg: whole('snapshot_fat_mg').notNull(),
    snapshotPortions: json<PortionConversion[]>('snapshot_portions').notNull(),
    snapshotSource: text('snapshot_source').notNull(),
    snapshotAttribution: text('snapshot_attribution'),
    totalMilliKcal: whole('total_milli_kcal').notNull(),
    totalProteinMg: whole('total_protein_mg').notNull(),
    totalCarbsMg: whole('total_carbs_mg').notNull(),
    totalFatMg: whole('total_fat_mg').notNull(),
    mealPhotoId: ref('meal_photo_id'),
    ...mutable(),
  },
  (t) => [
    foreignKey({
      name: 'nutrition_entry_photo_fk',
      columns: [t.mealPhotoId, t.personId],
      foreignColumns: [mealPhoto.id, mealPhoto.personId],
    }),
    check('nutrition_entry_meal_check', oneOf(t.meal, MealKey.options)),
    check('nutrition_entry_capture_method_check', oneOf(t.captureMethod, CaptureMethod.options)),
    check('nutrition_entry_display_unit_check', oneOf(t.displayUnit, DisplayUnit.options)),
    check('nutrition_entry_base_unit_check', oneOf(t.snapshotBaseUnit, BaseUnit.options)),
    check('nutrition_entry_source_check', oneOf(t.snapshotSource, SnapshotSource.options)),
    check(
      'nutrition_entry_ref_check',
      sql`(${t.foodRefType} is null) = (${t.foodRefKey} is null) and (${t.foodRefType} is null) = (${t.snapshotSource} = 'ki') and (${t.foodRefType} is null or ${t.foodRefType} = ${t.snapshotSource})`,
    ),
    check('nutrition_entry_ai_capture_check', sql`${t.snapshotSource} <> 'ki' or ${t.captureMethod} = 'foto'`),
    check(
      'nutrition_entry_amount_check',
      sql`${t.baseAmount} > 0 and ${t.baseAmount} <= (case ${t.snapshotBaseUnit} when 'g' then 5000000 else 5000 end) and ${t.displayAmountMilli} > 0`,
    ),
    check(
      'nutrition_entry_values_check',
      sql`${t.snapshotReferenceAmount} > 0 and ${t.snapshotMilliKcal} >= 0 and ${t.snapshotProteinMg} >= 0 and ${t.snapshotCarbsMg} >= 0 and ${t.snapshotFatMg} >= 0 and ${t.totalMilliKcal} >= 0 and ${t.totalProteinMg} >= 0 and ${t.totalCarbsMg} >= 0 and ${t.totalFatMg} >= 0`,
    ),
    check(
      'nutrition_entry_macros_check',
      sql`${t.snapshotBaseUnit} <> 'g' or ${t.snapshotProteinMg} + ${t.snapshotCarbsMg} + ${t.snapshotFatMg} <= ${t.snapshotReferenceAmount}`,
    ),
  ],
);

/** Fotoentwurf der KI-Analyse; nur Server, nach spätestens 24 Stunden physisch gelöscht. */
export const photoDraft = pgTable(
  'photo_draft',
  {
    id: id(),
    personId: ref('person_id')
      .notNull()
      .references(() => person.id),
    imageKey: text('image_key').notNull(),
    analysisState: text('analysis_state').notNull(),
    components: json<unknown[]>('components'),
    errorCode: text('error_code'),
    createdAt: instant('created_at').notNull(),
    expiresAt: instant('expires_at').notNull(),
  },
  (t) => [
    check('photo_draft_analysis_state_check', oneOf(t.analysisState, ['analysiert', 'fehlgeschlagen'])),
    check(
      'photo_draft_result_check',
      sql`(${t.analysisState} = 'analysiert') = (${t.components} is not null) and (${t.analysisState} = 'fehlgeschlagen') = (${t.errorCode} is not null)`,
    ),
  ],
);
