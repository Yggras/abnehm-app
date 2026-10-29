import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { WeightEntryRecord, WeightEntryUpsert } from '@abnehm/contracts/trackers';

import { weightEntry } from '../db/schema/index.ts';
import { ownedEntity } from '../sync/registry.ts';

// Der Gewichtseintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 3, Abschnitt 8). Eigentum,
// Lesen, Upsert und Löschen entscheidet die Regel der Ressource `weight_entry`. Bisher kommen nur
// manuelle Einträge über den Sync; importierte samt externem Schlüssel und Ausblendestatus ergänzt der
// Health-Import (Spezifikation 3, Abschnitt 6). Bis dahin scheitert `record` an einer anderen Herkunft
// laut, statt einen Import still als manuell auszugeben.
export const weightEntryEntity = ownedEntity({
  entityType: 'weight_entry',
  resource: 'weight_entry',
  table: weightEntry,
  upsert: WeightEntryUpsert,
  deletable: true,
  columns: (payload) => ({
    weightG: payload.weightG,
    measuredAt: new Date(payload.measuredAt),
    origin: payload.origin,
    externalKey: null,
    sourceAppId: null,
    sourceAppName: null,
    hiddenAt: null,
    localDate: payload.localDate,
    timeZone: payload.timeZone,
    utcOffsetMinutes: payload.utcOffsetMinutes,
  }),
  record: (row): WeightEntryRecord => ({
    personId: EntityId.parse(row.personId),
    weightG: row.weightG,
    origin: WeightEntryRecord.shape.origin.parse(row.origin),
    measuredAt: Instant.parse(row.measuredAt.toISOString()),
    localDate: LocalDate.parse(row.localDate),
    timeZone: TimeZone.parse(row.timeZone),
    utcOffsetMinutes: row.utcOffsetMinutes,
    createdAt: Instant.parse(row.createdAt.toISOString()),
    updatedAt: Instant.parse(row.updatedAt.toISOString()),
  }),
});
