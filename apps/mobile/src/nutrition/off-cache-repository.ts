import { eq, inArray, sql } from 'drizzle-orm';

import { Instant } from '@abnehm/contracts/base';
import { BaseUnit, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { ReadContext, TransactionContext } from '../local-db';
import { offCache } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { accountSearchQuery } from './account-search';
import { productSnapshot, type OffProduct } from './food-product-source';
import { searchNames, type SearchQuery } from './search-text';

// Repository des lokalen Open-Food-Facts-Caches (Spezifikation 2, Abschnitt 3; #160): die einzige Stelle, die
// Drizzle und die Tabellen `off_cache` und `off_cache_search` sieht. Der Cache ist eine lokale, nicht
// synchronisierte Tabelle der Kontodatenbank, getrennt von eigenen Daten. Werte stehen je 100 g bzw. 100 ml.
//
// `off_cache_search` ist der lokale FTS5-Index (Migration `0007_off_cache_search`) über die vollständigen
// Produkte; unvollständige lassen sich nicht erfassen und erscheinen deshalb nicht in der Suche. Ihn pflegt
// dieses Repository bei jedem Schreiben und der Test-Seeder mit `rebuildOffCacheIndex`.

/** Ein Cache-Eintrag: das Produkt und wann es zuletzt bei Open Food Facts abgefragt wurde. */
export type CachedProduct = Readonly<{ product: OffProduct; fetchedAt: Instant }>;

/** Der Cache-Eintrag zum Barcode; sonst `undefined`. */
export function readCachedProduct(tx: ReadContext, barcode: string): CachedProduct | undefined {
  const row = sqliteOf(tx).select().from(offCache).where(eq(offCache.barcode, barcode)).get();
  return row && { product: productOf(row), fetchedAt: Instant.parse(row.fetchedAt) };
}

/** Ein vollständiges Produkt des Caches als Snapshot; `null` ohne Eintrag oder mit fehlenden Nährwerten. */
export function cachedProduct(tx: ReadContext, barcode: string): NutritionSnapshot | null {
  const cached = readCachedProduct(tx, barcode);
  return cached === undefined ? null : productSnapshot(cached.product);
}

/** Legt den Cache-Eintrag an oder ersetzt ihn samt Abfragezeitpunkt und Indexzeile. */
export function writeCachedProduct(tx: TransactionContext, barcode: string, product: OffProduct, fetchedAt: Instant): void {
  const fields = {
    // Die Tabelle verlangt einen Namen; ohne ihn ist das Produkt unvollständig (`productSnapshot`).
    name: product.name ?? '',
    brand: product.brand,
    baseUnit: product.baseUnit,
    milliKcalPer100: product.milliKcalPer100,
    proteinMgPer100: product.proteinMgPer100,
    carbsMgPer100: product.carbsMgPer100,
    fatMgPer100: product.fatMgPer100,
    portions: [...product.portions],
    fetchedAt,
  };
  sqliteOf(tx)
    .insert(offCache)
    .values({ barcode, ...fields })
    .onConflictDoUpdate({ target: offCache.barcode, set: fields })
    .run();
  reindex(tx, barcode, product);
}

/** Die vollständigen Produkte zur Anfrage, in der Rangfolge aus `ranked-search.ts`. */
export function searchCachedProducts(tx: ReadContext, query: SearchQuery, limit: number): { barcode: string; snapshot: NutritionSnapshot }[] {
  const barcodes = sqliteOf(tx)
    .all<{ barcode: string }>(accountSearchQuery(query, limit, { table: 'off_cache_search', fts: 'off_cache_search', columns: 'barcode', key: 'barcode' }))
    .map((row) => row.barcode);
  if (barcodes.length === 0) return [];
  const rows = new Map(
    sqliteOf(tx)
      .select()
      .from(offCache)
      .where(inArray(offCache.barcode, barcodes))
      .all()
      .map((row) => [row.barcode, row]),
  );
  return barcodes.flatMap((barcode) => {
    const row = rows.get(barcode);
    const snapshot = row === undefined ? null : productSnapshot(productOf(row));
    return snapshot === null ? [] : [{ barcode, snapshot }];
  });
}

/** Baut den Suchindex aus allen Cache-Einträgen neu auf, etwa nach dem Seeden. */
export function rebuildOffCacheIndex(tx: TransactionContext): void {
  sqliteOf(tx).run(sql`DELETE FROM off_cache_search`);
  for (const row of sqliteOf(tx).select().from(offCache).all()) reindex(tx, row.barcode, productOf(row));
}

function reindex(tx: TransactionContext, barcode: string, product: OffProduct): void {
  sqliteOf(tx).run(sql`DELETE FROM off_cache_search WHERE barcode = ${barcode}`);
  const snapshot = productSnapshot(product);
  if (snapshot === null) return;
  const { searchName, searchAlt } = searchNames(snapshot.name);
  sqliteOf(tx).run(sql`INSERT INTO off_cache_search (barcode, search_name, search_alt) VALUES (${barcode}, ${searchName}, ${searchAlt})`);
}

function productOf(row: typeof offCache.$inferSelect): OffProduct {
  return {
    name: row.name === '' ? null : row.name,
    brand: row.brand,
    baseUnit: BaseUnit.parse(row.baseUnit),
    milliKcalPer100: row.milliKcalPer100,
    proteinMgPer100: row.proteinMgPer100,
    carbsMgPer100: row.carbsMgPer100,
    fatMgPer100: row.fatMgPer100,
    portions: row.portions,
  };
}
