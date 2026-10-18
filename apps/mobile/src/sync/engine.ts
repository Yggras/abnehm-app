import { eq } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { Instant, SyncCursor, type EntityId } from '@abnehm/contracts/base';
import type { ContractError } from '@abnehm/contracts/errors';
import {
  currentSyncSchemaVersion,
  maxPushOperations,
  PullPageToken,
  type CanonicalChange,
  type CanonicalState,
  type InstallationId,
  type OutboxOperation,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type PushResult,
} from '@abnehm/contracts/sync';

import type { LocalDatabase, ReadContext, TransactionContext } from '../local-db';
import { syncCursor } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { hasPending, pendingFor, pendingOperations, recordAttempt, removeOperation } from './outbox';
import type { PendingChange, SyncEntityAdapter, SyncRegistry } from './registry';

// Sync-Ablauf der App (Spezifikation 0, Abschnitt 10): erst Push, dann Pull. Kanonische Ergebnisse,
// Ablehnungen samt Reconciliation, Seiten und Cursor werden je Antwort in einer SQLite-Transaktion
// übernommen. Eine Zeile mit offener Operation überschreibt der Pull nie; ihr Stand kommt mit dem
// Ergebnis ihrer Operation.

/** Antwort des Transports; `unavailable` steht für Netz- und vorübergehende Serverfehler. */
export type TransportReply<T> =
  | Readonly<{ type: 'ok'; body: T }>
  | Readonly<{ type: 'unavailable' }>
  | Readonly<{ type: 'unauthorized' }>
  | Readonly<{ type: 'rejected'; error: ContractError }>;

export type SyncTransport = {
  push(request: PushRequest): Promise<TransportReply<PushResponse>>;
  pull(request: PullRequest): Promise<TransportReply<PullResponse>>;
};

/** Eine Entität, deren kanonischer Stand in der laufenden Transaktion übernommen wurde. */
export type CanonicalChangeApplied = Readonly<{ entityType: string; entityId: EntityId; kind: 'record' | 'tombstone' | 'reconciled' }>;

/**
 * Haken in derselben Transaktion wie die Übernahme kanonischer Ergebnisse, Ablehnungen und Pull-Seiten.
 * Hier dockt der Persistenzdienst der Tagesziele an (#105); wirft er, ist nichts übernommen.
 */
export type CanonicalChangesHook = (tx: TransactionContext, changes: readonly CanonicalChangeApplied[]) => void;

export type SyncStepResult = 'done' | 'nothing_to_do' | 'unavailable' | 'unauthorized' | 'rejected';
export type SyncCycleResult = Readonly<{ push: SyncStepResult; pull: SyncStepResult | 'skipped' }>;

export type SyncEngine = {
  /** Ein Sync-Zyklus: Push vor Pull. Gleichzeitige Aufrufe teilen sich denselben Zyklus. */
  sync(): Promise<SyncCycleResult>;
};

export type SyncEngineOptions = {
  database: LocalDatabase;
  registry: SyncRegistry;
  transport: SyncTransport;
  clock: Clock;
  installationId: InstallationId;
  onCanonicalChanges?: CanonicalChangesHook;
};

/** Der Pull-Stand je Kontodatenbank; es gibt genau einen. */
const cursorScope = 'konto';
/** Schutz vor einem Server, der nie zum Ende kommt. */
const maxRounds = 1000;

