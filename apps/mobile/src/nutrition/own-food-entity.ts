import { EntityId, Instant } from '@abnehm/contracts/base';
import { OwnFoodRecord, OwnFoodUpsert } from '@abnehm/contracts/nutrition';

import { requireOwnPerson } from '../local-db/person-header';
import { ownFood } from '../local-db/schema';
import { sqliteEntity, type SyncEntityAdapter } from '../sync';
import { ownFoodRecordRow, readOwnFood, reindexOwnFood, tombstoneOwnFood, writeOwnFood } from './own-food-repository';

// Das eigene Lebensmittel im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 2, Abschnitte 3 und
// 11): generisches Upsert/Delete, Last-Write-Wins pro Zeile, Löschen gewinnt. Es betrifft keinen Tag,
// weil jeder Eintrag seinen eigenen Snapshot trägt. Nach jeder Übernahme bringt der Adapter den lokalen
// Suchindex auf den Stand der Zeile.

const sqliteOwnFoodEntity = sqliteEntity({
  entityType: 'own_food',
  ownerField: 'personId',
  upsert: OwnFoodUpsert,
  deletable: true,
  record: OwnFoodRecord,
  table: ownFood,
  row: ownFoodRecordRow,
  // Eine offene Operation wirkt nach einer Ablehnung genau wie beim Erfassen.
  replay(tx, entityId, change) {
    const at = Instant.parse(change.createdAt);
    const existing = readOwnFood(tx, entityId);
    if (change.type === 'upsert_entity') writeOwnFood(tx, entityId, existing?.personId ?? EntityId.parse(requireOwnPerson(tx).id), change.payload, at);
    else if (existing !== undefined) tombstoneOwnFood(tx, entityId, at);
  },
});

export const ownFoodEntity: SyncEntityAdapter<OwnFoodUpsert, OwnFoodRecord> = {
  ...sqliteOwnFoodEntity,
  applyCanonical(tx, record) {
    sqliteOwnFoodEntity.applyCanonical(tx, record);
    reindexOwnFood(tx, record.entityId);
  },
  applyTombstone(tx, tombstone) {
    sqliteOwnFoodEntity.applyTombstone(tx, tombstone);
    reindexOwnFood(tx, tombstone.entityId);
  },
  reconcileRejected(tx, rejection) {
    sqliteOwnFoodEntity.reconcileRejected(tx, rejection);
    reindexOwnFood(tx, rejection.entityId);
  },
};
