import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { SportEntryRecord, SportEntryUpsert } from '@abnehm/contracts/trackers';

import { sportEntry } from '../db/schema/index.ts';
import { ownedEntity } from '../sync/registry.ts';

// Der Sporteintrag im Sync (Spezifikation 0, Abschnitt 10; Spezifikation 3, Abschnitt 8), je Herkunft mit
// genau ihren Feldern. Eigentum, Lesen, Upsert und Löschen entscheidet die Regel der Ressource
// `sport_entry`; dass der „ersetzt durch“-Verweis auf einen Eintrag derselben Person zeigt, erzwingt der
// zusammengesetzte Fremdschlüssel der Tabelle. Die Felder der jeweils anderen Herkunft sind leer, wie es
// die `CHECK`-Constraints verlangen.

type Row = typeof sportEntry.$inferSelect;

const iso = (at: Date | null) => (at === null ? null : Instant.parse(at.toISOString()));

export const sportEntryEntity = ownedEntity({
  entityType: 'sport_entry',
  resource: 'sport_entry',
  table: sportEntry,
  upsert: SportEntryUpsert,
  deletable: true,
  columns: (payload) => {
    const shared = {
      activityType: payload.activityType,
      startedAt: new Date(payload.startedAt),
      durationMinutes: payload.durationMinutes,
      activeMilliKcal: payload.activeMilliKcal,
      origin: payload.origin,
      localDate: payload.localDate,
      timeZone: payload.timeZone,
      utcOffsetMinutes: payload.utcOffsetMinutes,
    };
    if (payload.origin === 'manuell') {
      return {
        ...shared,
        overrideActivityType: null, externalKey: null, sourceAppId: null, sourceAppName: null, hiddenAt: null,
        replacedByEntryId: payload.replacedByEntryId,
        reactivatedAt: payload.reactivatedAt === null ? null : new Date(payload.reactivatedAt),
      };
    }
    return {
      ...shared,
      overrideActivityType: payload.overrideActivityType,
      externalKey: payload.externalKey,
      sourceAppId: payload.sourceAppId,
      sourceAppName: payload.sourceAppName,
      hiddenAt: payload.hiddenAt === null ? null : new Date(payload.hiddenAt),
      replacedByEntryId: null,
      reactivatedAt: null,
    };
  },
  record: (row: Row): SportEntryRecord => {
    const shared = {
      personId: EntityId.parse(row.personId),
      activityType: row.activityType,
      startedAt: Instant.parse(row.startedAt.toISOString()),
      durationMinutes: row.durationMinutes,
      activeMilliKcal: row.activeMilliKcal,
      localDate: LocalDate.parse(row.localDate),
      timeZone: TimeZone.parse(row.timeZone),
      utcOffsetMinutes: row.utcOffsetMinutes,
      createdAt: Instant.parse(row.createdAt.toISOString()),
      updatedAt: Instant.parse(row.updatedAt.toISOString()),
    };
    // Der kanonische Datensatz geht durch dasselbe Schema wie jede Nutzlast: Eine Zeile, die zu keiner Herkunft passt, scheitert laut.
    return SportEntryRecord.parse(
      row.origin === 'manuell'
        ? { ...shared, origin: row.origin, replacedByEntryId: row.replacedByEntryId, reactivatedAt: iso(row.reactivatedAt) }
        : {
            ...shared,
            origin: row.origin,
            overrideActivityType: row.overrideActivityType,
            externalKey: row.externalKey,
            sourceAppId: row.sourceAppId,
            sourceAppName: row.sourceAppName,
            hiddenAt: iso(row.hiddenAt),
          },
    );
  },
});
