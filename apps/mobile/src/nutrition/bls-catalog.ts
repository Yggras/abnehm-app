import { NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { CatalogDatabase, CatalogValue } from '../local-db/catalog';
import { withinWordMinimumLength, type SearchQuery } from './search-text';

// Lesender Zugriff auf den BLS-Katalog (Spezifikation 2, Abschnitte 3 und 4). Die Datei baut
// `scripts/bls-catalog/catalog-file.ts`; Werte stehen dort je 100 g in `milli_kcal` bzw. mg.

/** Ein BLS-Lebensmittel als vollständiger Nährwert-Snapshot je 100 g. */
export type BlsFood = Readonly<{ key: string; snapshot: NutritionSnapshot }>;

export type BlsCatalog = {
  /**
   * Treffer in Rangfolge: Der Name beginnt mit der Anfrage, dann beginnt ein Wort mit jedem Suchwort
   * (FTS5-Präfixsuche), dann steckt ein Suchwort ab drei Zeichen im Wortinneren (Nutzerentscheidung
   * vom 28.10.2026 in #154). Innerhalb einer Stufe stehen kürzere Namen vorn.
   */
  search(query: SearchQuery, limit: number): BlsFood[];
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

  return {
    search(query, limit) {
      if (query.terms.length === 0) return [];
      const { sql, params } = rankedSearch(query, limit);
      return database.all<FoodRow>(sql, params).map(snapshotOf);
    },
  };
}

/**
 * Abfrage über beide Schreibweisen (`search_name`, `search_alt`). Suchwörter bestehen nur aus a–z und
 * 0–9; in FTS5-Phrasen und LIKE-Mustern haben sie keine Sonderbedeutung.
 */
function rankedSearch(query: SearchQuery, limit: number): { sql: string; params: CatalogValue[] } {
  const prefixMatch = query.terms.map((term) => `"${term}"*`).join(' AND ');
  const startsWith = `${query.text}%`;

  // Treffer im Wortinneren nur, wenn ein Suchwort mindestens drei Zeichen hat. Kürzere Suchwörter
  // müssen dann am Wortanfang stehen: Wörter sind durch genau ein Leerzeichen getrennt.
  const withinWords = query.terms.some((term) => term.length >= withinWordMinimumLength);
  const withinWordTerms = withinWords
    ? query.terms.map((term) =>
        term.length >= withinWordMinimumLength ? { padding: '', needle: term } : { padding: `' ' || `, needle: ` ${term}` },
      )
    : [];
  const withinWordCondition = withinWordTerms
    .map(({ padding }) => `(instr(${padding}search_name, ?) > 0 OR instr(${padding}search_alt, ?) > 0)`)
    .join(' AND ');

  return {
    sql: `
      WITH prefix AS (SELECT rowid FROM food_search WHERE food_search MATCH ?)
      SELECT key, name, milli_kcal_per_100 AS milliKcal, protein_mg_per_100 AS proteinMg,
             carbs_mg_per_100 AS carbsMg, fat_mg_per_100 AS fatMg,
             CASE WHEN rowid NOT IN prefix THEN 2
                  WHEN search_name LIKE ? OR search_alt LIKE ? THEN 0
                  ELSE 1 END AS tier
      FROM food
      WHERE rowid IN prefix ${withinWords ? `OR (${withinWordCondition})` : ''}
      ORDER BY tier, length(search_name), search_name, key
      LIMIT ?`,
    params: [prefixMatch, startsWith, startsWith, ...withinWordTerms.flatMap(({ needle }) => [needle, needle]), limit],
  };
}
