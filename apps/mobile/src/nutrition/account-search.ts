import { sql, type SQL } from 'drizzle-orm';

import { rankedSearch, type SearchSource } from './ranked-search';
import type { SearchQuery } from './search-text';

// Die gerankte Suche aus `ranked-search.ts` als Drizzle-Abfrage für die Kontodatenbank: eigene Lebensmittel
// (#157) und gescannte Produkte (#160). Der BLS-Katalog bindet dieselbe Abfrage über expo-sqlite selbst.

/** Abfrage über einen lokalen Suchindex der Kontodatenbank; jede Zeile hat zusätzlich die Spalte `tier`. */
export function accountSearchQuery(query: SearchQuery, limit: number, source: SearchSource): SQL {
  const ranked = rankedSearch(query, limit, source);
  // Der Text enthält außer den Platzhaltern kein `?`: Bezeichner sind fest, Suchwörter gebunden.
  const parts = ranked.sql.split('?');
  if (parts.length !== ranked.params.length + 1) throw new Error('Platzhalter und Parameter passen nicht zusammen');
  return sql.join(parts.map((part, index) => (index < ranked.params.length ? sql`${sql.raw(part)}${ranked.params[index]}` : sql.raw(part))));
}