export function createSyncEngine({ database, registry, transport, clock, installationId, onCanonicalChanges }: SyncEngineOptions): SyncEngine {
  let running: Promise<SyncCycleResult> | null = null;

  function adapterFor(entityType: string): SyncEntityAdapter {
    const adapter = registry.get(entityType);
    // Der Server liefert nur Entitäten, die auch die App kennt; alles andere ist ein Integrationsfehler.
    if (adapter === undefined) throw new Error(`Sync-Entität ${entityType} ist in der App nicht angemeldet`);
    return adapter;
  }

  function apply(tx: TransactionContext, change: CanonicalChange): CanonicalChangeApplied {
    const adapter = adapterFor(change.entityType);
    if (change.type === 'record') {
      adapter.applyCanonical(tx, { entityId: change.entityId, serverVersion: change.serverVersion, data: adapter.record.parse(change.data) });
    } else {
      adapter.applyTombstone(tx, { entityId: change.entityId, serverVersion: change.serverVersion, deletedAt: change.deletedAt });
    }
    return { entityType: change.entityType, entityId: change.entityId, kind: change.type };
  }

  function reconcile(tx: TransactionContext, operation: OutboxOperation, result: Extract<PushResult, { type: 'permanently_rejected' }>) {
    const adapter = adapterFor(operation.entityType);
    const pending = pendingFor(tx, operation.entityType, operation.entityId).map((change): PendingChange<never> =>
      change.type === 'upsert_entity' ? { ...change, payload: adapter.upsert!.parse(change.payload) as never } : change,
    );
    adapter.reconcileRejected(tx, {
      entityId: operation.entityId,
      error: result.error,
      canonical: canonicalForAdapter(adapter, result.canonical),
      pending,
    });
  }

  function finish(tx: TransactionContext, changes: CanonicalChangeApplied[]) {
    if (changes.length > 0) onCanonicalChanges?.(tx, changes);
  }

  async function push(): Promise<SyncStepResult> {
    let pushed = false;
    for (let round = 0; round < maxRounds; round++) {
      const operations = database.read((tx) => pendingOperations(tx, maxPushOperations));
      if (operations.length === 0) return pushed ? 'done' : 'nothing_to_do';
      const reply = await transport.push({ schemaVersion: currentSyncSchemaVersion, installationId, operations });
      if (reply.type !== 'ok' || !matches(operations, reply.body.results)) {
        const code = reply.type === 'ok' ? 'protocol' : reply.type === 'rejected' ? reply.error.code : reply.type;
        const at = Instant.parse(clock.read().instant);
        database.transaction((tx) => recordAttempt(tx, operations.map((operation) => operation.operationId), at, code));
        return reply.type === 'ok' ? 'unavailable' : reply.type;
      }
      database.transaction((tx) => {
        const changes: CanonicalChangeApplied[] = [];
        reply.body.results.forEach((result, index) => {
          const operation = operations[index]!;
          // Erst nach der Übernahme des kanonischen Ergebnisses ist die Operation erledigt.
          removeOperation(tx, operation.operationId);
          if (result.type === 'permanently_rejected') {
            reconcile(tx, operation, result);
            changes.push({ entityType: operation.entityType, entityId: operation.entityId, kind: 'reconciled' });
          } else if (!hasPending(tx, operation.entityType, operation.entityId)) {
            changes.push(apply(tx, result.canonical));
          }
        });
        finish(tx, changes);
      });
      pushed = true;
    }
    return 'unavailable';
  }

  async function pull(): Promise<SyncStepResult> {
    let retriedFromCursor = false;
    for (let round = 0; round < maxRounds; round++) {
      const state = database.read(readCursor);
      const reply = await transport.pull({ schemaVersion: currentSyncSchemaVersion, installationId, ...state });
      if (reply.type === 'rejected' && !retriedFromCursor && (state.pageToken !== null || reply.error.code === 'full_resync_required')) {
        // Ein veraltetes Seitentoken oder ein Cursor aus einem anderen Datenstand: neu ab dem Cursor bzw. vollständig.
        retriedFromCursor = true;
        const cursor = reply.error.code === 'full_resync_required' ? null : state.cursor;
        database.transaction((tx) => writeCursor(tx, { cursor, pageToken: null }, clock));
        continue;
      }
      if (reply.type !== 'ok') return reply.type;
      const page = reply.body;
      database.transaction((tx) => {
        const changes: CanonicalChangeApplied[] = [];
        for (const change of page.changes) {
          // Eine Zeile mit offener Operation behält ihren lokalen Stand bis zum Ergebnis ihrer Operation.
          if (hasPending(tx, change.entityType, change.entityId)) continue;
          changes.push(apply(tx, change));
        }
        // Den endgültigen Cursor speichert erst die letzte Seite; davor nur das Seitentoken.
        writeCursor(
          tx,
          page.next.type === 'complete' ? { cursor: page.next.cursor, pageToken: null } : { cursor: state.cursor, pageToken: page.next.pageToken },
          clock,
        );
        finish(tx, changes);
      });
      if (page.next.type === 'complete') return 'done';
    }
    return 'unavailable';
  }

  async function cycle(): Promise<SyncCycleResult> {
    const pushed = await push();
    // Ohne Sitzung oder bei einer abgelehnten Version gibt es auch keinen Pull.
    if (pushed === 'unauthorized' || pushed === 'rejected') return { push: pushed, pull: 'skipped' };
    return { push: pushed, pull: await pull() };
  }

  return {
    sync() {
      running ??= cycle().finally(() => {
        running = null;
      });
      return running;
    },
  };
}

function matches(operations: readonly OutboxOperation[], results: readonly PushResult[]): boolean {
  return results.length === operations.length && results.every((result, index) => result.operationId === operations[index]?.operationId);
}

function canonicalForAdapter(adapter: SyncEntityAdapter, state: CanonicalState) {
  if (state.type === 'absent') return null;
  if (state.type === 'tombstone') return { type: 'tombstone', entityId: state.entityId, serverVersion: state.serverVersion, deletedAt: state.deletedAt } as const;
  return { type: 'record', entityId: state.entityId, serverVersion: state.serverVersion, data: adapter.record.parse(state.data) } as const;
}

type CursorState = { cursor: SyncCursor | null; pageToken: PullPageToken | null };

function readCursor(tx: ReadContext): CursorState {
  const row = sqliteOf(tx).select().from(syncCursor).where(eq(syncCursor.scope, cursorScope)).get();
  return {
    cursor: row?.cursor == null ? null : SyncCursor.parse(row.cursor),
    pageToken: row?.pageToken == null ? null : PullPageToken.parse(row.pageToken),
  };
}

function writeCursor(tx: TransactionContext, state: CursorState, clock: Clock) {
  const updatedAt = clock.read().instant;
  sqliteOf(tx)
    .insert(syncCursor)
    .values({ scope: cursorScope, ...state, updatedAt })
    .onConflictDoUpdate({ target: syncCursor.scope, set: { ...state, updatedAt } })
    .run();
}
