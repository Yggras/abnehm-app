import { EntityId, Instant } from '@abnehm/contracts/base';
import { WaterEntryRecord, WaterEntryUpsert } from '@abnehm/contracts/trackers';

import { requireOwnPerson } from '../local-db/person-header';
import { waterEntry } from '../local-db/schema';
import { sqliteEntity, type SyncEntityAdapter } from '../sync';
import { readWaterEntry, tombstoneWaterEntry, writeWaterEntry } from './water-repository';

// Der Wassereintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 3, Abschnitt 8): Transport-
// Schemas, Eigentumsregel und die Adapteroperationen über den opaken `TransactionContext`. Neben dem
// Repository kennt nur dieser Adapter die Tabelle, weil `sqliteEntity` sie für Versionsprüfung und
// Reconciliation braucht.

const sqliteWaterEntity = sqliteEntity({
  entityType: 'water_entry',
  ownerField: 'personId',
  upsert: WaterEntryUpsert,
  deletable: true,
  record: WaterEntryRecord,
  table: waterEntry,
  row: (entityId, data) => ({ ...data, id: entityId }),
  // Eine offene Operation wirkt nach einer Ablehnung genau wie beim Erfassen.
  replay(tx, entityId, change) {
    const at = Instant.parse(change.createdAt);
    const existing = readWaterEntry(tx, entityId);
    if (change.type === 'upsert_entity') writeWaterEntry(tx, entityId, existing?.personId ?? EntityId.parse(requireOwnPerson(tx).id), change.payload, at);
    else if (existing !== undefined) tombstoneWaterEntry(tx, entityId, at);
  },
});

/** Wassereintrag samt seinem lokalen Tag; die Pull-Übernahme meldet damit alten und neuen Tag. */
export const waterEntryEntity: SyncEntityAdapter<WaterEntryUpsert, WaterEntryRecord> = {
  ...sqliteWaterEntity,
  affectedDays(tx, entityId) {
    const entry = readWaterEntry(tx, entityId);
    return entry === undefined ? [] : [{ type: 'tag', personId: entry.personId, localDate: entry.localDate }];
  },
};
