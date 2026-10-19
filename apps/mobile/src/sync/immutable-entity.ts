import { eq } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';

import { EntityId, LocalDate, type ServerVersion } from '@abnehm/contracts/base';
import type { EntityData, SyncEntityType } from '@abnehm/contracts/sync';

import { sqliteOf } from '../local-db/sqlite';
import type { SyncEntityAdapter } from './registry';

/** Spalten einer unveränderlichen, tagesbezogenen Tabelle (Spezifikation 0, Abschnitt 8). */
type ImmutableDayColumns = {
  id: AnySQLiteColumn<{ data: string }>;
  personId: AnySQLiteColumn<{ data: string }>;
  localDate: AnySQLiteColumn<{ data: string }>;
  serverVersion: AnySQLiteColumn<{ data: string | null }>;
};

/**
 * Adapter für eine unveränderliche Entität, die genau eine Zeile mit Person und lokalem Tag ist, etwa
 * Tageszielerfüllung oder Energiebuchung. Sie entsteht lokal nur in Fachbefehlen und kommt vom Server
 * nur als kanonischer Datensatz: kein Upsert, kein Löschen, keine Löschmarkierung. Ein lokales Duplikat
 * derselben ID ersetzt der kanonische Datensatz vollständig.
 */
export function immutableDayEntity<T extends SQLiteTable & ImmutableDayColumns, R extends EntityData & { id: string }>(options: {
  entityType: SyncEntityType;
  ownerField: string;
  record: z.ZodType<R>;
  table: T;
  /** Die Zeile zum kanonischen Datensatz, ohne Serverversion. */
  row(data: R): T['$inferInsert'];
}): SyncEntityAdapter<never, R> {
  const { table, entityType } = options;
  return {
    entityType,
    ownerField: options.ownerField,
    upsert: null,
    deletable: false,
    record: options.record,
    applyCanonical(tx, { entityId, serverVersion, data }) {
      if (data.id !== entityId) throw new Error(`${entityType} mit abweichender ID`);
      const local = sqliteOf(tx).select({ serverVersion: table.serverVersion }).from(table as SQLiteTable).where(eq(table.id, entityId)).get() as
        | { serverVersion: ServerVersion | null }
        | undefined;
      if (local?.serverVersion != null && BigInt(local.serverVersion) > BigInt(serverVersion)) return;
      const row = { ...options.row(data), serverVersion };
      sqliteOf(tx)
        .insert(table)
        .values(row as never)
        .onConflictDoUpdate({ target: table.id, set: row as never })
        .run();
    },
    applyTombstone() {
      throw new Error(`${entityType} ist unveränderlich und wird nie gelöscht`);
    },
    reconcileRejected() {
      throw new Error(`${entityType} entsteht nur in Fachbefehlen`);
    },
    affectedDays(tx, entityId) {
      const row = sqliteOf(tx)
        .select({ personId: table.personId, localDate: table.localDate })
        .from(table as SQLiteTable)
        .where(eq(table.id, entityId))
        .get() as { personId: string; localDate: string } | undefined;
      return row === undefined ? [] : [{ type: 'tag', personId: EntityId.parse(row.personId), localDate: LocalDate.parse(row.localDate) }];
    },
  };
}
