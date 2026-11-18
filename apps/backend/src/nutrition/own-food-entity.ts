import { OwnFoodRecord, OwnFoodUpsert } from '@abnehm/contracts/nutrition';

import { ownFood } from '../db/schema/index.ts';
import { ownedEntity, type ServerSyncEntity } from '../sync/registry.ts';

// Das eigene Lebensmittel im Sync (Spezifikation 2, Abschnitte 3 und 11): generisches Upsert/Delete,
// Last-Write-Wins pro Zeile, Löschen gewinnt. Eigentum, Lesen, Upsert und Löschen entscheidet die Regel
// der Ressource `own_food`. Das Transport-Schema prüft nicht negative Nährwerte und Makros höchstens in
// Höhe der Bezugsmenge; eine Verletzung endet in `permanently_rejected`.

export const ownFoodEntity: ServerSyncEntity = ownedEntity({
  entityType: 'own_food',
  resource: 'own_food',
  table: ownFood,
  upsert: OwnFoodUpsert,
  deletable: true,
  columns: ({ origin, ...food }) => ({
    name: food.name,
    baseUnit: food.baseUnit,
    referenceAmount: food.referenceAmount,
    milliKcal: food.milliKcal,
    proteinMg: food.proteinMg,
    carbsMg: food.carbsMg,
    fatMg: food.fatMg,
    portions: food.portions,
    originType: origin?.type ?? null,
    originKey: origin?.key ?? null,
  }),
  record: (row): OwnFoodRecord =>
    OwnFoodRecord.parse({
      name: row.name,
      baseUnit: row.baseUnit,
      referenceAmount: row.referenceAmount,
      milliKcal: row.milliKcal,
      proteinMg: row.proteinMg,
      carbsMg: row.carbsMg,
      fatMg: row.fatMg,
      portions: row.portions,
      origin: row.originType === null ? null : { type: row.originType, key: row.originKey },
      personId: row.personId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
});
