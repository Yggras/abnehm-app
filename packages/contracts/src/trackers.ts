import { z } from 'zod';

import { EntityId, Instant, LocalDate, TimeZone, UtcOffsetMinutes } from './base.ts';
import { uuidV5 } from './ids.ts';
import { QuickCommandOutcome } from './today.ts';
import {
  activityTypes,
  importOrigins,
  importedWeightG,
  manualOrigin,
  manualSportMilliKcal,
  manualSportMinutes,
  manualWeightG,
  sportEntryMinutes,
  waterAmountMl,
  waterOrigin,
  type ImportOrigin,
} from './tracker-rules.ts';

// Wasser, Sport und Gewicht (Spezifikation 3): Transport-Schemas der Einträge und Ergebnisse der
// Befehle des Tracker-Moduls. Zählregeln, Grenzen und Status stehen in `./tracker-rules`.

/** Menge eines Wassereintrags in ganzen ml, 1–3000 (Designwert aus Spezifikation 3, Abschnitt 3). */
export const WaterMl = z.int().min(waterAmountMl.min).max(waterAmountMl.max);
export type WaterMl = z.infer<typeof WaterMl>;

/**
 * Vollständige Nutzlast eines Wassereintrags im Sync, ohne Eigentums-, Server- und abgeleitete
 * Felder. Lokaler Tag, Zone und Offset stammen bei der Anlage aus der Uhr; die Herkunft ist immer
 * `manuell`, weil Wasser nie importiert wird.
 */
export const WaterEntryUpsert = z.strictObject({
  amountMl: WaterMl,
  origin: z.literal(waterOrigin),
  loggedAt: Instant,
  localDate: LocalDate,
  timeZone: TimeZone,
  utcOffsetMinutes: UtcOffsetMinutes,
});
export type WaterEntryUpsert = z.infer<typeof WaterEntryUpsert>;

/** Kanonischer Wassereintrag des Servers: Nutzlast samt Eigentümer und Zeitpunkten. */
export const WaterEntryRecord = z.strictObject({
  ...WaterEntryUpsert.shape,
  personId: EntityId,
  createdAt: Instant,
  updatedAt: Instant,
});
export type WaterEntryRecord = z.infer<typeof WaterEntryRecord>;

/** Werte der Meldung nach einer Wasserbuchung, etwa „+250 ml Wasser · Rückgängig“. */
export const WaterAddedValues = z.strictObject({ ml: WaterMl });
export type WaterAddedValues = z.infer<typeof WaterAddedValues>;

/**
 * Ergebnis von `addWater` und damit auch von `water.quick_add`: Meldung samt typisierten Werten und
 * flüchtigem, nie synchronisiertem Undo-Token.
 */
export const WaterAddedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('wasser.hinzugefuegt'),
  values: WaterAddedValues,
});
export type WaterAddedOutcome = z.infer<typeof WaterAddedOutcome>;

/** Aktivitätsart eines Sporteintrags; es gibt keine Intensität (Spezifikation 3, Abschnitt 3). */
export const ActivityType = z.enum(activityTypes);
export type ActivityType = z.infer<typeof ActivityType>;

/** Dauer einer manuellen Einheit in ganzen Minuten, 1–600 (Designwert aus Spezifikation 3, Abschnitt 3). */
export const ManualSportMinutes = z.int().min(manualSportMinutes.min).max(manualSportMinutes.max);
export type ManualSportMinutes = z.infer<typeof ManualSportMinutes>;

/** Felder jedes Sporteintrags: Art, Beginn, Dauer in Minuten, optionale aktive Kalorien und lokaler Tag des Beginns. */
const sportEntryFields = {
  activityType: ActivityType,
  startedAt: Instant,
  localDate: LocalDate,
  timeZone: TimeZone,
  utcOffsetMinutes: UtcOffsetMinutes,
};

/**
 * Manueller Sporteintrag: 1–600 Minuten und optional 0–5000 kcal. Nur er hat den „ersetzt durch“-Verweis auf
 * einen Import derselben Person und die dauerhafte Reaktivierung; ob er zählt, berechnen die Tracker-Regeln.
 */
const ManualSportEntryUpsert = z.strictObject({
  ...sportEntryFields,
  durationMinutes: ManualSportMinutes,
  activeMilliKcal: z.int().min(manualSportMilliKcal.min).max(manualSportMilliKcal.max).nullable(),
  origin: z.literal(manualOrigin),
  replacedByEntryId: EntityId.nullable(),
  reactivatedAt: Instant.nullable(),
});

