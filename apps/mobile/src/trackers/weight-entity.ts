import { EntityId, Instant } from '@abnehm/contracts/base';
import { WeightEntryRecord, WeightEntryUpsert } from '@abnehm/contracts/trackers';

import { requireOwnPerson } from '../local-db/person-header';
import { weightEntry } from '../local-db/schema';
import { sqliteEntity, type SyncEntityAdapter } from '../sync';
import { readWeightEntry, tombstoneWeightEntry, weightColumns, writeWeightEntry } from './weight-repository';

// Der Gewichtseintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 3, Abschnitt 8): Transport-
// Schemas, Eigentumsregel und die Adapteroperationen über den opaken `TransactionContext`. Neben dem
// Repository kennt nur dieser Adapter die Tabelle, weil `sqliteEntity` sie für Versionsprüfung und
// Reconciliation braucht.

const sqliteWeightEntity = sqliteEntity({
  entityType: 'weight_entry',
  ownerField: 'personId',
  upsert: WeightEntryUpsert,
  deletable: true,
  record: WeightEntryRecord,
  table: weightEntry,
  row: (entityId, { personId, createdAt, updatedAt, ...payload }) => ({ ...weightColumns(payload), id: entityId, personId, createdAt, updatedAt }),
  // Eine offene Operation wirkt nach einer Ablehnung genau wie beim Erfassen.
  replay(tx, entityId, change) {
    const at = Instant.parse(change.createdAt);
    const existing = readWeightEntry(tx, entityId);
    if (change.type === 'upsert_entity') writeWeightEntry(tx, entityId, existing?.personId ?? EntityId.parse(requireOwnPerson(tx).id), change.payload, at);
    else if (existing !== undefined) tombstoneWeightEntry(tx, entityId, at);
  },
});

/** Gewichtseintrag samt seinem lokalen Tag; die Pull-Übernahme meldet damit alten und neuen Tag. */
export const weightEntryEntity: SyncEntityAdapter<WeightEntryUpsert, WeightEntryRecord> = {
  ...sqliteWeightEntity,
  affectedDays(tx, entityId) {
    const entry = readWeightEntry(tx, entityId);
    return entry === undefined ? [] : [{ type: 'tag', personId: entry.personId, localDate: entry.localDate }];
  },
};
