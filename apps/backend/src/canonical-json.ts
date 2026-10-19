/**
 * JSON mit sortierten Schlüsseln und ohne `undefined`-Felder: Gleicher Inhalt ergibt dieselbe
 * Zeichenfolge, gleich in welcher Reihenfolge der Client die Felder geschickt hat. Grundlage der
 * Hashes, an die Sync-Operationen und Online-Abläufe ihr gespeichertes Ergebnis binden.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
