import { and, asc, desc, eq, isNull } from 'drizzle-orm';

import { EntityId, LocalDate, MealKey, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import { DisplayUnit, type FoodRef, type NutritionEntryRecord, type NutritionEntryUpsert } from '@abnehm/contracts/nutrition';

import type { ReadContext, TransactionContext } from '../local-db';
import { nutritionEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository der Ernährungseinträge: neben dem Sync-Adapter die einzige Stelle des Moduls, die Drizzle
// und die Tabelle `nutrition_entry` sieht. Andere Bereiche lesen sie nie (Spezifikation 2, Abschnitt 1).
// Die Nutzlast ist verschachtelt (Referenz, Snapshot, Menge, Summen), die Tabelle flach.

/** Was Befehle und Sync von einem gespeicherten Eintrag wissen müssen. */
export type StoredEntry = Readonly<{
  personId: EntityId;
  localDate: LocalDate;
  deletedAt: Instant | null;
  serverVersion: ServerVersion | null;
}>;

/** Ein nicht gelöschter Eintrag eines Tags, wie ihn das Tagesprotokoll zeigt. */
export type LoggedEntry = Readonly<{
  id: EntityId;
  meal: MealKey;
  name: string;
  displayUnit: DisplayUnit;
  displayAmountMilli: number;
  totalMilliKcal: number;
}>;

/** Die fachlichen Spalten einer Nutzlast bzw. eines kanonischen Datensatzes. */
export function entryColumns(entry: NutritionEntryUpsert) {
  const { snapshot, amount, totals } = entry;
  return {
    consumedAt: entry.consumedAt,
    localDate: entry.localDate,
    timeZone: entry.timeZone,
    utcOffsetMinutes: entry.utcOffsetMinutes,
    meal: entry.meal,
    captureMethod: entry.captureMethod,
    foodRefType: entry.foodRef?.type ?? null,
    foodRefKey: entry.foodRef?.key ?? null,
    baseAmount: amount.baseAmount,
    displayUnit: amount.displayUnit,
    displayAmountMilli: amount.displayAmountMilli,
    snapshotName: snapshot.name,
    snapshotBaseUnit: snapshot.baseUnit,
    snapshotReferenceAmount: snapshot.referenceAmount,
    snapshotMilliKcal: snapshot.milliKcal,
    snapshotProteinMg: snapshot.proteinMg,
    snapshotCarbsMg: snapshot.carbsMg,
    snapshotFatMg: snapshot.fatMg,
    snapshotPortions: snapshot.portions,
    snapshotSource: snapshot.source,
    snapshotAttribution: snapshot.attribution,
    totalMilliKcal: totals.milliKcal,
    totalProteinMg: totals.proteinMg,
    totalCarbsMg: totals.carbsMg,
    totalFatMg: totals.fatMg,
    mealPhotoId: entry.mealPhotoId,
  };
}

/** Die vollständige Zeile zu einem kanonischen Datensatz, ohne Serverversion und Löschmarkierung. */
export function recordRow(entityId: EntityId, record: NutritionEntryRecord) {
  return { ...entryColumns(record), id: entityId, personId: record.personId, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

/** Legt den Eintrag an oder überschreibt seine fachlichen Felder (Last-Write-Wins). */
export function writeEntry(tx: TransactionContext, entityId: EntityId, personId: EntityId, payload: NutritionEntryUpsert, at: Instant): void {
  const fields = { ...entryColumns(payload), updatedAt: at };
  sqliteOf(tx)
    .insert(nutritionEntry)
    .values({ ...fields, id: entityId, personId, createdAt: at })
    .onConflictDoUpdate({ target: nutritionEntry.id, set: fields })
    .run();
}

/** Setzt die Löschmarkierung; Löschen ist ein Tombstone und für Clientoperationen endgültig. */
export function tombstoneEntry(tx: TransactionContext, entityId: EntityId, at: Instant): void {
  sqliteOf(tx).update(nutritionEntry).set({ deletedAt: at, updatedAt: at }).where(eq(nutritionEntry.id, entityId)).run();
}

export function readEntry(tx: ReadContext, entityId: EntityId): StoredEntry | undefined {
  const row = sqliteOf(tx)
    .select({
      personId: nutritionEntry.personId,
      localDate: nutritionEntry.localDate,
      deletedAt: nutritionEntry.deletedAt,
      serverVersion: nutritionEntry.serverVersion,
    })
    .from(nutritionEntry)
    .where(eq(nutritionEntry.id, entityId))
    .get();
  return row && {
    personId: EntityId.parse(row.personId),
    localDate: LocalDate.parse(row.localDate),
    deletedAt: row.deletedAt as Instant | null,
    serverVersion: row.serverVersion as ServerVersion | null,
  };
}

/** Die nicht gelöschten Einträge einer Person an einem lokalen Tag, in Erfassungsreihenfolge. */
export function entriesOfDay(tx: ReadContext, personId: EntityId, localDate: LocalDate): LoggedEntry[] {
  return sqliteOf(tx)
    .select({
      id: nutritionEntry.id,
      meal: nutritionEntry.meal,
      name: nutritionEntry.snapshotName,
      displayUnit: nutritionEntry.displayUnit,
      displayAmountMilli: nutritionEntry.displayAmountMilli,
      totalMilliKcal: nutritionEntry.totalMilliKcal,
    })
    .from(nutritionEntry)
    .where(and(eq(nutritionEntry.personId, personId), eq(nutritionEntry.localDate, localDate), isNull(nutritionEntry.deletedAt)))
    .orderBy(asc(nutritionEntry.consumedAt), asc(nutritionEntry.createdAt), asc(nutritionEntry.id))
    .all()
    .map((row) => ({ ...row, id: EntityId.parse(row.id), meal: MealKey.parse(row.meal), displayUnit: DisplayUnit.parse(row.displayUnit) }));
}

/** Menge und Einheit des zuletzt erfassten, nicht gelöschten Eintrags mit dieser Lebensmittelreferenz. */
export function latestAmountOf(tx: ReadContext, personId: EntityId, ref: FoodRef): { displayUnit: DisplayUnit; displayAmountMilli: number } | undefined {
  const row = sqliteOf(tx)
    .select({ displayUnit: nutritionEntry.displayUnit, displayAmountMilli: nutritionEntry.displayAmountMilli })
    .from(nutritionEntry)
    .where(and(
      eq(nutritionEntry.personId, personId),
      eq(nutritionEntry.foodRefType, ref.type),
      eq(nutritionEntry.foodRefKey, ref.key),
      isNull(nutritionEntry.deletedAt),
    ))
    .orderBy(desc(nutritionEntry.consumedAt), desc(nutritionEntry.createdAt))
    .limit(1)
    .get();
  return row && { displayUnit: DisplayUnit.parse(row.displayUnit), displayAmountMilli: row.displayAmountMilli };
}
