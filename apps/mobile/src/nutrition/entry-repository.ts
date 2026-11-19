import { and, asc, between, desc, eq, isNull, sql } from 'drizzle-orm';

import { EntityId, LocalDate, MealKey, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import { CaptureMethod, DisplayUnit, NutritionEntryUpsert, SnapshotSource, type FoodRef, type NutritionEntryRecord } from '@abnehm/contracts/nutrition';

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
  captureMethod: CaptureMethod;
  source: SnapshotSource;
  name: string;
  displayUnit: DisplayUnit;
  displayAmountMilli: number;
  totalMilliKcal: number;
  totalProteinMg: number;
  totalCarbsMg: number;
  totalFatMg: number;
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

/** Löst alle Einträge von einem Mahlzeitenfoto; die Einträge selbst bleiben unverändert. */
export function unlinkPhoto(tx: TransactionContext, photoId: EntityId): void {
  sqliteOf(tx).update(nutritionEntry).set({ mealPhotoId: null }).where(eq(nutritionEntry.mealPhotoId, photoId)).run();
}

/** Entfernt einen Eintrag, den der Server nie bestätigt hat; ein bestätigter bleibt. */
export function removeUnconfirmedEntry(tx: TransactionContext, entityId: EntityId): void {
  sqliteOf(tx).delete(nutritionEntry).where(and(eq(nutritionEntry.id, entityId), isNull(nutritionEntry.serverVersion))).run();
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
  return row && storedOf(row);
}

/** Person, Tag, Löschzeitpunkt und Serverversion einer Zeile, wie sie `readEntry` und `readEntryContent` liefern. */
function storedOf(row: { personId: string; localDate: string; deletedAt: string | null; serverVersion: string | null }): StoredEntry {
  return {
    personId: EntityId.parse(row.personId),
    localDate: LocalDate.parse(row.localDate),
    deletedAt: row.deletedAt as Instant | null,
    serverVersion: row.serverVersion as ServerVersion | null,
  };
}

/** Ein gespeicherter Eintrag mit seinem vollständigen fachlichen Inhalt, wie ihn die Outbox überträgt. */
export type StoredEntryContent = StoredEntry & Readonly<{ content: NutritionEntryUpsert }>;

/** Der vollständige Inhalt eines Eintrags; Ändern und „Rückgängig“ nach dem Löschen bauen darauf auf. */
export function readEntryContent(tx: ReadContext, entityId: EntityId): StoredEntryContent | undefined {
  const row = sqliteOf(tx).select().from(nutritionEntry).where(eq(nutritionEntry.id, entityId)).get();
  if (row === undefined) return undefined;
  return {
    ...storedOf(row),
    content: NutritionEntryUpsert.parse({
      consumedAt: row.consumedAt,
      localDate: row.localDate,
      timeZone: row.timeZone,
      utcOffsetMinutes: row.utcOffsetMinutes,
      meal: row.meal,
      captureMethod: row.captureMethod,
      foodRef: row.foodRefType === null ? null : { type: row.foodRefType, key: row.foodRefKey },
      snapshot: {
        name: row.snapshotName,
        baseUnit: row.snapshotBaseUnit,
        referenceAmount: row.snapshotReferenceAmount,
        milliKcal: row.snapshotMilliKcal,
        proteinMg: row.snapshotProteinMg,
        carbsMg: row.snapshotCarbsMg,
        fatMg: row.snapshotFatMg,
        portions: row.snapshotPortions,
        source: row.snapshotSource,
        attribution: row.snapshotAttribution,
      },
      amount: { baseAmount: row.baseAmount, displayUnit: row.displayUnit, displayAmountMilli: row.displayAmountMilli },
      totals: { milliKcal: row.totalMilliKcal, proteinMg: row.totalProteinMg, carbsMg: row.totalCarbsMg, fatMg: row.totalFatMg },
      mealPhotoId: row.mealPhotoId,
    }),
  };
}

/** Die nicht gelöschten Einträge einer Person an einem lokalen Tag, in Erfassungsreihenfolge. */
export function entriesOfDay(tx: ReadContext, personId: EntityId, localDate: LocalDate): LoggedEntry[] {
  return sqliteOf(tx)
    .select({
      id: nutritionEntry.id,
      meal: nutritionEntry.meal,
      captureMethod: nutritionEntry.captureMethod,
      source: nutritionEntry.snapshotSource,
      name: nutritionEntry.snapshotName,
      displayUnit: nutritionEntry.displayUnit,
      displayAmountMilli: nutritionEntry.displayAmountMilli,
      totalMilliKcal: nutritionEntry.totalMilliKcal,
      totalProteinMg: nutritionEntry.totalProteinMg,
      totalCarbsMg: nutritionEntry.totalCarbsMg,
      totalFatMg: nutritionEntry.totalFatMg,
    })
    .from(nutritionEntry)
    .where(and(eq(nutritionEntry.personId, personId), eq(nutritionEntry.localDate, localDate), isNull(nutritionEntry.deletedAt)))
    .orderBy(asc(nutritionEntry.consumedAt), asc(nutritionEntry.createdAt), asc(nutritionEntry.id))
    .all()
    .map((row) => ({
      ...row,
      id: EntityId.parse(row.id),
      meal: MealKey.parse(row.meal),
      captureMethod: CaptureMethod.parse(row.captureMethod),
      source: SnapshotSource.parse(row.source),
      displayUnit: DisplayUnit.parse(row.displayUnit),
    }));
}

/** Aufnahme eines lokalen Tags: Summe der `milli_kcal` und Zahl der Mahlzeiten mit Einträgen (0–4). */
export type DayIntake = Readonly<{ intakeMilliKcal: number; recordedMealCategories: number }>;

/**
 * Aufnahme je lokalem Tag von `from` bis `to` aus den nicht gelöschten Einträgen der Person. Tage ohne
 * Einträge fehlen in der Map. Eine Mahlzeit zählt, sobald sie mindestens einen Eintrag hat.
 */
export function intakeByDay(tx: ReadContext, personId: EntityId, from: LocalDate, to: LocalDate): ReadonlyMap<LocalDate, DayIntake> {
  const rows = sqliteOf(tx)
    .select({
      localDate: nutritionEntry.localDate,
      intakeMilliKcal: sql<number>`sum(${nutritionEntry.totalMilliKcal})`,
      recordedMealCategories: sql<number>`count(distinct ${nutritionEntry.meal})`,
    })
    .from(nutritionEntry)
    .where(and(eq(nutritionEntry.personId, personId), between(nutritionEntry.localDate, from, to), isNull(nutritionEntry.deletedAt)))
    .groupBy(nutritionEntry.localDate)
    .all();
  return new Map(rows.map(({ localDate, ...intake }) => [LocalDate.parse(localDate), intake]));
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
