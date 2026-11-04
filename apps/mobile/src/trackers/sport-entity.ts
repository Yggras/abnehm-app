import { EntityId, Instant } from '@abnehm/contracts/base';
import { SportEntryRecord, SportEntryUpsert } from '@abnehm/contracts/trackers';

import { requireOwnPerson } from '../local-db/person-header';
import { sportEntry } from '../local-db/schema';
import { sqliteEntity, type SyncEntityAdapter } from '../sync';
import { readSportEntry, sportColumns, tombstoneSportEntry, writeSportEntry } from './sport-repository';

// Der Sporteintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 3, Abschnitt 8), je Herkunft mit
// genau ihren Feldern: manuell mit „ersetzt durch“ und Reaktivierung, importiert mit externem Schlüssel,
// Quell-App, Ausblendestatus und überschriebener Art. Neben dem Repository kennt nur dieser Adapter die
// Tabelle, weil `sqliteEntity` sie für Versionsprüfung und Reconciliation braucht.

const sqliteSportEntity = sqliteEntity({
  entityType: 'sport_entry',
  ownerField: 'personId',
  upsert: SportEntryUpsert,
  deletable: true,
  record: SportEntryRecord,
  table: sportEntry,
  row: (entityId, { personId, createdAt, updatedAt, ...payload }) => ({ ...sportColumns(payload), id: entityId, personId, createdAt, updatedAt }),
  // Eine offene Operation wirkt nach einer Ablehnung genau wie beim Erfassen.
  replay(tx, entityId, change) {
    const at = Instant.parse(change.createdAt);
    const existing = readSportEntry(tx, entityId);
    if (change.type === 'upsert_entity') writeSportEntry(tx, entityId, existing?.personId ?? EntityId.parse(requireOwnPerson(tx).id), change.payload, at);
    else if (existing !== undefined) tombstoneSportEntry(tx, entityId, at);
  },
});

/** Sporteintrag samt seinem lokalen Tag; die Pull-Übernahme meldet damit alten und neuen Tag. */
export const sportEntryEntity: SyncEntityAdapter<SportEntryUpsert, SportEntryRecord> = {
  ...sqliteSportEntity,
  affectedDays(tx, entityId) {
    const entry = readSportEntry(tx, entityId);
    return entry === undefined ? [] : [{ type: 'tag', personId: entry.personId, localDate: entry.localDate }];
  },
};
