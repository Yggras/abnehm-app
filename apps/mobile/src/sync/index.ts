import { couplingSyncEntities } from './coupling-entities';
import { personEntity } from './person-entity';
import type { SyncEntityAdapter } from './registry';

// Push/Pull-Sync der App (Spezifikation 0, Abschnitt 10; #99). Bereiche melden ihre Entitäten als
// `SyncEntityAdapter` an und schreiben lokale Änderungen mit dem `SyncWriter` in derselben Transaktion
// wie ihre Fachänderung. Den Ablauf startet `SyncEngine.sync()`; Auslöser und Status liefert #102.
export {
  createSyncEngine,
  readSyncState,
  restoreSyncState,
  type CanonicalChangeApplied,
  type CanonicalChangesHook,
  type SyncCycleResult,
  type SyncEngine,
  type SyncEngineOptions,
  type SyncState,
  type SyncStepResult,
  type SyncTransport,
  type TransportReply,
} from './engine';
export { createHttpSyncTransport } from './http-transport';
export { createLocalCommandRegistry, type LocalCommand, type LocalCommandRegistry } from './commands';
export { createSyncWriter, type SyncWriter } from './outbox';
export { personEntity } from './person-entity';
export {
  createSyncRegistry,
  type CanonicalEntity,
  type EntityTombstone,
  type PendingChange,
  type RejectedChange,
  type SyncEntityAdapter,
  type SyncRegistry,
} from './registry';
export { sqliteEntity } from './sqlite-entity';

/** Die Entitäten des Fundaments; Bereiche ergänzen ihre im Composition Root. */
export const foundationSyncEntities: readonly SyncEntityAdapter[] = [personEntity, ...couplingSyncEntities];
