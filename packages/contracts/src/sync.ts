import { z } from 'zod';

import { EntityId, Instant, ServerVersion, SyncCursor } from './base.ts';
import { ContractError } from './errors.ts';

// Hüllen des Push/Pull-Syncs (Spezifikation 0, Abschnitt 10), angelehnt an das Backend-Protokoll von
// WatermelonDB (https://watermelondb.dev/docs/Sync/Backend). Konto und Person kommen ausschließlich aus
// der Sitzung; Installationskennung, Cursor und Seitentoken sind Sync-Metadaten und begründen nie Zugriff.
// Nutzlasten einer Entität prüft die Entitäts-Registry mit dem Transport-Schema der Entität.

/** Aktuelle Vertragsversion des Syncs; jede Operation und jede Hülle nennt ihre Version. */
export const currentSyncSchemaVersion = 1;

export const SyncSchemaVersion = z.int().positive();
export type SyncSchemaVersion = z.infer<typeof SyncSchemaVersion>;

/** Name einer synchronisierten Entität in der Registry, z. B. `water_entry`; zugleich `entity_type` im Änderungsprotokoll. */
export const SyncEntityType = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);
export type SyncEntityType = z.infer<typeof SyncEntityType>;

/** Kennung einer App-Installation; gebunden an Konto und Person, nie ein Zugriffsrecht. */
export const InstallationId = EntityId;
export type InstallationId = z.infer<typeof InstallationId>;

/** Felder einer Entität als JSON-Objekt; den Inhalt prüft das Transport-Schema der Entität. */
export const EntityData = z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), z.unknown());
export type EntityData = z.infer<typeof EntityData>;

const operationFields = {
  operationId: EntityId,
  entityType: SyncEntityType,
  entityId: EntityId,
  /** Serverversion, die das Gerät beim Ändern kannte; `null` bei einem Create. Nur Diagnose, keine Konfliktentscheidung. */
  knownServerVersion: ServerVersion.nullable(),
  schemaVersion: SyncSchemaVersion,
  createdAt: Instant,
};

/**
 * Ausstehende Operation der Outbox. `upsert_entity` trägt die vollständige Nutzlast statt eines Patches,
 * ohne Eigentums-, Server- und abgeleitete Felder. Benannte Fachbefehle ergänzt der Befehlsrahmen (#100).
 */
export const OutboxOperation = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('upsert_entity'), ...operationFields, payload: EntityData }),
  z.strictObject({ type: z.literal('delete_entity'), ...operationFields }),
]);
export type OutboxOperation = z.infer<typeof OutboxOperation>;

const entityRef = { entityType: SyncEntityType, entityId: EntityId };

/** Kanonischer Datensatz des Servers samt seiner Serverversion. */
export const CanonicalRecord = z.strictObject({ type: z.literal('record'), ...entityRef, serverVersion: ServerVersion, data: EntityData });
export type CanonicalRecord = z.infer<typeof CanonicalRecord>;

/** Löschmarkierung: inhaltsfrei und für Clientoperationen terminal. */
export const CanonicalTombstone = z.strictObject({ type: z.literal('tombstone'), ...entityRef, serverVersion: ServerVersion, deletedAt: Instant });
export type CanonicalTombstone = z.infer<typeof CanonicalTombstone>;

/** Was ein Pull oder eine bestätigte Operation liefert. */
export const CanonicalChange = z.discriminatedUnion('type', [CanonicalRecord, CanonicalTombstone]);
export type CanonicalChange = z.infer<typeof CanonicalChange>;

/** Kanonischer Zustand nach einer Ablehnung; `absent`, wenn es die Entität für diese Person nicht gibt. */
export const CanonicalState = z.discriminatedUnion('type', [
  CanonicalRecord,
  CanonicalTombstone,
  z.strictObject({ type: z.literal('absent'), ...entityRef }),
]);
export type CanonicalState = z.infer<typeof CanonicalState>;

/**
 * Terminales Ergebnis einer Operation. `already_applied` trägt dieselben kanonischen Ergebnisse wie
 * die erste Bestätigung. Bei `forbidden` gibt es nur den generischen Fehler und `absent`.
 */
export const PushResult = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('applied'), operationId: EntityId, canonical: CanonicalChange }),
  z.strictObject({ type: z.literal('already_applied'), operationId: EntityId, canonical: CanonicalChange }),
  z
    .strictObject({ type: z.literal('permanently_rejected'), operationId: EntityId, error: ContractError, canonical: CanonicalState })
    .refine((result) => result.error.code !== 'forbidden' || (result.error.context === undefined && result.canonical.type === 'absent'), {
      message: 'forbidden nur generisch und mit absent',
      path: ['canonical'],
    })
    .refine((result) => !result.error.retryable, { message: 'Eine dauerhafte Ablehnung ist nicht wiederholbar', path: ['error'] }),
]);
export type PushResult = z.infer<typeof PushResult>;

/** Höchstzahl an Operationen je Push; mehr sendet die App in weiteren Pushes. */
export const maxPushOperations = 100;

/** Body von `POST /v1/sync/push`: die geordnete Liste ausstehender Operationen. */
export const PushRequest = z
  .strictObject({
    schemaVersion: SyncSchemaVersion,
    installationId: InstallationId,
    operations: z.array(OutboxOperation).min(1).max(maxPushOperations),
  })
  .refine((request) => new Set(request.operations.map((operation) => operation.operationId)).size === request.operations.length, {
    message: 'Operations-IDs sind im Batch eindeutig',
    path: ['operations'],
  });
export type PushRequest = z.infer<typeof PushRequest>;

/** Antwort auf einen Push: je Operation ein Ergebnis, in derselben Reihenfolge. */
export const PushResponse = z.strictObject({ results: z.array(PushResult).max(maxPushOperations) });
export type PushResponse = z.infer<typeof PushResponse>;

/** Opakes Seitentoken eines laufenden Pulls; enthält Obergrenze und letzte gelieferte Position. */
export const PullPageToken = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export type PullPageToken = z.infer<typeof PullPageToken>;

/** Body von `POST /v1/sync/pull`. Ohne Cursor und Seitentoken ist es ein vollständiger Pull. */
export const PullRequest = z.strictObject({
  schemaVersion: SyncSchemaVersion,
  installationId: InstallationId,
  cursor: SyncCursor.nullable(),
  /** Setzt einen laufenden Pull mit seiner festen Obergrenze fort. */
  pageToken: PullPageToken.nullable(),
});
export type PullRequest = z.infer<typeof PullRequest>;

/**
 * Eine Seite des Pulls: Änderungen bis zur festen Obergrenze und danach entweder die nächste Seite
 * oder der endgültige Cursor, den die App erst mit dieser letzten Seite speichert.
 */
export const PullResponse = z.strictObject({
  changes: z.array(CanonicalChange),
  next: z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('page'), pageToken: PullPageToken }),
    z.strictObject({ type: z.literal('complete'), cursor: SyncCursor }),
  ]),
});
export type PullResponse = z.infer<typeof PullResponse>;