/**
 * Importierter Sporteintrag aus Apple Health bzw. Health Connect, in den Grenzen des Schemas (1–1440 Minuten).
 * Nur er hat externen Schlüssel, Quell-App, Ausblendestatus und die überschriebene Aktivitätsart, die
 * spätere Quelländerungen überdauert (Spezifikation 3, Abschnitt 6).
 */
export const ImportedSportEntryUpsert = z.strictObject({
  ...sportEntryFields,
  overrideActivityType: ActivityType.nullable(),
  durationMinutes: z.int().min(sportEntryMinutes.min).max(sportEntryMinutes.max),
  activeMilliKcal: z.int().nonnegative().nullable(),
  origin: z.enum(importOrigins),
  externalKey: z.string().min(1).max(200),
  sourceAppId: z.string().min(1).max(200).nullable(),
  sourceAppName: z.string().min(1).max(200).nullable(),
  hiddenAt: Instant.nullable(),
});
export type ImportedSportEntryUpsert = z.infer<typeof ImportedSportEntryUpsert>;

/**
 * Vollständige Nutzlast eines Sporteintrags im Sync, je Herkunft mit genau ihren Feldern (Spezifikation 0,
 * Abschnitt 8; Spezifikation 3, Abschnitt 8). Ohne Eigentums-, Server- und abgeleitete Felder: Wochenminuten
 * und Ersetzungswirkung werden berechnet, nicht gespeichert.
 */
export const SportEntryUpsert = z.discriminatedUnion('origin', [ManualSportEntryUpsert, ImportedSportEntryUpsert]);
export type SportEntryUpsert = z.infer<typeof SportEntryUpsert>;

const ownership = { personId: EntityId, createdAt: Instant, updatedAt: Instant };

/** Kanonischer Sporteintrag des Servers: Nutzlast samt Eigentümer und Zeitpunkten. */
export const SportEntryRecord = z.discriminatedUnion('origin', [
  ManualSportEntryUpsert.extend(ownership),
  ImportedSportEntryUpsert.extend(ownership),
]);
export type SportEntryRecord = z.infer<typeof SportEntryRecord>;

/**
 * Werte der Meldungen nach Eintragen, Bearbeiten und Löschen einer manuellen Einheit, etwa
 * „30 min Laufen eingetragen · Rückgängig“: Art und Dauer der Einheit.
 */
export const SportMessageValues = z.strictObject({ activityType: ActivityType, durationMinutes: ManualSportMinutes });
export type SportMessageValues = z.infer<typeof SportMessageValues>;

/** Ergebnis von `recordSport`: Meldung samt typisierten Werten und flüchtigem, nie synchronisiertem Undo-Token. */
export const SportRecordedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('sport.eingetragen'),
  values: SportMessageValues,
});
export type SportRecordedOutcome = z.infer<typeof SportRecordedOutcome>;

/**
 * Ergebnis von `updateSport` (Art, Dauer, Beginn oder Kalorien einer manuellen Einheit geändert), etwa
 * „45 min Laufen gespeichert · Rückgängig“; die Werte sind die neuen.
 */
export const SportUpdatedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('sport.geaendert'),
  values: SportMessageValues,
});
export type SportUpdatedOutcome = z.infer<typeof SportUpdatedOutcome>;

/** Ergebnis von `deleteSport` ohne Bestätigungsdialog, etwa „30 min Laufen gelöscht · Rückgängig“. */
export const SportDeletedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('sport.geloescht'),
  values: SportMessageValues,
});
export type SportDeletedOutcome = z.infer<typeof SportDeletedOutcome>;

/** Manuell eingegebenes Körpergewicht in g: 20,0–350,0 kg in 100-g-Schritten (Spezifikation 3, Abschnitt 3). */
export const ManualWeightG = z.int().min(manualWeightG.min).max(manualWeightG.max).multipleOf(manualWeightG.step);
export type ManualWeightG = z.infer<typeof ManualWeightG>;

/** Felder jedes Gewichtseintrags: Messzeitpunkt samt lokalem Tag, Zone und Offset der Anlage. */
const weightEntryFields = { measuredAt: Instant, localDate: LocalDate, timeZone: TimeZone, utcOffsetMinutes: UtcOffsetMinutes };

/** Manueller Gewichtseintrag: 20,0–350,0 kg in 100-g-Schritten. */
const ManualWeightEntryUpsert = z.strictObject({ ...weightEntryFields, weightG: ManualWeightG, origin: z.literal(manualOrigin) });

