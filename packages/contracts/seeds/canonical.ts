import type { SeedRow, SeedRows, SeedValue } from './manifest.ts';

// Kanonische Form eines Datenbankstands für den Vergleich mit dem Manifest: Tabellen und Schlüssel
// sortiert, Zeilen in fester Reihenfolge, leere Tabellen weggelassen. Zwei Stände sind genau dann
// gleich, wenn ihre kanonische Form gleich ist; die Zeilenzahl allein beweist nichts.

/** JSON mit sortierten Objektschlüsseln; Postgres speichert `jsonb` mit eigener Schlüsselreihenfolge. */
export function canonicalJson(value: SeedValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as SeedValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Tabellen sortiert, leere weggelassen, Zeilen nach ihrer kanonischen Form geordnet. */
export function canonicalRows(rows: SeedRows): SeedRows {
  return Object.fromEntries(
    Object.keys(rows)
      .sort()
      .filter((table) => (rows[table] ?? []).length > 0)
      .map((table) => [table, [...(rows[table] as SeedRow[])].sort((a, b) => compare(canonicalJson(a), canonicalJson(b)))]),
  );
}

/**
 * Tabellen so geordnet, dass jede nach den Tabellen kommt, auf die ihre Fremdschlüssel zeigen; beide
 * Seeder fügen in dieser Reihenfolge ein und leeren in umgekehrter. Selbstbezüge zählen nicht.
 */
export function dependencyOrder(tables: readonly Readonly<{ name: string; references: readonly string[] }>[]): string[] {
  const references = new Map(tables.map((table) => [table.name, table.references]));
  const ordered: string[] = [];
  const visit = (name: string, path: readonly string[]) => {
    if (ordered.includes(name) || path.includes(name)) return;
    for (const target of references.get(name) ?? []) if (target !== name) visit(target, [...path, name]);
    ordered.push(name);
  };
  for (const name of [...references.keys()].sort()) visit(name, []);
  return ordered;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
