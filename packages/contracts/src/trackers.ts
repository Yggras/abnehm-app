import { z } from 'zod';

import { EntityId, Instant, LocalDate, TimeZone, UtcOffsetMinutes } from './base.ts';
import { QuickCommandOutcome } from './today.ts';
import { manualWeightG, waterAmountMl, waterOrigin } from './tracker-rules.ts';

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
  origin: z.literal('manuell'),
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
