import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { waterOrigin } from '@abnehm/contracts/tracker-rules';
import { WaterEntryUpsert, type WaterEntryRecord } from '@abnehm/contracts/trackers';

import { waterEntry } from '../db/schema/index.ts';
import { ownedEntity } from '../sync/registry.ts';

// Der Wassereintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 3, Abschnitt 8). Eigentum,
// Lesen, Upsert und Löschen entscheidet die Regel der Ressource `water_entry`; die Herkunft ist nach
// den Tracker-Regeln immer `manuell`, auch wenn die Nutzlast sie schon nennt.
export const waterEntryEntity = ownedEntity({
  entityType: 'water_entry',
  resource: 'water_entry',
  table: waterEntry,
  upsert: WaterEntryUpsert,
  deletable: true,
  columns: (payload) => ({
    amountMl: payload.amountMl,
    origin: waterOrigin,
    loggedAt: new Date(payload.loggedAt),
    localDate: payload.localDate,
    timeZone: payload.timeZone,
    utcOffsetMinutes: payload.utcOffsetMinutes,
  }),
  record: (row): WaterEntryRecord => ({
    personId: EntityId.parse(row.personId),
    amountMl: row.amountMl,
    origin: waterOrigin,
    loggedAt: Instant.parse(row.loggedAt.toISOString()),
    localDate: LocalDate.parse(row.localDate),
    timeZone: TimeZone.parse(row.timeZone),
    utcOffsetMinutes: row.utcOffsetMinutes,
    createdAt: Instant.parse(row.createdAt.toISOString()),
    updatedAt: Instant.parse(row.updatedAt.toISOString()),
  }),
});
