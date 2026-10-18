import { and, eq, inArray } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

import type { EntityId } from '@abnehm/contracts/base';
import type { EntityData, SyncEntityType } from '@abnehm/contracts/sync';

import type { ResourceEntity } from '../authorization/authorization.ts';
import type { DbExecutor } from '../database.ts';

// Entitäts-Registry des Syncs (Spezifikation 0, Abschnitt 10). Ein Bereich meldet seine Entität mit
// Transport-Schema, Ressource der zentralen Autorisierung (Eigentumsregel) und den Speicheroperationen
// an; der Sync-Kern bleibt dabei unverändert. Für eigene Einträge mit `person_id` baut `ownedEntity`
// die Operationen aus der Tabelle.

/** Eine Entität, wie sie in Postgres liegt: Serverversion, Löschmarkierung und kanonische Felder. */
export type StoredEntity = Readonly<{ serverVersion: bigint; deletedAt: Date | null; data: EntityData }>;

export type EntityWrite = Readonly<{
  entityId: EntityId;
  /** Geprüfte Nutzlast ohne Eigentums-, Server- und abgeleitete Felder. */
  payload: EntityData;
  /** Eigentümer aus der Sitzung; gesetzt nur beim Anlegen, nie geändert. */
  ownerPersonId: EntityId;
  /** Ob die Entität schon existiert, laut Autorisierung. */
  exists: boolean;
  serverVersion: bigint;
  at: Date;
}>;

export type EntityRemoval = Readonly<{ entityId: EntityId; serverVersion: bigint; at: Date }>;

export type ServerSyncEntity = Readonly<{
  entityType: SyncEntityType;
  /** Ressource der Operationsmatrix; ihre Regel entscheidet über Eigentum, Lesen, Upsert und Löschen. */
  resource: ResourceEntity;
  /** Transport-Schema des generischen Upserts; `null`, wenn die Entität kein Upsert kennt. */
  upsert: z.ZodType<EntityData> | null;
  /** Ob `delete_entity` erlaubt ist; Löschen schreibt eine Löschmarkierung. */
  deletable: boolean;
  /** Liest Entitäten in der Transaktion des Aufrufers; fehlende IDs fehlen in der Antwort. */
  read(tx: DbExecutor, ids: readonly EntityId[]): Promise<ReadonlyMap<string, StoredEntity>>;
  /** Schreibt die vollständige Nutzlast (Last-Write-Wins) samt Serverversion. */
  write(tx: DbExecutor, change: EntityWrite): Promise<void>;
  /** Setzt die Löschmarkierung samt Serverversion. */
  remove(tx: DbExecutor, removal: EntityRemoval): Promise<void>;
}>;

/** Spalten jeder eigenen veränderlichen Entität (Spezifikation 0, Abschnitt 8). */
type OwnedColumns = {
  id: AnyPgColumn<{ data: string }>;
  personId: AnyPgColumn<{ data: string }>;
  createdAt: AnyPgColumn<{ data: Date }>;
  updatedAt: AnyPgColumn<{ data: Date }>;
  deletedAt: AnyPgColumn<{ data: Date | null }>;
  serverVersion: AnyPgColumn<{ data: bigint }>;
};

/**
 * Eigene veränderliche Entität einer Tabelle mit `person_id`. `columns` übersetzt die geprüfte
 * Nutzlast in die fachlichen Spalten, `record` eine Zeile in die kanonischen Felder. Eigentümer,
 * Zeitpunkte und Serverversion setzt allein der Sync.
 */
export function ownedEntity<T extends PgTable & OwnedColumns, U extends EntityData>(options: {
  entityType: SyncEntityType;
  resource: ResourceEntity;
  table: T;
  upsert: z.ZodType<U>;
  deletable: boolean;
  columns(payload: U): Partial<T['$inferInsert']>;
  record(row: T['$inferSelect']): EntityData;
}): ServerSyncEntity {
  const { table } = options;
  return {
    entityType: options.entityType,
    resource: options.resource,
    upsert: options.upsert as unknown as z.ZodType<EntityData>,
    deletable: options.deletable,
    async read(tx, ids) {
      if (ids.length === 0) return new Map();
      const rows = (await tx
        .select()
        .from(table as PgTable)
        .where(inArray(table.id, [...ids]))) as T['$inferSelect'][];
      return new Map(
        rows.map((row) => {
          const { id, serverVersion, deletedAt } = row as { id: string; serverVersion: bigint; deletedAt: Date | null };
          return [id, { serverVersion, deletedAt, data: options.record(row) }];
        }),
      );
    },
    async write(tx, change) {
      const own = options.columns(change.payload as U);
      const stamp = { updatedAt: change.at, serverVersion: change.serverVersion };
      if (change.exists) {
        await tx
          .update(table)
          .set({ ...own, ...stamp } as never)
          .where(and(eq(table.id, change.entityId), eq(table.personId, change.ownerPersonId)));
        return;
      }
      await tx.insert(table).values({ ...own, ...stamp, id: change.entityId, personId: change.ownerPersonId, createdAt: change.at } as never);
    },
    async remove(tx, removal) {
      await tx
        .update(table)
        .set({ deletedAt: removal.at, updatedAt: removal.at, serverVersion: removal.serverVersion } as never)
        .where(eq(table.id, removal.entityId));
    },
  };
}
