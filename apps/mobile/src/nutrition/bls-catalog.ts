import { NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { CatalogDatabase, CatalogValue } from '../local-db/catalog';
import { withinWordMinimumLength, type SearchQuery } from './search-text';

// Lesender Zugriff auf den BLS-Katalog (Spezifikation 2, Abschnitte 3 und 4). Die Datei baut
// `scripts/bls-catalog/catalog-file.ts`; Werte stehen dort je 100 g in `milli_kcal` bzw. mg.

/** Ein BLS-Lebensmittel als vollständiger Nährwert-Snapshot je 100 g. */
export type BlsFood = Readonly<{ key: string; snapshot: NutritionSnapshot }>;

export type BlsCatalog = {
  /**
   * Treffer in Rangfolge (#154): Der Name beginnt mit der Anfrage, und dort endet ein Wort; dann
   * beginnt der Name mit ihr, ohne Leerzeichen gezählt; dann beginnt ein Wort mit jedem Suchwort
   * (FTS5-Präfixsuche); zuletzt steckt ein Suchwort ab drei Zeichen im Wortinneren
   * (Nutzerentscheidung vom 28.10.2026). Innerhalb einer Stufe stehen kürzere Namen vorn.
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
  // Parameter in der Reihenfolge ihres Platzhalters im Text; nummerierte Platzhalter (`?2`) bindet
  // better-sqlite3 nicht aus einer Liste.
  const params: CatalogValue[] = [];
  const bind = (value: CatalogValue) => {
    params.push(value);
    return '?';
  };

  // Der Namensanfang zählt ohne Leerzeichen: Der BLS schreibt etwa „Hafer Flocken“, gesucht wird
  // „Haferflocken“. Endet die Anfrage an einer Wortgrenze des Namens („Apfel roh“), steht der Treffer
  // vor Namen, in denen das Wort weitergeht („Apfelmus“).
  const compact = query.terms.join('');
  const compactName = (column: string) => `replace(${column}, ' ', '')`;
  const either = (condition: (column: string) => string) => `(${condition('search_name')} OR ${condition('search_alt')})`;
  const endsAtWordBoundary = () =>
    either((column) => `${column} = ${bind(query.text)} OR ${column} LIKE ${bind(`${query.text} %`)} OR ${compactName(column)} = ${bind(compact)}`);
  const startsWithQuery = () => either((column) => `${compactName(column)} LIKE ${bind(`${compact}%`)}`);

  // Treffer im Wortinneren nur, wenn ein Suchwort mindestens drei Zeichen hat. Kürzere Suchwörter
  // müssen dann am Wortanfang stehen: Wörter sind durch genau ein Leerzeichen getrennt.
  const withinWords = query.terms.some((term) => term.length >= withinWordMinimumLength);
  const withinWordCondition = () =>
    query.terms
      .map((term) => {
        const inside = term.length >= withinWordMinimumLength;
        const [name, alt] = inside ? ['search_name', 'search_alt'] : [`' ' || search_name`, `' ' || search_alt`];
        const needle = inside ? term : ` ${term}`;
        return `(instr(${name}, ${bind(needle)}) > 0 OR instr(${alt}, ${bind(needle)}) > 0)`;
      })
      .join(' AND ');

  const sql = `
    WITH prefix AS (SELECT rowid FROM food_search WHERE food_search MATCH ${bind(query.terms.map((term) => `"${term}"*`).join(' AND '))})
    SELECT key, name, milli_kcal_per_100 AS milliKcal, protein_mg_per_100 AS proteinMg,
           carbs_mg_per_100 AS carbsMg, fat_mg_per_100 AS fatMg,
           CASE WHEN ${endsAtWordBoundary()} THEN 0 WHEN ${startsWithQuery()} THEN 1 WHEN rowid IN prefix THEN 2 ELSE 3 END AS tier
    FROM food
    WHERE rowid IN prefix OR ${startsWithQuery()} ${withinWords ? `OR (${withinWordCondition()})` : ''}
    ORDER BY tier, length(search_name), search_name, key
    LIMIT ${bind(limit)}`;
  return { sql, params };
}
