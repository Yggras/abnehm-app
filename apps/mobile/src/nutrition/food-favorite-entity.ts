import { EntityId, Instant } from '@abnehm/contracts/base';
import { FoodFavoriteRecord, FoodFavoriteUpsert } from '@abnehm/contracts/nutrition';

import { requireOwnPerson } from '../local-db/person-header';
import { foodFavorite } from '../local-db/schema';
import { sqliteEntity, type SyncEntityAdapter } from '../sync';
import { foodFavoriteRecordRow, readFoodFavorite, writeFoodFavorite } from './food-favorite-repository';

// Der Lebensmittelfavorit im Sync (Spezifikation 2, Abschnitte 7 und 11): generisches Upsert,
// Last-Write-Wins pro Zeile, mit deterministischer ID aus Person und Lebensmittelreferenz. Entfernen ist
// ein Upsert mit `removedAt`, kein Tombstone (#158). Er betrifft keinen Tag.

export const foodFavoriteEntity: SyncEntityAdapter<FoodFavoriteUpsert, FoodFavoriteRecord> = sqliteEntity({
  entityType: 'food_favorite',
  ownerField: 'personId',
  upsert: FoodFavoriteUpsert,
  deletable: false,
  record: FoodFavoriteRecord,
  table: foodFavorite,
  row: foodFavoriteRecordRow,
  // Eine offene Operation wirkt nach einer Ablehnung genau wie beim Erfassen.
  replay(tx, entityId, change) {
    if (change.type !== 'upsert_entity') return;
    const personId = readFoodFavorite(tx, entityId)?.personId ?? EntityId.parse(requireOwnPerson(tx).id);
    writeFoodFavorite(tx, entityId, personId, change.payload, Instant.parse(change.createdAt));
  },
});
