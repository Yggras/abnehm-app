import { sql, type SQL } from 'drizzle-orm';
import { bigint, boolean, date, integer, jsonb, smallint, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

// Gemeinsame Spalten des Postgres-Schemas (Spezifikation 0, Abschnitt 8). Die Typabbildung ist
// verbindlich: UUIDs als `uuid`, lokale Tage als `date`, Zeitpunkte als `timestamptz`, IANA-Zone und
// ursprünglicher Offset getrennt, Messwerte als Ganzzahl, `server_version` als `bigint`.
// Das SQLite-Schema der App (apps/mobile/src/local-db/schema) bildet dieselben Namen ab.

export const id = () => uuid('id').primaryKey();
export const ref = (name: string) => uuid(name);
export const instant = (name: string) => timestamp(name, { withTimezone: true });
export const localDate = (name: string) => date(name, { mode: 'string' });
export const flag = (name: string) => boolean(name);
export const whole = (name: string) => integer(name);
export const small = (name: string) => smallint(name);
export const json = <T>(name: string) => jsonb(name).$type<T>();
export { text };

/** Serverversion bzw. Position im Änderungsprotokoll; nach außen eine Dezimalzeichenfolge. */
export const serverVersion = () => bigint('server_version', { mode: 'bigint' }).notNull();

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

/** Unveränderliche Entitäten: kein Update, kein Delete (Trigger in der Migration `immutable_entities`). */
export const immutable = () => ({
  createdAt: instant('created_at').notNull(),
  serverVersion: serverVersion(),
});

/** Tagesbezogene Daten: lokaler Tag, IANA-Zone und der beim Anlegen geltende Offset in Minuten. */
export const day = () => ({
  localDate: localDate('local_date').notNull(),
  timeZone: text('time_zone').notNull(),
  utcOffsetMinutes: smallint('utc_offset_minutes').notNull(),
});

/** `<spalte> IN ('a', 'b', …)` für Enum-CHECKs; Werte stammen aus dem Vertragsmodul. */
export function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map(literal).join(', '))})`;
}

function literal(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Ungeeigneter Enum-Wert für einen CHECK: ${value}`);
  return `'${value}'`;
}
