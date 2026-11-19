import { NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { CatalogDatabase } from '../local-db';
import { rankedSearch } from './ranked-search';
import type { SearchQuery } from './search-text';

// Lesender Zugriff auf den BLS-Katalog (Spezifikation 2, Abschnitte 3 und 4). Die Datei baut
// `scripts/bls-catalog/catalog-file.ts`; Werte stehen dort je 100 g in `milli_kcal` bzw. mg.

/** Ein BLS-Lebensmittel als vollständiger Nährwert-Snapshot je 100 g. */
export type BlsFood = Readonly<{ key: string; snapshot: NutritionSnapshot }>;

export type BlsCatalog = {
  /** Treffer in der Rangfolge aus `ranked-search.ts` (#154). */
  search(query: SearchQuery, limit: number): BlsFood[];
  /** Das Lebensmittel zu einem Schlüssel; `null`, wenn er nicht (mehr) im Katalog steht (#158). */
  byKey(key: string): BlsFood | null;
};

type FoodRow = {
  key: string;
  name: string;
  milliKcal: number;
  proteinMg: number;
  carbsMg: number;
  fatMg: number;
};

export function createBlsCatalog(database: CatalogDatabase): BlsCatalog {
  let attribution: string | undefined;
  const snapshotOf = (row: FoodRow): BlsFood => {
    attribution ??= database.all<{ attribution: string }>('SELECT attribution FROM catalog_info')[0]?.attribution;
    return {
      key: row.key,
      // BLS-Werte gelten je 100 g essbaren Anteil (BLS-4.0-Dokumentation, Abschnitt 7.2).
      snapshot: NutritionSnapshot.parse({
        name: row.name,
        baseUnit: 'g',
        referenceAmount: 100_000,
        milliKcal: row.milliKcal,
        proteinMg: row.proteinMg,
        carbsMg: row.carbsMg,
        fatMg: row.fatMg,
        portions: [],
        source: 'bls',
        attribution: attribution ?? null,
      }),
    };
  };

  const columns = 'key, name, milli_kcal_per_100 AS milliKcal, protein_mg_per_100 AS proteinMg, carbs_mg_per_100 AS carbsMg, fat_mg_per_100 AS fatMg';
  return {
    search(query, limit) {
      const { sql, params } = rankedSearch(query, limit, { table: 'food', fts: 'food_search', key: 'key', columns });
      return database.all<FoodRow>(sql, params).map(snapshotOf);
    },
    byKey(key) {
      const row = database.all<FoodRow>(`SELECT ${columns} FROM food WHERE key = ?`, [key])[0];
      return row === undefined ? null : snapshotOf(row);
    },
  };
}
