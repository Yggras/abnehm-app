import { partnerCacheEntities } from '../partner-cache';
import type { LocalCommand } from './commands';
import { couplingSyncEntities } from './coupling-entities';
import { personEntity } from './person-entity';
import { personTimeZoneCommand } from './person-time-zone';
import type { SyncEntityAdapter } from './registry';
import { partnerSharingEntity, photoSharingEntity } from './sharing-entities';

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
  type SyncStatus,
  type PushNowResult,
  type SyncTransport,
  type TransportReply,
} from './engine';
export { createHttpSyncTransport } from './http-transport';
export { createLocalCommandRegistry, type LocalCommand, type LocalCommandRegistry } from './commands';
export { immutableDayEntity } from './immutable-entity';
export { createSyncWriter, type SyncWriter } from './outbox';
export { personEntity, updateOwnPerson, type PersonChange } from './person-entity';
export { personTimeZoneCommand, requestPersonTimeZone, type PersonTimeZoneRequest } from './person-time-zone';
export { setPartnerSharing, setPhotoSharing } from './sharing-entities';
export {
  createSyncRegistry,
  type AffectedDay,
  type CanonicalEntity,
  type EntityTombstone,
  type PendingChange,
  type RejectedChange,
  type SyncEntityAdapter,
  type SyncRegistry,
} from './registry';
export { sqliteEntity } from './sqlite-entity';

/** Die Entitäten des Fundaments; Bereiche ergänzen ihre im Composition Root. */
export const foundationSyncEntities: readonly SyncEntityAdapter[] = [
  personEntity,
  ...couplingSyncEntities,
  partnerSharingEntity,
  photoSharingEntity,
  ...partnerCacheEntities,
];

/** Die lokalen Fachbefehle des Fundaments; Bereiche ergänzen ihre im Composition Root. */
export const foundationLocalCommands: readonly LocalCommand[] = [personTimeZoneCommand];
