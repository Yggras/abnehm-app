import type { z } from 'zod';

import type { EntityId, Instant, LocalDate, ServerVersion } from '@abnehm/contracts/base';
import type { ContractError } from '@abnehm/contracts/errors';
import type { EntityData, SyncEntityType } from '@abnehm/contracts/sync';

import type { ReadContext, TransactionContext } from '../local-db';

// Entitäts-Registry des App-Syncs (Spezifikation 0, Abschnitt 10). Ein Bereich meldet je Entität seine
// Transport-Schemas, die Eigentumsregel und drei Adapteroperationen an, die über den opaken
// `TransactionContext` arbeiten. Drizzle-Tabellen oder andere Bibliothekstypen kommen im Interface nicht
// vor; der Sync-Kern bleibt unverändert, wenn ein Bereich eine Entität ergänzt.

/** Kanonischer Datensatz, wie ihn ein Adapter übernimmt; `data` ist schon mit `record` geprüft. */
export type CanonicalEntity<R> = Readonly<{ entityId: EntityId; serverVersion: ServerVersion; data: R }>;

/** Löschmarkierung des Servers; inhaltsfrei und terminal. */
export type EntityTombstone = Readonly<{ entityId: EntityId; serverVersion: ServerVersion; deletedAt: Instant }>;

/** Noch offene lokale Operation derselben Entität, in Entstehungsreihenfolge. */
export type PendingChange<U> = Readonly<
  ({ type: 'upsert_entity'; payload: U } | { type: 'delete_entity' }) & { operationId: EntityId; createdAt: Instant }
>;

/** Eine dauerhaft abgelehnte Operation samt kanonischem Zustand und den neueren offenen Operationen. */
export type RejectedChange<U, R> = Readonly<{
  entityId: EntityId;
  error: ContractError;
  /** Datensatz oder Löschmarkierung des Servers; `null`, wenn es die Entität für diese Person nicht gibt. */
  canonical: ({ type: 'record' } & CanonicalEntity<R>) | ({ type: 'tombstone' } & EntityTombstone) | null;
  pending: readonly PendingChange<U>[];
}>;

/**
 * Was eine lokale Zeile für die Tagesziele bedeutet (#105): ein Tag einer tagesbezogenen Entität oder
 * die Gültigkeit einer Ziel- bzw. Wochenplanversion. Der Persistenzdienst wertet danach neu aus.
 */
export type AffectedDay = Readonly<
  { type: 'tag'; personId: EntityId; localDate: LocalDate } | { type: 'plan'; personId: EntityId; validFrom: LocalDate }
>;

export type SyncEntityAdapter<U extends EntityData = EntityData, R extends EntityData = EntityData> = Readonly<{
  entityType: SyncEntityType;
  /**
   * Eigentumsregel: das Feld des kanonischen Datensatzes mit der Eigentumsgrenze, etwa `personId`. Es
   * setzt nur der Server; eine Upsert-Nutzlast mit diesem Feld weist die Outbox ab.
   */
  ownerField: string;
  /** Transport-Schema des generischen Upserts; `null`, wenn die Entität kein Upsert kennt. */
  upsert: z.ZodType<U> | null;
  deletable: boolean;
  /** Pfade zu UUID-Referenzen im Upsert-Payload, z. B. `['payload', 'parentId']`. */
  referencePaths?: readonly (readonly string[])[];
  /** Transport-Schema des kanonischen Datensatzes vom Server. */
  record: z.ZodType<R>;
  /**
   * Übernimmt den kanonischen Datensatz vollständig. Ist die lokale Serverversion schon neuer, bleibt
   * alles unverändert; eine gleiche Version wird erneut übernommen.
   */
  applyCanonical(tx: TransactionContext, record: CanonicalEntity<R>): void;
  /** Übernimmt die Löschmarkierung; eine lokal unbekannte Entität bleibt unbekannt. */
  applyTombstone(tx: TransactionContext, tombstone: EntityTombstone): void;
  /**
   * Tage, die die lokale Zeile betrifft. Die Engine liest sie vor und nach jeder Übernahme; so erreicht
   * den Persistenzdienst der alte und der neue `local_date`. Fehlt die Methode, betrifft die Entität keinen Tag.
   */
  affectedDays?(tx: ReadContext, entityId: EntityId): readonly AffectedDay[];
  /** Ersetzt eine lokale, logisch identische ID samt allen fachlichen Verweisen; läuft vor applyCanonical. */
  replaceCanonicalId?(tx: TransactionContext, from: EntityId, to: EntityId, options: { preserveLocalChanges: boolean }): void;
  /**
   * Stellt nach einer dauerhaften Ablehnung den kanonischen Zustand her und wendet danach die offenen
   * Operationen in Reihenfolge erneut an. Ohne kanonischen Zustand verschwindet eine nie bestätigte
   * Entität lokal.
   */
  reconcileRejected(tx: TransactionContext, rejection: RejectedChange<U, R>): void;
}>;

export type SyncRegistry = {
  get(entityType: string): SyncEntityAdapter | undefined;
  /** Die angemeldete Entität; eine unbekannte ist ein Integrationsfehler. */
  require(entityType: string): SyncEntityAdapter;
};

/** Alle Entitäten der App; ein doppelter Typ ist ein Integrationsfehler. */
export function createSyncRegistry(entities: readonly SyncEntityAdapter[]): SyncRegistry {
  const byType = new Map<string, SyncEntityAdapter>();
  for (const entity of entities) {
    if (byType.has(entity.entityType)) throw new Error(`Sync-Entität ${entity.entityType} ist doppelt angemeldet`);
    byType.set(entity.entityType, entity);
  }
  return {
    get: (entityType) => byType.get(entityType),
    require(entityType) {
      const adapter = byType.get(entityType);
      if (adapter === undefined) throw new Error(`Sync-Entität ${entityType} ist in der App nicht angemeldet`);
      return adapter;
    },
  };
}