/**
 * Importierter Gewichtseintrag aus Apple Health bzw. Health Connect: genaue Gramm im Bereich 20–350 kg,
 * externer Schlüssel, Quell-App und Ausblendestatus (Spezifikation 3, Abschnitte 3 und 6; #183).
 */
export const ImportedWeightEntryUpsert = z.strictObject({
  ...weightEntryFields,
  weightG: z.int().min(importedWeightG.min).max(importedWeightG.max),
  origin: z.enum(importOrigins),
  externalKey: z.string().min(1).max(200),
  sourceAppId: z.string().min(1).max(200).nullable(),
  sourceAppName: z.string().min(1).max(200).nullable(),
  hiddenAt: Instant.nullable(),
});
export type ImportedWeightEntryUpsert = z.infer<typeof ImportedWeightEntryUpsert>;

/**
 * Vollständige Nutzlast eines Gewichtseintrags im Sync, je Herkunft mit genau ihren Feldern, ohne
 * Eigentums-, Server- und abgeleitete Felder. Lokaler Tag, Zone und Offset gehören zum Messzeitpunkt in
 * der Zone der Anlage; bei Importen gilt der mitgelieferte Offset (Spezifikation 3, Abschnitt 6).
 */
export const WeightEntryUpsert = z.discriminatedUnion('origin', [ManualWeightEntryUpsert, ImportedWeightEntryUpsert]);
export type WeightEntryUpsert = z.infer<typeof WeightEntryUpsert>;

/** Kanonischer Gewichtseintrag des Servers: Nutzlast samt Eigentümer und Zeitpunkten. */
export const WeightEntryRecord = z.discriminatedUnion('origin', [ManualWeightEntryUpsert.extend(ownership), ImportedWeightEntryUpsert.extend(ownership)]);
export type WeightEntryRecord = z.infer<typeof WeightEntryRecord>;

/** Herkunft eines importierten Eintrags. */
export type { ImportOrigin };

const importedSportNamespace = '6d0c2a4e-8f1b-4c7d-9e3a-2b5f7c9d1e40';
const importedWeightNamespace = '6d0c2a4e-8f1b-4c7d-9e3a-2b5f7c9d1e41';

/**
 * Deterministische ID eines importierten Sporteintrags aus Person, Herkunft und externem Schlüssel
 * (Spezifikation 3, Abschnitt 6). Zwei Geräte derselben Person erzeugen so dieselbe ID; der natürliche
 * Schlüssel verhindert Dubletten.
 */
export function importedSportEntryId(personId: EntityId, origin: ImportOrigin, externalKey: string): EntityId {
  return EntityId.parse(uuidV5(importedSportNamespace, `${personId}:${origin}:${externalKey}`));
}

/** Deterministische ID eines importierten Gewichtseintrags, wie `importedSportEntryId`. */
export function importedWeightEntryId(personId: EntityId, origin: ImportOrigin, externalKey: string): EntityId {
  return EntityId.parse(uuidV5(importedWeightNamespace, `${personId}:${origin}:${externalKey}`));
}

/**
 * Werte der Meldungen nach Eintragen, Bearbeiten und Löschen eines manuellen Gewichts, etwa
 * „82,4 kg eingetragen · Rückgängig“: das Gewicht der Messung.
 */
export const WeightMessageValues = z.strictObject({ weightG: ManualWeightG });
export type WeightMessageValues = z.infer<typeof WeightMessageValues>;

/** Ergebnis von `recordWeight`: Meldung samt typisierten Werten und flüchtigem, nie synchronisiertem Undo-Token. */
export const WeightRecordedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('gewicht.eingetragen'),
  values: WeightMessageValues,
});
export type WeightRecordedOutcome = z.infer<typeof WeightRecordedOutcome>;

/**
 * Ergebnis von `updateWeight` (Wert und Messzeitpunkt eines manuellen Eintrags geändert), etwa
 * „82,1 kg gespeichert · Rückgängig“; die Werte sind das neue Gewicht.
 */
export const WeightUpdatedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('gewicht.geaendert'),
  values: WeightMessageValues,
});
export type WeightUpdatedOutcome = z.infer<typeof WeightUpdatedOutcome>;

/** Ergebnis von `deleteWeight` ohne Bestätigungsdialog, etwa „82,4 kg gelöscht · Rückgängig“. */
export const WeightDeletedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('gewicht.geloescht'),
  values: WeightMessageValues,
});
export type WeightDeletedOutcome = z.infer<typeof WeightDeletedOutcome>;
