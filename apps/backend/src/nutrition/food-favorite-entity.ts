import { FoodFavoriteRecord, FoodFavoriteUpsert, foodFavoriteId } from '@abnehm/contracts/nutrition';

import { foodFavorite } from '../db/schema/index.ts';
import { isoOrNull, ownedEntity, type ServerSyncEntity } from '../sync/registry.ts';

// Der Lebensmittelfavorit im Sync (Spezifikation 2, Abschnitte 7 und 11): generisches Upsert,
// Last-Write-Wins pro Zeile. Seine ID ist deterministisch aus Person und Lebensmittelreferenz, damit zwei
// Geräte, die offline dasselbe Lebensmittel markieren, genau einen Favoriten ergeben. Entfernen setzt
// `removedAt` und ist kein Tombstone: Tombstones sind für Clientoperationen endgültig, ein erneutes
// Markieren derselben ID wäre sonst unmöglich (Nutzerentscheidung vom 19.11.2026, #158). Eine ID, die
// nicht zu Eigentümer und Referenz passt, endet in `permanently_rejected`.

export const foodFavoriteEntity: ServerSyncEntity = ownedEntity({
  entityType: 'food_favorite',
  resource: 'food_favorite',
  table: foodFavorite,
  upsert: FoodFavoriteUpsert,
  deletable: false,
  columns: ({ foodRef, snapshot, removedAt }) => ({
    foodRefType: foodRef.type,
    foodRefKey: foodRef.key,
    snapshot,
    removedAt: removedAt === null ? null : new Date(removedAt),
  }),
  record: (row): FoodFavoriteRecord =>
    FoodFavoriteRecord.parse({
      foodRef: { type: row.foodRefType, key: row.foodRefKey },
      snapshot: row.snapshot,
      removedAt: isoOrNull(row.removedAt),
      personId: row.personId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  validate: async (_tx, { entityId, ownerPersonId, payload }) => (entityId === foodFavoriteId(ownerPersonId, payload.foodRef) ? null : 'invalid_payload'),
});
