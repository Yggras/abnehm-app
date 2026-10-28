import { z } from 'zod';

import { EntityId, Instant, LocalDate, TimeZone, UtcOffsetMinutes } from './base.ts';
import { QuickCommandOutcome } from './today.ts';
import { waterAmountMl, waterOrigin } from './tracker-rules.ts';

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
