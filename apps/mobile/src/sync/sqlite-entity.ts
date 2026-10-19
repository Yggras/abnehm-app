import { and, eq, isNull } from 'drizzle-orm';
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';

import type { EntityId } from '@abnehm/contracts/base';
import type { EntityData, SyncEntityType } from '@abnehm/contracts/sync';

import type { TransactionContext } from '../local-db';
import { sqliteOf } from '../local-db/sqlite';
import type { CanonicalEntity, EntityTombstone, PendingChange, SyncEntityAdapter } from './registry';

/** Sync-Spalten jeder synchronisierten lokalen Tabelle (Spezifikation 0, Abschnitt 8). */
type SyncedColumns = {
  id: AnySQLiteColumn<{ data: string }>;
  serverVersion: AnySQLiteColumn<{ data: string | null }>;
  deletedAt: AnySQLiteColumn<{ data: string | null }>;
};

/**
 * Baut die Adapteroperationen für eine Entität, die genau eine Zeile einer lokalen Tabelle ist. Der
 * Bereich nennt, wie aus dem kanonischen Datensatz die Zeile wird und wie er eine offene Operation
 * erneut anwendet; Versionsprüfung, Löschmarkierung und Reconciliation übernimmt diese Hilfe.
 * Das Ergebnis ist ein gewöhnlicher `SyncEntityAdapter` ohne Drizzle-Typen.
 */
export function sqliteEntity<T extends SQLiteTable & SyncedColumns, U extends EntityData, R extends EntityData>(options: {
  entityType: SyncEntityType;
  ownerField: string;
  upsert: z.ZodType<U> | null;
  deletable: boolean;
  record: z.ZodType<R>;
  table: T;
  /**
   * Die vollständige Zeile zum kanonischen Datensatz, ohne Serverversion und Löschmarkierung. `tx` dient
   * nur dem Lesen lokal gespiegelter Spalten, etwa des Kopplungsstatus am Mitglied.
   */
  row(entityId: EntityId, data: R, tx: TransactionContext): T['$inferInsert'];
  /** Wendet eine offene Operation erneut an, genau wie beim Erfassen. */
  replay(tx: TransactionContext, entityId: EntityId, change: PendingChange<U>): void;
}): SyncEntityAdapter<U, R> {
  const { table } = options;

  function localVersion(tx: TransactionContext, entityId: EntityId) {
    return sqliteOf(tx).select({ serverVersion: table.serverVersion }).from(table as SQLiteTable).where(eq(table.id, entityId)).get() as
      | { serverVersion: string | null }
      | undefined;
  }

  function applyCanonical(tx: TransactionContext, record: CanonicalEntity<R>) {
    const local = localVersion(tx, record.entityId)?.serverVersion;
    if (local != null && BigInt(local) > BigInt(record.serverVersion)) return;
    const row = { ...options.row(record.entityId, record.data, tx), serverVersion: record.serverVersion, deletedAt: null };
    sqliteOf(tx)
      .insert(table)
      .values(row as never)
      .onConflictDoUpdate({ target: table.id, set: row as never })
      .run();
  }

  function applyTombstone(tx: TransactionContext, tombstone: EntityTombstone) {
    sqliteOf(tx)
      .update(table)
      .set({ deletedAt: tombstone.deletedAt, serverVersion: tombstone.serverVersion } as never)
      .where(eq(table.id, tombstone.entityId))
      .run();
  }

  return {
    entityType: options.entityType,
    ownerField: options.ownerField,
    upsert: options.upsert,
    deletable: options.deletable,
    record: options.record,
    applyCanonical,
    applyTombstone,
    reconcileRejected(tx, rejection) {
      const { canonical } = rejection;
      // Ohne kanonischen Zustand verschwindet nur, was der Server nie bestätigt hat; eine bestätigte
      // eigene Zeile (etwa die Person) kann der Server nicht nachträglich vorenthalten.
      if (canonical === null) sqliteOf(tx).delete(table).where(and(eq(table.id, rejection.entityId), isNull(table.serverVersion))).run();
      else if (canonical.type === 'record') applyCanonical(tx, canonical);
      else applyTombstone(tx, canonical);
      for (const change of rejection.pending) options.replay(tx, rejection.entityId, change);
    },
  };
}
