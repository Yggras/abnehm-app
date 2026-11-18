import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { WeightEntryRecord, WeightEntryUpsert } from '@abnehm/contracts/trackers';

import { weightEntry } from '../db/schema/index.ts';
import { ownedEntity } from '../sync/registry.ts';

// Der Gewichtseintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 3, Abschnitt 8), je Herkunft mit
// genau ihren Feldern: manuell ohne, importiert mit externem Schlüssel, Quell-App und Ausblendestatus
// (#183). Eigentum, Lesen, Upsert und Löschen entscheidet die Regel der Ressource `weight_entry`. Die
// Felder der jeweils anderen Herkunft sind leer, wie es die `CHECK`-Constraints verlangen.

type Row = typeof weightEntry.$inferSelect;

const iso = (at: Date | null) => (at === null ? null : Instant.parse(at.toISOString()));

export const weightEntryEntity = ownedEntity({
  entityType: 'weight_entry',
  resource: 'weight_entry',
  table: weightEntry,
  upsert: WeightEntryUpsert,
  deletable: true,
  columns: (payload) => {
    const shared = {
      weightG: payload.weightG,
      measuredAt: new Date(payload.measuredAt),
      origin: payload.origin,
      localDate: payload.localDate,
      timeZone: payload.timeZone,
      utcOffsetMinutes: payload.utcOffsetMinutes,
    };
    if (payload.origin === 'manuell') return { ...shared, externalKey: null, sourceAppId: null, sourceAppName: null, hiddenAt: null };
    return {
      ...shared,
      externalKey: payload.externalKey,
      sourceAppId: payload.sourceAppId,
      sourceAppName: payload.sourceAppName,
      hiddenAt: payload.hiddenAt === null ? null : new Date(payload.hiddenAt),
    };
  },
  record: (row: Row): WeightEntryRecord => {
    const shared = {
      personId: EntityId.parse(row.personId),
      weightG: row.weightG,
      measuredAt: Instant.parse(row.measuredAt.toISOString()),
      localDate: LocalDate.parse(row.localDate),
      timeZone: TimeZone.parse(row.timeZone),
      utcOffsetMinutes: row.utcOffsetMinutes,
      createdAt: Instant.parse(row.createdAt.toISOString()),
      updatedAt: Instant.parse(row.updatedAt.toISOString()),
    };
    // Der kanonische Datensatz geht durch dasselbe Schema wie jede Nutzlast: Eine Zeile, die zu keiner Herkunft passt, scheitert laut.
    return WeightEntryRecord.parse(
      row.origin === 'manuell'
        ? { ...shared, origin: row.origin }
        : { ...shared, origin: row.origin, externalKey: row.externalKey, sourceAppId: row.sourceAppId, sourceAppName: row.sourceAppName, hiddenAt: iso(row.hiddenAt) },
    );
  },
});
