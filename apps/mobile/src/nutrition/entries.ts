import type { ClockReading } from '@abnehm/clock';
import { EntityId, Instant, TimeZone, type LocalDate, type MealKey } from '@abnehm/contracts/base';
import type { DailyGoalCause } from '@abnehm/contracts/daily-goals';
import {
  entryAmount,
  entryTotals,
  NutritionEntryUpsert,
  roundKcal,
  type CaptureMethod,
  type DisplayUnit,
  type FoodRef,
  type NutritionEntryAddedValues,
  type NutritionSnapshot,
} from '@abnehm/contracts/nutrition';

import type { TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { nutritionEntryEntity } from './entry-entity';
import { readEntry, tombstoneEntry, writeEntry } from './entry-repository';
import type { NutritionDependencies } from './nutrition';

// Befehle des Moduls „Ernährung“ (Spezifikation 2, Abschnitt 6). Sie laufen in der Transaktion des
// Aufrufers: Fachzeile, Outbox-Operation und `reevaluateDailyGoals` entstehen gemeinsam.

/** Eine Eingabe verletzt die Regeln der Ernährung; es wurde nichts geschrieben. */
export class InvalidNutritionInputError extends Error {
  override name = 'InvalidNutritionInputError';
}

/** Ein neuer Eintrag, wie ihn die Mengenprüfung bestätigt; Menge und Summen rechnet das Modul. */
export type NewEntry = Readonly<{
  /** Der im Protokoll gewählte Tag; künftige Tage sind nicht erreichbar. */
  localDate: LocalDate;
  meal: MealKey;
  captureMethod: CaptureMethod;
  foodRef: FoodRef | null;
  snapshot: NutritionSnapshot;
  displayUnit: DisplayUnit;
  /** Eingegebene Menge in Tausendsteln der Anzeigeeinheit, z. B. 500 für 0,5 Stück. */
  displayAmountMilli: number;
}>;

/** Was „Rückgängig“ nach dem Hinzufügen braucht; flüchtig und nie synchronisiert. */
export type EntryUndo = Readonly<{ type: 'entry_added'; entryId: EntityId }>;

export type EntryAdded = Readonly<{ messageKey: 'ernaehrung.eintrag_hinzugefuegt'; values: NutritionEntryAddedValues; undo: EntryUndo }>;

export type Dependencies = Pick<NutritionDependencies, 'clock' | 'writer' | 'persistence' | 'newId'>;

/**
 * Die geprüfte Nutzlast eines neuen Eintrags: Basismenge und Summen folgen deterministisch aus Snapshot
 * und Eingabe; Erfassungszeitpunkt, Zone und Offset stammen aus der übergebenen Ablesung der Uhr. Wirft
 * `InvalidNutritionInputError` bei einem künftigen Tag, einer ungültigen Menge oder einem inkonsistenten
 * Eintrag. Alle Erfassungswege bilden ihre Einträge hiermit.
 */
export function newEntryPayload(reading: ClockReading, input: NewEntry, mealPhotoId: EntityId | null): NutritionEntryUpsert {
  if (input.localDate > reading.localDate) throw new InvalidNutritionInputError(`Künftiger Tag ${input.localDate} (heute ${reading.localDate})`);
  const amount = entryAmount(input.snapshot, input.displayUnit, input.displayAmountMilli);
  if (amount.type === 'problem') throw new InvalidNutritionInputError(`Ungültige Menge: ${amount.problem}`);
  const parsed = NutritionEntryUpsert.safeParse({
    consumedAt: reading.instant,
    localDate: input.localDate,
    timeZone: TimeZone.parse(reading.timeZone),
    utcOffsetMinutes: reading.utcOffsetMinutes,
    meal: input.meal,
    captureMethod: input.captureMethod,
    foodRef: input.foodRef,
    snapshot: input.snapshot,
    amount: amount.amount,
    totals: entryTotals(input.snapshot, amount.amount),
    mealPhotoId,
  });
  if (!parsed.success) throw new InvalidNutritionInputError(`Ungültiger Eintrag: ${parsed.error.message}`);
  return parsed.data;
}

/** Legt einen Eintrag an, mit Outbox-Operation und Tagesmeldung in der Transaktion des Aufrufers. */
export function addEntry(tx: TransactionContext, { clock, writer, persistence, newId }: Dependencies, input: NewEntry): EntryAdded {
  // Vor dem ersten Schreibzugriff: Eine ungültige Eingabe hinterlässt nichts.
  const reading = clock.read();
  const payload = newEntryPayload(reading, input, null);
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const entryId = newId();
  writeEntry(tx, entryId, personId, payload, Instant.parse(reading.instant));
  writer.upsert(tx, { entityType: nutritionEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: null });
  persistence.reevaluateDailyGoals(tx, personId, [payload.localDate], 'eingabe');
  return {
    messageKey: 'ernaehrung.eintrag_hinzugefuegt',
    values: { meal: payload.meal, kcal: roundKcal(payload.totals.milliKcal) },
    undo: { type: 'entry_added', entryId },
  };
}

/**
 * Entfernt einen Eintrag (Tombstone) und meldet seinen gespeicherten Tag erneut. Ist er schon gelöscht,
 * etwa durch einen Pull, bleibt alles, wie es ist.
 */
export function removeEntry(tx: TransactionContext, { clock, writer, persistence }: Dependencies, entryId: EntityId, cause: DailyGoalCause): void {
  const entry = readEntry(tx, entryId);
  if (entry === undefined || entry.deletedAt !== null) return;
  tombstoneEntry(tx, entryId, Instant.parse(clock.read().instant));
  writer.delete(tx, { entityType: nutritionEntryEntity.entityType, entityId: entryId, knownServerVersion: entry.serverVersion });
  persistence.reevaluateDailyGoals(tx, entry.personId, [entry.localDate], cause);
}
