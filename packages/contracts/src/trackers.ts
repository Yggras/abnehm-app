import { z } from 'zod';

import { EntityId, Instant, LocalDate, TimeZone, UtcOffsetMinutes } from './base.ts';
import { QuickCommandOutcome } from './today.ts';
import {
  activityTypes,
  importOrigins,
  manualOrigin,
  manualSportMilliKcal,
  manualSportMinutes,
  manualWeightG,
  sportEntryMinutes,
  waterAmountMl,
  waterOrigin,
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
const ImportedSportEntryUpsert = z.strictObject({
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

/** Werte der Meldung nach dem Eintragen, etwa „30 min Laufen eingetragen · Rückgängig“. */
export const SportRecordedValues = z.strictObject({ activityType: ActivityType, durationMinutes: ManualSportMinutes });
export type SportRecordedValues = z.infer<typeof SportRecordedValues>;

/** Ergebnis von `recordSport`: Meldung samt typisierten Werten und flüchtigem, nie synchronisiertem Undo-Token. */
export const SportRecordedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('sport.eingetragen'),
  values: SportRecordedValues,
});
export type SportRecordedOutcome = z.infer<typeof SportRecordedOutcome>;

/** Manuell eingegebenes Körpergewicht in g: 20,0–350,0 kg in 100-g-Schritten (Spezifikation 3, Abschnitt 3). */
export const ManualWeightG = z.int().min(manualWeightG.min).max(manualWeightG.max).multipleOf(manualWeightG.step);
export type ManualWeightG = z.infer<typeof ManualWeightG>;

/**
 * Vollständige Nutzlast eines Gewichtseintrags im Sync, ohne Eigentums-, Server- und abgeleitete
 * Felder. Lokaler Tag, Zone und Offset gehören zum Messzeitpunkt in der Zone der Anlage. Bisher gibt es
 * nur manuelle Einträge; importierte samt externem Schlüssel und Ausblendestatus ergänzt der
 * Health-Import (Spezifikation 3, Abschnitt 6).
 */
export const WeightEntryUpsert = z.strictObject({
  weightG: ManualWeightG,
  origin: z.literal(manualOrigin),
  measuredAt: Instant,
  localDate: LocalDate,
  timeZone: TimeZone,
  utcOffsetMinutes: UtcOffsetMinutes,
});
export type WeightEntryUpsert = z.infer<typeof WeightEntryUpsert>;

/** Kanonischer Gewichtseintrag des Servers: Nutzlast samt Eigentümer und Zeitpunkten. */
export const WeightEntryRecord = z.strictObject({
  ...WeightEntryUpsert.shape,
  personId: EntityId,
  createdAt: Instant,
  updatedAt: Instant,
});
export type WeightEntryRecord = z.infer<typeof WeightEntryRecord>;

/** Werte der Meldung nach dem Eintragen, etwa „82,4 kg eingetragen · Rückgängig“. */
export const WeightRecordedValues = z.strictObject({ weightG: ManualWeightG });
export type WeightRecordedValues = z.infer<typeof WeightRecordedValues>;

/** Ergebnis von `recordWeight`: Meldung samt typisierten Werten und flüchtigem, nie synchronisiertem Undo-Token. */
export const WeightRecordedOutcome = QuickCommandOutcome.extend({
  messageKey: z.literal('gewicht.eingetragen'),
  values: WeightRecordedValues,
});
export type WeightRecordedOutcome = z.infer<typeof WeightRecordedOutcome>;
