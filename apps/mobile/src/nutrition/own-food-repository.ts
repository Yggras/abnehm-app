import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';

import { EntityId, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import { BaseUnit, foodValuesOf, OwnFoodOrigin, ownFoodSnapshot, sameFoodValues, type FoodRef, type FoodValues, type NutritionSnapshot, type OwnFoodRecord, type OwnFoodUpsert } from '@abnehm/contracts/nutrition';

import type { ReadContext, TransactionContext } from '../local-db';
import { ownFood } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { accountSearchQuery } from './account-search';
import { searchNames, type SearchQuery } from './search-text';

// Repository der eigenen Lebensmittel (Spezifikation 2, Abschnitt 3): neben dem Sync-Adapter die
// einzige Stelle, die Drizzle und die Tabellen `own_food` und `own_food_search` sieht. Die Nutzlast
// führt die Herkunftsreferenz als `origin`, die Tabelle als `origin_type` und `origin_key`.
//
// `own_food_search` ist der lokale FTS5-Index (Migration `0004_own_food_search`). Er enthält genau die
// nicht gelöschten eigenen Lebensmittel mit ihren normalisierten Suchnamen. SQLite kann Umlaute und ß
// nicht wie `search-text.ts` falten; deshalb pflegt ihn dieses Repository bei jedem Schreiben einer
// Zeile, der Sync-Adapter nach jeder Übernahme und der Test-Seeder mit `rebuildOwnFoodIndex`.

/** Was Befehle und Sync von einem gespeicherten eigenen Lebensmittel wissen müssen. */
export type StoredOwnFood = Readonly<{
  personId: EntityId;
  origin: OwnFoodOrigin | null;
  deletedAt: Instant | null;
  serverVersion: ServerVersion | null;
}>;

/** Referenz auf ein eigenes Lebensmittel. */
export type OwnFoodRef = Extract<FoodRef, { type: 'eigen' }>;

/** Ein eigenes Lebensmittel als Lebensmittel der Suche: Referenz und aktuelle Fassung. */
export type OwnFoodChoice = Readonly<{ ref: OwnFoodRef; snapshot: NutritionSnapshot }>;

/** Die fachlichen Spalten einer Nutzlast bzw. eines kanonischen Datensatzes. */
function ownFoodColumns(food: OwnFoodUpsert) {
  return {
    name: food.name,
    baseUnit: food.baseUnit,
    referenceAmount: food.referenceAmount,
    milliKcal: food.milliKcal,
    proteinMg: food.proteinMg,
    carbsMg: food.carbsMg,
    fatMg: food.fatMg,
    portions: food.portions,
    originType: food.origin?.type ?? null,
    originKey: food.origin?.key ?? null,
  };
}

/** Die vollständige Zeile zu einem kanonischen Datensatz, ohne Serverversion und Löschmarkierung. */
export function ownFoodRecordRow(entityId: EntityId, record: OwnFoodRecord) {
  return { ...ownFoodColumns(record), id: entityId, personId: record.personId, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

/** Legt das eigene Lebensmittel an oder überschreibt seine fachlichen Felder (Last-Write-Wins). */
export function writeOwnFood(tx: TransactionContext, entityId: EntityId, personId: EntityId, payload: OwnFoodUpsert, at: Instant): void {
  const fields = { ...ownFoodColumns(payload), updatedAt: at };
  sqliteOf(tx)
    .insert(ownFood)
    .values({ ...fields, id: entityId, personId, createdAt: at })
    .onConflictDoUpdate({ target: ownFood.id, set: fields })
    .run();
  reindexOwnFood(tx, entityId);
}

/** Setzt die Löschmarkierung; Löschen ist ein Tombstone und für Clientoperationen endgültig. */
export function tombstoneOwnFood(tx: TransactionContext, entityId: EntityId, at: Instant): void {
  sqliteOf(tx).update(ownFood).set({ deletedAt: at, updatedAt: at }).where(eq(ownFood.id, entityId)).run();
  reindexOwnFood(tx, entityId);
}

export function readOwnFood(tx: ReadContext, entityId: EntityId): StoredOwnFood | undefined {
  const row = sqliteOf(tx)
    .select({
      personId: ownFood.personId,
      originType: ownFood.originType,
      originKey: ownFood.originKey,
      deletedAt: ownFood.deletedAt,
      serverVersion: ownFood.serverVersion,
    })
    .from(ownFood)
    .where(eq(ownFood.id, entityId))
    .get();
  return (
    row && {
      personId: EntityId.parse(row.personId),
      origin: row.originType === null ? null : OwnFoodOrigin.parse({ type: row.originType, key: row.originKey }),
      deletedAt: row.deletedAt as Instant | null,
      serverVersion: row.serverVersion as ServerVersion | null,
    }
  );
}

/** Überdeckte Quellen: die Herkunftsreferenzen aller nicht gelöschten eigenen Lebensmittel. */
export function overlaidOrigins(tx: ReadContext): OwnFoodOrigin[] {
  return sqliteOf(tx)
    .select({ type: ownFood.originType, key: ownFood.originKey })
    .from(ownFood)
    .where(and(isNull(ownFood.deletedAt), isNotNull(ownFood.originType)))
    .all()
    .map((origin) => OwnFoodOrigin.parse(origin));
}

/** Ein nicht gelöschtes eigenes Lebensmittel als Lebensmittel der Suche; sonst `undefined`. */
export function livingOwnFood(tx: ReadContext, entityId: EntityId): OwnFoodChoice | undefined {
  const row = sqliteOf(tx)
    .select()
    .from(ownFood)
    .where(and(eq(ownFood.id, entityId), isNull(ownFood.deletedAt)))
    .get();
  return row && { ref: { type: 'eigen', key: entityId }, snapshot: ownFoodSnapshot(valuesOf(row)) };
}

/**
 * Ein nicht gelöschtes eigenes Lebensmittel ohne Herkunftsreferenz mit genau diesen Werten; sonst `undefined`.
 * So findet das Markieren einer KI-Schätzung das eigene Lebensmittel wieder, das ein früheres Markieren aus
 * demselben Snapshot angelegt hat (#158).
 */
export function ownFoodWithValues(tx: ReadContext, values: FoodValues): OwnFoodChoice | undefined {
  const row = sqliteOf(tx)
    .select()
    .from(ownFood)
    .where(and(eq(ownFood.name, values.name), isNull(ownFood.originType), isNull(ownFood.deletedAt)))
    .orderBy(asc(ownFood.createdAt), asc(ownFood.id))
    .all()
    .find((candidate) => sameFoodValues(valuesOf(candidate), values));
  return row && { ref: { type: 'eigen', key: EntityId.parse(row.id) }, snapshot: ownFoodSnapshot(valuesOf(row)) };
}

/** Das nicht gelöschte eigene Lebensmittel, das diese Quelle überdeckt; sonst `undefined` (Spezifikation 2, Abschnitt 3). */
export function overlayingOwnFood(tx: ReadContext, origin: OwnFoodOrigin): OwnFoodChoice | undefined {
  const row = sqliteOf(tx)
    .select({ id: ownFood.id })
    .from(ownFood)
    .where(and(eq(ownFood.originType, origin.type), eq(ownFood.originKey, origin.key), isNull(ownFood.deletedAt)))
    .orderBy(desc(ownFood.updatedAt), asc(ownFood.id))
    .get();
  return row && livingOwnFood(tx, EntityId.parse(row.id));
}

/** Die nicht gelöschten eigenen Lebensmittel zur Anfrage, in der Rangfolge aus `ranked-search.ts`. */
export function searchOwnFoods(tx: ReadContext, query: SearchQuery, limit: number): OwnFoodChoice[] {
  const ids = sqliteOf(tx)
    .all<{ id: string }>(accountSearchQuery(query, limit, { table: 'own_food_search', fts: 'own_food_search', columns: 'own_food_id AS id', key: 'own_food_id' }))
    .map((row) => row.id);
  if (ids.length === 0) return [];
  const rows = sqliteOf(tx)
    .select()
    .from(ownFood)
    .where(and(inArray(ownFood.id, ids), isNull(ownFood.deletedAt)))
    .all();
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [{ ref: { type: 'eigen', key: EntityId.parse(id) }, snapshot: ownFoodSnapshot(valuesOf(row)) }];
  });
}

/** Baut den Suchindex aus allen nicht gelöschten eigenen Lebensmitteln neu auf, etwa nach dem Seeden. */
export function rebuildOwnFoodIndex(tx: TransactionContext): void {
  sqliteOf(tx).run(sql`DELETE FROM own_food_search`);
  const rows = sqliteOf(tx).select({ id: ownFood.id, name: ownFood.name }).from(ownFood).where(isNull(ownFood.deletedAt)).all();
  for (const row of rows) insertIndexRow(tx, row.id, row.name);
}

/** Bringt die Indexzeile eines eigenen Lebensmittels auf den Stand seiner Zeile. */
export function reindexOwnFood(tx: TransactionContext, entityId: EntityId): void {
  sqliteOf(tx).run(sql`DELETE FROM own_food_search WHERE own_food_id = ${entityId}`);
  const row = sqliteOf(tx).select({ name: ownFood.name, deletedAt: ownFood.deletedAt }).from(ownFood).where(eq(ownFood.id, entityId)).get();
  if (row !== undefined && row.deletedAt === null) insertIndexRow(tx, entityId, row.name);
}

function insertIndexRow(tx: TransactionContext, entityId: string, name: string): void {
  const { searchName, searchAlt } = searchNames(name);
  sqliteOf(tx).run(sql`INSERT INTO own_food_search (own_food_id, search_name, search_alt) VALUES (${entityId}, ${searchName}, ${searchAlt})`);
}

function valuesOf(row: typeof ownFood.$inferSelect) {
  return foodValuesOf({ ...row, baseUnit: BaseUnit.parse(row.baseUnit) });
}
