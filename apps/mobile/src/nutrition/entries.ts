import type { ClockReading } from '@abnehm/clock';
import { EntityId, Instant, TimeZone, type LocalDate, type MealKey, type ServerVersion } from '@abnehm/contracts/base';
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
import { readEntry, readEntryContent, tombstoneEntry, writeEntry, type StoredEntryContent } from './entry-repository';
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

/** Was die Mengenansicht an einem bestehenden Eintrag ändert; der Tag bleibt (Spezifikation 2, Abschnitt 6). */
export type EntryChange = Readonly<{ meal: MealKey; displayUnit: DisplayUnit; displayAmountMilli: number }>;

/** Was „Rückgängig“ braucht; flüchtig und nie synchronisiert. */
export type EntryUndo =
  | Readonly<{ type: 'entry_added'; entryId: EntityId }>
  | Readonly<{ type: 'entry_updated'; entryId: EntityId; previous: EntryChange }>
  | Readonly<{ type: 'entry_deleted'; deleted: NutritionEntryUpsert }>;

export type EntryAdded = Readonly<{ messageKey: 'ernaehrung.eintrag_hinzugefuegt'; values: NutritionEntryAddedValues; undo: EntryUndo }>;
export type EntryUpdated = Readonly<{ messageKey: 'ernaehrung.eintrag_gespeichert'; values: Record<string, never>; undo: EntryUndo }>;
export type EntryDeleted = Readonly<{ messageKey: 'ernaehrung.eintrag_geloescht'; values: Record<string, never>; undo: EntryUndo }>;

