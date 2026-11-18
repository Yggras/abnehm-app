import { withinWordMinimumLength, type SearchQuery } from './search-text';

// Rangfolge innerhalb einer Gruppe der Lebensmittelsuche (Spezifikation 2, Abschnitt 4; #154), gleich
// für den BLS-Katalog und die eigenen Lebensmittel (#157): Der Name beginnt mit der Anfrage, und dort
// endet ein Wort; dann beginnt der Name mit ihr, ohne Leerzeichen gezählt; dann beginnt ein Wort mit
// jedem Suchwort (FTS5-Präfixsuche); zuletzt steckt ein Suchwort ab drei Zeichen im Wortinneren
// (Nutzerentscheidung vom 28.10.2026). Innerhalb einer Stufe stehen kürzere Namen vorn.

/** Ein gebundener Parameter; dieselben Typen nehmen Katalog- und Kontodatenbank. */
export type SearchParam = string | number;

/**
 * Wo gesucht wird: eine Tabelle mit den normalisierten Suchnamen `search_name` und `search_alt` (null,
 * wenn gleich) und ein FTS5-Index, dessen `rowid` die Zeilen der Tabelle nennt. Beide dürfen dieselbe
 * FTS5-Tabelle sein. `columns` und `key` sind feste Bezeichner des Aufrufers, nie Eingaben der Person.
 */
export type SearchSource = Readonly<{ table: string; fts: string; columns: string; key: string }>;

/** Über so viele Wörter des Namens darf sich die Anfrage am Namensanfang erstrecken (Designwert, nicht belegt). */
const maxSpacesBeforeBoundary = 7;

/**
 * Abfrage über beide Schreibweisen (`search_name`, `search_alt`) mit Parametern in der Reihenfolge
 * ihrer Platzhalter. Suchwörter bestehen nur aus a–z und 0–9; in FTS5-Phrasen und LIKE-Mustern haben
 * sie keine Sonderbedeutung. Jede Zeile hat zusätzlich die Spalte `tier`.
 */
export function rankedSearch(query: SearchQuery, limit: number, source: SearchSource): { sql: string; params: SearchParam[] } {
  // Parameter in der Reihenfolge ihres Platzhalters im Text; nummerierte Platzhalter (`?2`) bindet
  // better-sqlite3 nicht aus einer Liste.
  const params: SearchParam[] = [];
  const bind = (value: SearchParam) => {
    params.push(value);
    return '?';
  };

  // Der Namensanfang zählt ohne Leerzeichen: Der BLS schreibt etwa „Hafer Flocken“, gesucht wird
  // „Haferflocken“. Endet die Anfrage an einer Wortgrenze des Namens („Apfel roh“, „Hafer Flocken,
  // gekocht“), steht der Treffer vor Namen, in denen das Wort weitergeht („Apfelmus“). Die Grenze
  // liegt hinter den ersten `compact.length + s` Zeichen des Namens, wenn diese genau `s` Leerzeichen
  // enthalten; geprüft werden bis zu `maxSpacesBeforeBoundary` Leerzeichen.
  const compact = query.terms.join('');
  const either = (condition: (column: string) => string) => `(${condition('search_name')} OR ${condition('search_alt')})`;
  const endsAtWordBoundary = () =>
    either((column) =>
      Array.from({ length: maxSpacesBeforeBoundary + 1 }, (_, spaces) => {
        const end = compact.length + spaces;
        return `(replace(substr(${column}, 1, ${bind(end)}), ' ', '') = ${bind(compact)} AND substr(${column}, ${bind(end + 1)}, 1) IN ('', ' '))`;
      }).join(' OR '),
    );
  const startsWithQuery = () => either((column) => `replace(${column}, ' ', '') LIKE ${bind(`${compact}%`)}`);

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

  const { table, fts, columns, key } = source;
  const sql = `
    WITH prefix AS (SELECT rowid FROM ${fts} WHERE ${fts} MATCH ${bind(query.terms.map((term) => `"${term}"*`).join(' AND '))})
    SELECT ${columns},
           CASE WHEN ${endsAtWordBoundary()} THEN 0 WHEN ${startsWithQuery()} THEN 1 WHEN rowid IN prefix THEN 2 ELSE 3 END AS tier
    FROM ${table}
    WHERE rowid IN prefix OR ${startsWithQuery()} ${withinWords ? `OR (${withinWordCondition()})` : ''}
    ORDER BY tier, length(search_name), search_name, ${key}
    LIMIT ${bind(limit)}`;
  return { sql, params };
}
