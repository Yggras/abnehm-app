import { and, asc, eq, isNotNull, max, sql } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { Instant, type EntityId, type ServerVersion } from '@abnehm/contracts/base';
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
    affectedRefs: readonly { entityType: string; entityId: EntityId }[];
    referencePaths: readonly (readonly string[])[] }): void;
};

/** Hängt eine geprüfte Operation ans Ende der Outbox; `referencePaths` nennt ihre ID-Verweise. */
export function appendOperation(
  tx: TransactionContext,
  operation: OutboxOperation,
  referencePaths: readonly (readonly string[])[] = [],
): void {
  for (const path of referencePaths) {
    if (!((path[0] === 'payload' && path.length >= 2) || (path.length === 1 && path[0] === 'businessKey'))) {
      throw new Error('Ungültiger Referenzpfad der Outbox');
    }
  }
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
      referencePaths: referencePaths.map((path) => [...path]),
      payload: 'payload' in operation ? operation.payload : {},
      knownServerVersion: operation.knownServerVersion,
      schemaVersion: operation.schemaVersion,
      createdAt: operation.createdAt,
      attemptCount: 0,
    })
    .run();
}

export function createSyncWriter({ registry, clock, newId }: { registry: SyncRegistry; clock: Clock; newId: () => EntityId }): SyncWriter {
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
      appendOperation(tx, OutboxOperation.parse({ ...base(change), type: 'upsert_entity', payload }), adapter.referencePaths);
    },
    delete(tx, change) {
      if (!registry.require(change.entityType).deletable) throw new Error(`Sync-Entität ${change.entityType} wird nicht gelöscht`);
      appendOperation(tx, OutboxOperation.parse({ ...base(change), type: 'delete_entity' }));
    },
    command(tx, change) {
      const { affectedRefs, referencePaths, ...request } = change;
      if (new Set(affectedRefs.map((ref) => `${ref.entityType}:${ref.entityId}`)).size !== affectedRefs.length) {
        throw new Error('Fachbefehl enthält doppelte betroffene Entität');
      }
      const operation = OutboxOperation.parse({ ...request, operationId: newId(), schemaVersion: currentSyncSchemaVersion,
        createdAt: Instant.parse(clock.read().instant) });
      appendOperation(tx, operation, referencePaths);
      sqliteOf(tx).update(outbox).set({ affectedRefs: [...affectedRefs] }).where(eq(outbox.operationId, operation.operationId)).run();
    },
  };
}

/** Die ältesten offenen Operationen in Entstehungsreihenfolge. */
export function pendingOperations(tx: ReadContext, limit: number): OutboxOperation[] {
  return sqliteOf(tx).select().from(outbox).orderBy(asc(outbox.sequence)).limit(limit).all().map((row) => OutboxOperation.parse(decodeOutboxRow(row)));
}

/** Offene Operationen einer Entität in Entstehungsreihenfolge. */
export function pendingFor(tx: ReadContext, entityType: string, entityId: string): PendingChange<EntityData>[] {
  return sqliteOf(tx)
    .select()
    .from(outbox)
    .where(and(eq(outbox.entityType, entityType), eq(outbox.entityId, entityId)))
    .orderBy(asc(outbox.sequence))
    .all()
    .map((row) => OutboxOperation.parse(decodeOutboxRow(row)))
    .filter((operation) => !('businessKey' in operation))
    .map((operation) =>
      operation.type === 'upsert_entity'
        ? { type: 'upsert_entity', payload: operation.payload, operationId: operation.operationId, createdAt: operation.createdAt }
        : { type: 'delete_entity', operationId: operation.operationId, createdAt: operation.createdAt },
    );
}

/** Nutzlasten der offenen Fachbefehle eines Typs in Entstehungsreihenfolge. */
export function pendingCommandPayloads(tx: ReadContext, type: CommandType): EntityData[] {
  return sqliteOf(tx)
    .select({ payload: outbox.payload })
    .from(outbox)
    .where(and(eq(outbox.type, type), isNotNull(outbox.businessKey)))
    .orderBy(asc(outbox.sequence))
    .all()
    .map((row) => row.payload);
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

/** Schreibt nur deklarierte ID-Referenzen um. Bereits versendete Bytes sind unter ihrer Operations-ID
 * möglicherweise auf dem Server verarbeitet und bleiben für ihren Retry unverändert. */
export function rewritePendingOutboxReferences(tx: TransactionContext, from: EntityId, to: EntityId): void {
  const db = sqliteOf(tx);
  for (const row of db.select().from(outbox).all()) {
    if (row.attemptCount > 0) continue;
    let payload: unknown = row.payload;
    for (const path of row.referencePaths.filter((path) => path[0] === 'payload')) {
      payload = rewriteAtPath(payload, path.slice(1), from, to);
    }
    db.update(outbox).set({ entityId: row.entityId === from ? to : row.entityId,
      businessKey: row.referencePaths.some((path) => path.length === 1 && path[0] === 'businessKey')
        ? row.businessKey?.split(from).join(to) : row.businessKey,
      payload: payload as Record<string, unknown>,
      affectedRefs: row.affectedRefs.map((ref) => ({ ...ref, entityId: ref.entityId === from ? to : ref.entityId })) })
      .where(eq(outbox.operationId, row.operationId)).run();
  }
}

function rewriteAtPath(value: unknown, path: readonly string[], from: string, to: string): unknown {
  if (path.length === 0) return value === from ? to : value;
  const [segment, ...remaining] = path;
  if (segment === '*' && Array.isArray(value)) return value.map((element) => rewriteAtPath(element, remaining, from, to));
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && segment !== undefined && segment in value) {
    const object = value as Record<string, unknown>;
    return { ...object, [segment]: rewriteAtPath(object[segment], remaining, from, to) };
  }
  return value;
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

export function recordFailure(tx: TransactionContext, operationIds: readonly string[], errorCode: string): void {
  for (const operationId of operationIds) {
    sqliteOf(tx).update(outbox).set({ lastErrorCode: errorCode }).where(eq(outbox.operationId, operationId)).run();
  }
}

/** Rekonstruiert die unveränderten Transportbytes einer Zeile; der Aufrufer validiert fehlertolerant
 * bei der Migration oder strikt vor dem Versand. */
export function decodeOutboxRow(row: typeof outbox.$inferSelect): unknown {
  const common = {
    operationId: row.operationId,
    entityType: row.entityType,
    entityId: row.entityId,
    knownServerVersion: row.knownServerVersion,
    schemaVersion: row.schemaVersion,
    createdAt: row.createdAt,
  };
  return row.businessKey !== null
    ? { type: row.type, operationId: common.operationId, businessKey: row.businessKey, payload: row.payload,
      knownServerVersion: row.knownServerVersion, schemaVersion: row.schemaVersion, createdAt: row.createdAt }
    : row.type === 'upsert_entity' ? { ...common, type: row.type, payload: row.payload } : { ...common, type: row.type };
}
