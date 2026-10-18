import { sql, type SQL } from 'drizzle-orm';
import { integer, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

// Gemeinsame Spalten des SQLite-Schemas (Spezifikation 0, Abschnitt 8). Die Typabbildung ist
// verbindlich: UUIDs, lokale Tage (`YYYY-MM-DD`) und Zeitpunkte (UTC-ISO-8601) als TEXT, IANA-Zone
// und ursprünglicher Offset getrennt, Messwerte als Ganzzahl, `server_version` als
// Dezimalzeichenfolge. Namen und Constraints entsprechen dem Postgres-Schema des Backends
// (apps/backend/src/db/schema); test/schema-paritaet.test.ts vergleicht beide.

export const id = () => text('id').primaryKey();
export const ref = (name: string) => text(name);
export const instant = (name: string) => text(name);
export const localDate = (name: string) => text(name);
export const flag = (name: string) => integer(name, { mode: 'boolean' });
export const whole = (name: string) => integer(name);
export const small = (name: string) => integer(name);
export const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
export { text };

/** Serverversion als Dezimalzeichenfolge; lokal leer, solange ein Create unbestätigt ist. */
export const serverVersion = () => text('server_version');

/**
 * Sync-Felder jeder veränderlichen synchronisierten Entität. Die Eigentumsgrenze (`person_id` bzw.
 * `coupling_id`) legt jede Tabelle selbst an. Löschen ist ein Tombstone über `deleted_at`.
 */
export const mutable = () => ({
  createdAt: instant('created_at').notNull(),
  updatedAt: instant('updated_at').notNull(),
  deletedAt: instant('deleted_at'),
  serverVersion: serverVersion(),
});

/**
 * Unveränderliche Entitäten: fachlich kein Update und kein Delete. Lokal ersetzt der Sync ein
 * Duplikat durch den kanonischen Datensatz des Servers; deshalb gibt es hier keine Trigger.
 */
export const immutable = () => ({
  createdAt: instant('created_at').notNull(),
  serverVersion: serverVersion(),
});

/** Tagesbezogene Daten: lokaler Tag, IANA-Zone und der beim Anlegen geltende Offset in Minuten. */
export const day = () => ({
  localDate: localDate('local_date').notNull(),
  timeZone: text('time_zone').notNull(),
  utcOffsetMinutes: integer('utc_offset_minutes').notNull(),
});

/** `<spalte> IN ('a', 'b', …)` für Enum-CHECKs; Werte stammen aus dem Vertragsmodul. */
export function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map(literal).join(', '))})`;
}

function literal(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Ungeeigneter Enum-Wert für einen CHECK: ${value}`);
  return `'${value}'`;
}
