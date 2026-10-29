import { EntityId, Instant } from '@abnehm/contracts/base';
import { NutritionEntryRecord, NutritionEntryUpsert } from '@abnehm/contracts/nutrition';

import { requireOwnPerson } from '../local-db/person-header';
import { nutritionEntry } from '../local-db/schema';
import { sqliteEntity, type SyncEntityAdapter } from '../sync';
import { readEntry, recordRow, tombstoneEntry, writeEntry } from './entry-repository';

// Der Ernährungseintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 2, Abschnitt 11):
// generisches Upsert/Delete, Last-Write-Wins pro Zeile, Löschen gewinnt. Neben dem Repository kennt nur
// dieser Adapter die Tabelle, weil `sqliteEntity` sie für Versionsprüfung und Reconciliation braucht.

const sqliteNutritionEntity = sqliteEntity({
  entityType: 'nutrition_entry',
  ownerField: 'personId',
  upsert: NutritionEntryUpsert,
  deletable: true,
  record: NutritionEntryRecord,
  table: nutritionEntry,
  row: recordRow,
  // Eine offene Operation wirkt nach einer Ablehnung genau wie beim Erfassen.
  replay(tx, entityId, change) {
    const at = Instant.parse(change.createdAt);
    const existing = readEntry(tx, entityId);
    if (change.type === 'upsert_entity') writeEntry(tx, entityId, existing?.personId ?? EntityId.parse(requireOwnPerson(tx).id), change.payload, at);
    else if (existing !== undefined) tombstoneEntry(tx, entityId, at);
  },
});

/** Ernährungseintrag samt seinem lokalen Tag; die Pull-Übernahme meldet damit alten und neuen Tag. */
export const nutritionEntryEntity: SyncEntityAdapter<NutritionEntryUpsert, NutritionEntryRecord> = {
  ...sqliteNutritionEntity,
  affectedDays(tx, entityId) {
    const entry = readEntry(tx, entityId);
    return entry === undefined ? [] : [{ type: 'tag', personId: entry.personId, localDate: entry.localDate }];
  },
};
