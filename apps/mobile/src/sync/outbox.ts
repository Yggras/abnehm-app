import { and, asc, eq, max, sql } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, type ServerVersion } from '@abnehm/contracts/base';
import { currentSyncSchemaVersion, OutboxOperation, type CommandType, type EntityData } from '@abnehm/contracts/sync';

import type { ReadContext, TransactionContext } from '../local-db';
import { outbox } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { PendingChange, SyncRegistry } from './registry';

// Outbox der App (Spezifikation 0, Abschnitt 10). Ein Bereich schreibt seine Fachänderung und ruft in
// derselben Transaktion den `SyncWriter` auf; ein Rollback hinterlässt dann weder Änderung noch
// Operation. Push sendet die Operationen in Entstehungsreihenfolge.

export type SyncWriter = {
  /** Merkt den vollständigen Stand einer Entität zum Push vor; die Nutzlast prüft ihr Upsert-Schema. */
  upsert(tx: TransactionContext, change: { entityType: string; entityId: EntityId; payload: EntityData; knownServerVersion: ServerVersion | null }): void;
  /** Merkt das Löschen einer Entität vor; der Server setzt daraus die Löschmarkierung. */
  delete(tx: TransactionContext, change: { entityType: string; entityId: EntityId; knownServerVersion: ServerVersion | null }): void;
  command(tx: TransactionContext, change: { type: CommandType; businessKey: string; payload: EntityData; knownServerVersion: ServerVersion | null;
    affectedRefs: readonly { entityType: string; entityId: EntityId }[] }): void;
};

export function createSyncWriter({ registry, clock, newId }: { registry: SyncRegistry; clock: Clock; newId: () => EntityId }): SyncWriter {
  function append(tx: TransactionContext, operation: OutboxOperation) {
    const db = sqliteOf(tx);
    const last = db.select({ sequence: max(outbox.sequence) }).from(outbox).get()?.sequence ?? 0;
    db.insert(outbox)
      .values({
        operationId: operation.operationId,
        sequence: last + 1,
        type: operation.type,
        entityType: 'businessKey' in operation ? null : operation.entityType,
        entityId: 'businessKey' in operation ? null : operation.entityId,
        businessKey: 'businessKey' in operation ? operation.businessKey : null,
        affectedRefs: [],
        payload: 'payload' in operation ? operation.payload : {},
        knownServerVersion: operation.knownServerVersion,
        schemaVersion: operation.schemaVersion,
        createdAt: operation.createdAt,
        attemptCount: 0,
      })
      .run();
  }

  function base(change: { entityType: string; entityId: EntityId; knownServerVersion: ServerVersion | null }) {
    return {
      operationId: newId(),
      entityType: change.entityType,
      entityId: change.entityId,
      knownServerVersion: change.knownServerVersion,
      schemaVersion: currentSyncSchemaVersion,
      createdAt: Instant.parse(clock.read().instant),
    };
  }

  return {
    upsert(tx, change) {
      const adapter = registry.require(change.entityType);
      if (adapter.upsert === null) throw new Error(`Sync-Entität ${change.entityType} kennt kein Upsert`);
      if (adapter.ownerField in change.payload) throw new Error(`Die Eigentumsgrenze ${adapter.ownerField} setzt nur der Server`);
      const payload = adapter.upsert.parse(change.payload);
      append(tx, OutboxOperation.parse({ ...base(change), type: 'upsert_entity', payload }));
    },
    delete(tx, change) {
      if (!registry.require(change.entityType).deletable) throw new Error(`Sync-Entität ${change.entityType} wird nicht gelöscht`);
      append(tx, OutboxOperation.parse({ ...base(change), type: 'delete_entity' }));
    },
    command(tx, change) {
      const { affectedRefs, ...request } = change;
      if (new Set(affectedRefs.map((ref) => `${ref.entityType}:${ref.entityId}`)).size !== affectedRefs.length) {
        throw new Error('Fachbefehl enthält doppelte betroffene Entität');
      }
      const operation = OutboxOperation.parse({ ...request, operationId: newId(), schemaVersion: currentSyncSchemaVersion,
        createdAt: Instant.parse(clock.read().instant) });
      append(tx, operation);
      sqliteOf(tx).update(outbox).set({ affectedRefs: [...affectedRefs] }).where(eq(outbox.operationId, operation.operationId)).run();
    },
  };
}

/** Die ältesten offenen Operationen in Entstehungsreihenfolge. */
export function pendingOperations(tx: ReadContext, limit: number): OutboxOperation[] {
  return sqliteOf(tx).select().from(outbox).orderBy(asc(outbox.sequence)).limit(limit).all().map(toOperation);
}

/** Offene Operationen einer Entität in Entstehungsreihenfolge. */
export function pendingFor(tx: ReadContext, entityType: string, entityId: string): PendingChange<EntityData>[] {
  return sqliteOf(tx)
    .select()
    .from(outbox)
    .where(and(eq(outbox.entityType, entityType), eq(outbox.entityId, entityId)))
    .orderBy(asc(outbox.sequence))
    .all()
    .map(toOperation)
    .filter((operation) => !('businessKey' in operation))
    .map((operation) =>
      operation.type === 'upsert_entity'
        ? { type: 'upsert_entity', payload: operation.payload, operationId: operation.operationId, createdAt: operation.createdAt }
        : { type: 'delete_entity', operationId: operation.operationId, createdAt: operation.createdAt },
    );
}

export function hasPending(tx: ReadContext, entityType: string, entityId: string): boolean {
  return (
    sqliteOf(tx)
      .select({ operationId: outbox.operationId })
      .from(outbox)
      .where(sql`(${outbox.entityType} = ${entityType} and ${outbox.entityId} = ${entityId}) or exists (
        select 1 from json_each(${outbox.affectedRefs}) where json_extract(value, '$.entityType') = ${entityType}
          and json_extract(value, '$.entityId') = ${entityId}
      )`)
      .limit(1)
      .get() !== undefined
  );
}

export function removeOperation(tx: TransactionContext, operationId: string): void {
  sqliteOf(tx).delete(outbox).where(eq(outbox.operationId, operationId)).run();
}

/** Hält einen gescheiterten Versuch fest; die Operationen bleiben unverändert in der Outbox. */
export function recordAttempt(tx: TransactionContext, operationIds: readonly string[], at: Instant, errorCode: string): void {
  for (const operationId of operationIds) {
    sqliteOf(tx)
      .update(outbox)
      .set({ attemptCount: sql`${outbox.attemptCount} + 1`, lastAttemptAt: at, lastErrorCode: errorCode })
      .where(eq(outbox.operationId, operationId))
      .run();
  }
}

function toOperation(row: typeof outbox.$inferSelect): OutboxOperation {
  const common = {
    operationId: EntityId.parse(row.operationId),
    entityType: row.entityType,
    entityId: row.entityId,
    knownServerVersion: row.knownServerVersion,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
  };
  return OutboxOperation.parse(row.businessKey !== null
    ? { type: row.type, operationId: common.operationId, businessKey: row.businessKey, payload: row.payload,
      knownServerVersion: row.knownServerVersion, schemaVersion: row.schemaVersion, createdAt: row.createdAt }
    : row.type === 'upsert_entity' ? { ...common, type: row.type, payload: row.payload } : { ...common, type: row.type });
}