export type EntryDependencies = Pick<NutritionDependencies, 'clock' | 'writer' | 'persistence' | 'newId'>;

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
export function addEntry(tx: TransactionContext, dependencies: EntryDependencies, input: NewEntry): EntryAdded {
  const { clock, newId } = dependencies;
  // Vor dem ersten Schreibzugriff: Eine ungültige Eingabe hinterlässt nichts.
  const reading = clock.read();
  const payload = newEntryPayload(reading, input, null);
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const entryId = newId();
  persistEntry(tx, dependencies, { entryId, personId, payload, knownServerVersion: null, cause: 'eingabe', now: Instant.parse(reading.instant) });
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
export function removeEntry(tx: TransactionContext, { clock, writer, persistence }: EntryDependencies, entryId: EntityId, cause: DailyGoalCause): void {
  const entry = readEntry(tx, entryId);
  if (entry === undefined || entry.deletedAt !== null) return;
  tombstoneEntry(tx, entryId, Instant.parse(clock.read().instant));
  writer.delete(tx, { entityType: nutritionEntryEntity.entityType, entityId: entryId, knownServerVersion: entry.serverVersion });
  persistence.reevaluateDailyGoals(tx, entry.personId, [entry.localDate], cause);
}

/**
 * Ändert Menge, Einheit und Mahlzeit eines Eintrags (Spezifikation 2, Abschnitt 6). Die Summen entstehen
 * neu aus demselben Snapshot; Tag, Erfassungszeitpunkt, Zone, Offset, Lebensmittel, Erfassungsart und
 * Fotoverknüpfung bleiben. Meldet den gespeicherten Tag. Wirft `InvalidNutritionInputError`, ohne zu
 * schreiben, für eine ungültige Menge und einen unbekannten oder gelöschten Eintrag.
 */
export function updateEntry(tx: TransactionContext, dependencies: EntryDependencies, entryId: EntityId, change: EntryChange): EntryUpdated {
  const existing = requireLiving(tx, entryId);
  const { meal, amount } = existing.content;
  writeChange(tx, dependencies, entryId, existing, change, 'eingabe');
  return {
    messageKey: 'ernaehrung.eintrag_gespeichert',
    values: {},
    undo: { type: 'entry_updated', entryId, previous: { meal, displayUnit: amount.displayUnit, displayAmountMilli: amount.displayAmountMilli } },
  };
}

/**
 * Löscht einen Eintrag ohne Bestätigungsdialog als Tombstone und meldet seinen Tag (Spezifikation 2,
 * Abschnitt 6). Wirft `InvalidNutritionInputError`, ohne zu schreiben, für einen unbekannten oder schon
 * gelöschten Eintrag.
 */
export function deleteEntry(tx: TransactionContext, dependencies: EntryDependencies, entryId: EntityId): EntryDeleted {
  const existing = requireLiving(tx, entryId);
  removeEntry(tx, dependencies, entryId, 'eingabe');
  return { messageKey: 'ernaehrung.eintrag_geloescht', values: {}, undo: { type: 'entry_deleted', deleted: existing.content } };
}

/**
 * Nimmt einen Befehl zurück und meldet den Tag mit `rueckgaengig`. Sync-sicher, weil Tombstones für
 * Clientoperationen endgültig sind (Spezifikation 0, Abschnitt 10):
 * - Hinzufügen: Der Eintrag wird gelöscht.
 * - Ändern: Menge, Einheit und Mahlzeit von vorher werden zurückgeschrieben (Last-Write-Wins).
 * - Löschen: Ein **neuer** Eintrag mit neuer ID und identischem Inhalt entsteht: Snapshot, Menge, Tag,
 *   Mahlzeit, Erfassungsart, Erfassungszeitpunkt samt Zone und Fotoverknüpfung.
 *
 * Ist der Eintrag inzwischen gelöscht, etwa durch einen Pull, bleibt beim Hinzufügen und Ändern alles, wie es ist.
 */
export function undoEntry(tx: TransactionContext, dependencies: EntryDependencies, undo: EntryUndo): void {
  switch (undo.type) {
    case 'entry_added':
      removeEntry(tx, dependencies, undo.entryId, 'rueckgaengig');
      return;
    case 'entry_updated': {
      const existing = readEntryContent(tx, undo.entryId);
      if (existing === undefined || existing.deletedAt !== null) return;
      writeChange(tx, dependencies, undo.entryId, existing, undo.previous, 'rueckgaengig');
      return;
    }
    case 'entry_deleted': {
      const { clock, newId } = dependencies;
      // Die Fotoverknüpfung kommt unverändert zurück, auch wenn das Foto inzwischen gelöscht ist (etwa durch
      // einen Pull). Ob nur nicht gelöschte Fotos wieder verknüpft werden (Spezifikation 2, Abschnitt 6),
      // entscheidet #164; bis dahin ist dieser Fall offen.
      persistEntry(tx, dependencies, {
        entryId: newId(),
        personId: EntityId.parse(requireOwnPerson(tx).id),
        payload: undo.deleted,
        knownServerVersion: null,
        cause: 'rueckgaengig',
        now: Instant.parse(clock.read().instant),
      });
      return;
    }
  }
}

/** Schreibt Menge, Einheit und Mahlzeit samt neu gerechneter Summen und Outbox-Operation; prüft vor dem Schreiben. */
function writeChange(
  tx: TransactionContext,
  dependencies: EntryDependencies,
  entryId: EntityId,
  existing: StoredEntryContent,
  change: EntryChange,
  cause: DailyGoalCause,
): void {
  const { content } = existing;
  const amount = entryAmount(content.snapshot, change.displayUnit, change.displayAmountMilli);
  if (amount.type === 'problem') throw new InvalidNutritionInputError(`Ungültige Menge: ${amount.problem}`);
  const parsed = NutritionEntryUpsert.safeParse({ ...content, meal: change.meal, amount: amount.amount, totals: entryTotals(content.snapshot, amount.amount) });
  if (!parsed.success) throw new InvalidNutritionInputError(`Ungültiger Eintrag: ${parsed.error.message}`);
  persistEntry(tx, dependencies, {
    entryId,
    personId: existing.personId,
    payload: parsed.data,
    knownServerVersion: existing.serverVersion,
    cause,
    now: Instant.parse(dependencies.clock.read().instant),
  });
}

/** Eine Mutation: Zeile schreiben, genau eine Upsert-Operation in die Outbox und den Tag des Eintrags melden. */
function persistEntry(
  tx: TransactionContext,
  { writer, persistence }: Pick<EntryDependencies, 'writer' | 'persistence'>,
  entry: Readonly<{ entryId: EntityId; personId: EntityId; payload: NutritionEntryUpsert; knownServerVersion: ServerVersion | null; cause: DailyGoalCause; now: Instant }>,
): void {
  const { entryId, personId, payload, knownServerVersion, cause, now } = entry;
  writeEntry(tx, entryId, personId, payload, now);
  writer.upsert(tx, { entityType: nutritionEntryEntity.entityType, entityId: entryId, payload, knownServerVersion });
  persistence.reevaluateDailyGoals(tx, personId, [payload.localDate], cause);
}

/** Ein nicht gelöschter Eintrag der eigenen Person; sonst `InvalidNutritionInputError`. */
function requireLiving(tx: TransactionContext, entryId: EntityId): StoredEntryContent {
  const existing = readEntryContent(tx, entryId);
  if (existing === undefined || existing.deletedAt !== null || existing.personId !== requireOwnPerson(tx).id) {
    throw new InvalidNutritionInputError(`Eintrag ${entryId} ist unbekannt, gelöscht oder nicht der eigene`);
  }
  return existing;
}
