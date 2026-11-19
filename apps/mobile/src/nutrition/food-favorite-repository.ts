import { and, eq, isNull } from 'drizzle-orm';

import { EntityId, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import { FoodFavoriteUpsert, type FoodFavoriteRecord, type FoodRef } from '@abnehm/contracts/nutrition';

import type { ReadContext, TransactionContext } from '../local-db';
import { foodFavorite } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository der Lebensmittelfavoriten (Spezifikation 2, Abschnitt 7): neben dem Sync-Adapter die
// einzige Stelle, die Drizzle und die Tabelle `food_favorite` sieht. Die Nutzlast führt die Referenz als
// `foodRef`, die Tabelle als `food_ref_type` und `food_ref_key`. Ein Favorit wird nie gelöscht; eine
// entfernte Markierung steht in `removed_at` (#158).

/** Was Befehle und Sync von einem gespeicherten Favoriten wissen müssen. */
export type StoredFoodFavorite = Readonly<{
  personId: EntityId;
  serverVersion: ServerVersion | null;
  content: FoodFavoriteUpsert;
}>;

/** Ein markierter Favorit: Referenz, letzte vollständige Fassung und Zeitpunkt der letzten Änderung. */
export type MarkedFoodFavorite = Readonly<{ id: EntityId; content: FoodFavoriteUpsert; updatedAt: Instant }>;

/** Die fachlichen Spalten einer Nutzlast bzw. eines kanonischen Datensatzes. */
function favoriteColumns(favorite: FoodFavoriteUpsert) {
  return { foodRefType: favorite.foodRef.type, foodRefKey: favorite.foodRef.key, snapshot: favorite.snapshot, removedAt: favorite.removedAt };
}

/** Die vollständige Zeile zu einem kanonischen Datensatz, ohne Serverversion und Löschmarkierung. */
export function foodFavoriteRecordRow(entityId: EntityId, record: FoodFavoriteRecord) {
  return { ...favoriteColumns(record), id: entityId, personId: record.personId, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

/** Legt den Favoriten an oder überschreibt seine fachlichen Felder (Last-Write-Wins). */
export function writeFoodFavorite(tx: TransactionContext, entityId: EntityId, personId: EntityId, payload: FoodFavoriteUpsert, at: Instant): void {
  const fields = { ...favoriteColumns(payload), updatedAt: at };
  sqliteOf(tx)
    .insert(foodFavorite)
    .values({ ...fields, id: entityId, personId, createdAt: at })
    .onConflictDoUpdate({ target: foodFavorite.id, set: fields })
    .run();
}

export function readFoodFavorite(tx: ReadContext, entityId: EntityId): StoredFoodFavorite | undefined {
  const row = sqliteOf(tx).select().from(foodFavorite).where(eq(foodFavorite.id, entityId)).get();
  return row && { personId: EntityId.parse(row.personId), serverVersion: row.serverVersion as ServerVersion | null, content: contentOf(row) };
}

/** Die markierten Favoriten der Person, ohne entfernte und (vom Server) gelöschte. */
export function markedFoodFavorites(tx: ReadContext, personId: EntityId): MarkedFoodFavorite[] {
  return sqliteOf(tx)
    .select()
    .from(foodFavorite)
    .where(and(eq(foodFavorite.personId, personId), isNull(foodFavorite.removedAt), isNull(foodFavorite.deletedAt)))
    .all()
    .map((row) => ({ id: EntityId.parse(row.id), content: contentOf(row), updatedAt: row.updatedAt as Instant }));
}

function contentOf(row: typeof foodFavorite.$inferSelect): FoodFavoriteUpsert {
  return FoodFavoriteUpsert.parse({
    foodRef: { type: row.foodRefType, key: row.foodRefKey } satisfies Record<keyof FoodRef, string>,
    snapshot: row.snapshot,
    removedAt: row.removedAt,
  });
}
