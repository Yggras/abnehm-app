import { readingOf } from '@abnehm/clock';
import { EntityId, type Instant, type LocalDate } from '@abnehm/contracts/base';
import type { DailyGoalCause } from '@abnehm/contracts/daily-goals';
import {
  dayWeights,
  isInFuture,
  isValidManualWeight,
  lastWeightG,
  manualOrigin,
  manualWeightG,
  weightTrend,
  type DayWeight,
  type TrendPoint,
} from '@abnehm/contracts/tracker-rules';
import { WeightEntryUpsert, type WeightMessageValues } from '@abnehm/contracts/trackers';

import type { ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson, requireOwnPerson } from '../local-db/person-header';
import { InvalidTrackerInputError } from './invalid-input';
import type { TrackerDependencies } from './trackers';
import { weightEntryEntity } from './weight-entity';
import { readWeightEntry, tombstoneWeightEntry, weightEntriesOf, writeWeightEntry, type StoredWeightEntry } from './weight-repository';

// Gewichts-Befehle des Tracker-Moduls (Spezifikation 3, Abschnitte 3 und 4). Sie laufen in der
// Transaktion des Aufrufers: Fachänderung, Outbox-Operation und `reevaluateDailyGoals` für alle
// betroffenen Tage entstehen gemeinsam. Bearbeiten und Löschen gibt es nur für manuelle Einträge;
// importierte ändert die Person in der Quell-App. Die Frage „Tippfehler?“ gehört zum Formular.

/** Ein manueller Gewichtseintrag: Gewicht in g und Messzeitpunkt. */
export type WeightInput = Readonly<{ weightG: number; measuredAt: Instant }>;

/** Fachliche Werte eines gelöschten Eintrags, aus denen „Rückgängig“ einen neuen anlegt. */
type DeletedWeight = Readonly<Pick<StoredWeightEntry, 'weightG' | 'measuredAt' | 'localDate' | 'timeZone' | 'utcOffsetMinutes'>>;

/** Was „Rückgängig“ braucht; flüchtig und nie synchronisiert. */
export type WeightUndo =
  | Readonly<{ type: 'weight_recorded'; entryId: EntityId }>
  | Readonly<{ type: 'weight_updated'; entryId: EntityId; previous: WeightInput }>
  | Readonly<{ type: 'weight_deleted'; deleted: DeletedWeight }>;

/** Ergebnis eines Gewichtsbefehls in der Transaktion: Meldung, Werte, gemeldeter Tag und Undo. */
export type WeightChanged<K extends string> = Readonly<{ messageKey: K; values: WeightMessageValues; localDate: LocalDate; undo: WeightUndo }>;
export type WeightRecorded = WeightChanged<'gewicht.eingetragen'>;

type Dependencies = Pick<TrackerDependencies, 'clock' | 'writer' | 'persistence'>;

/**
 * Legt einen manuellen Gewichtseintrag unter `entryId` an oder aktualisiert ihn (Last-Write-Wins).
 * Ein neuer Eintrag bekommt lokalen Tag, Zone und Offset des Messzeitpunkts in der Zone der Uhr. Ein
 * vorhandener behält Zone und Offset der Anlage; sein Tag folgt dem Messzeitpunkt in dieser Zone
 * (Spezifikation 3, Abschnitt 4). Gemeldet werden der alte und der neue Tag. Wirft
 * `InvalidTrackerInputError` vor dem ersten Schreibzugriff, wenn das Gewicht nicht 20,0–350,0 kg in
 * 100-g-Schritten ist oder der Messzeitpunkt in der Zukunft liegt. Einen gelöschten Eintrag übergibt
 * der Aufrufer nicht; Löschen ist endgültig (Spezifikation 0, Abschnitt 10).
 */
export function recordWeightEntry(tx: TransactionContext, dependencies: Dependencies, entryId: EntityId, input: WeightInput): WeightRecorded {
  const localDate = writeManualWeight(tx, dependencies, entryId, input, 'eingabe');
  return { messageKey: 'gewicht.eingetragen', values: { weightG: input.weightG }, localDate, undo: { type: 'weight_recorded', entryId } };
}

/**
 * Ändert Wert und Messzeitpunkt eines manuellen Eintrags (Spezifikation 3, Abschnitt 4) und meldet den
 * alten und den neuen Tag. Zone und Offset bleiben die der Anlage. Wirft `InvalidTrackerInputError`, ohne
 * zu schreiben, für ungültige Werte wie `recordWeightEntry` und für einen unbekannten, gelöschten oder
 * importierten Eintrag.
 */
export function updateWeightEntry(tx: TransactionContext, dependencies: Dependencies, entryId: EntityId, input: WeightInput): WeightChanged<'gewicht.geaendert'> {
  const existing = requireEditable(tx, entryId);
  const localDate = writeManualWeight(tx, dependencies, entryId, input, 'eingabe');
  return {
    messageKey: 'gewicht.geaendert',
    values: { weightG: input.weightG },
    localDate,
    undo: { type: 'weight_updated', entryId, previous: { weightG: existing.weightG, measuredAt: existing.measuredAt } },
  };
}

/**
 * Löscht einen manuellen Eintrag als Tombstone (Spezifikation 3, Abschnitt 4), ohne Bestätigungsdialog,
 * und meldet seinen Tag. Wirft `InvalidTrackerInputError`, ohne zu schreiben, für einen unbekannten,
 * schon gelöschten oder importierten Eintrag; importierte blendet die Person aus (#186).
 */
export function deleteWeightEntry(tx: TransactionContext, { clock, writer, persistence }: Dependencies, entryId: EntityId): WeightChanged<'gewicht.geloescht'> {
  const existing = requireEditable(tx, entryId);
  tombstoneWeightEntry(tx, entryId, clock.read().instant);
  writer.delete(tx, { entityType: weightEntryEntity.entityType, entityId: entryId, knownServerVersion: existing.serverVersion });
  persistence.reevaluateDailyGoals(tx, existing.personId, [existing.localDate], 'eingabe');
  const { weightG, measuredAt, localDate, timeZone, utcOffsetMinutes } = existing;
  return {
    messageKey: 'gewicht.geloescht',
    values: { weightG },
    localDate,
    undo: { type: 'weight_deleted', deleted: { weightG, measuredAt, localDate, timeZone, utcOffsetMinutes } },
  };
}

/** Letztes Gewicht (zuletzt gemessene zählende Messung) und letztes Tagesgewicht samt seinem Tag. */
export type LastWeights = Readonly<{ weightG: number; dayWeight: DayWeight }>;

/**
 * Nach den Tracker-Regeln, in einer Lesung; ohne eigene Person (vor dem ersten Pull) oder Messung `null`.
 * `except` lässt eine Messung aus, etwa die gerade bearbeitete: Ihr Formular vergleicht für „Tippfehler?“
 * mit dem letzten Tagesgewicht der übrigen Messungen.
 */
export function lastWeightsOf(tx: ReadContext, except?: EntityId): LastWeights | null {
  const person = readOwnPerson(tx);
  if (person === undefined) return null;
  const entries = weightEntriesOf(tx, EntityId.parse(person.id)).filter((entry) => entry.id !== except);
  const weightG = lastWeightG(entries);
  const dayWeight = dayWeights(entries).at(-1);
  return weightG === null || dayWeight === undefined ? null : { weightG, dayWeight };
}

/** Gewichtstrend der Person nach jedem Tagesgewicht, aufsteigend; zählende Einträge, auch importierte. */
export function trendPointsOf(tx: ReadContext, personId: EntityId): TrendPoint[] {
  return weightTrend(dayWeights(weightEntriesOf(tx, personId)));
}

/**
 * Nimmt einen Gewichtsbefehl zurück und meldet die betroffenen Tage mit `rueckgaengig` (Spezifikation 3,
 * Abschnitt 4). Das Undo ist sync-sicher, weil Tombstones endgültig sind:
 * - Eintragen: Der Eintrag wird gelöscht.
 * - Bearbeiten: Die vorherigen Werte werden zurückgeschrieben (Last-Write-Wins).
 * - Löschen: Ein neuer Eintrag mit neuer ID und denselben fachlichen Werten entsteht, samt Zone und Offset.
 *
 * Ist der Eintrag inzwischen gelöscht, etwa durch einen Pull, bleibt beim Eintragen und Bearbeiten alles,
 * wie es ist.
 */
export function undoWeight(tx: TransactionContext, dependencies: Dependencies & Pick<TrackerDependencies, 'newId'>, undo: WeightUndo): void {
  const { clock, writer, persistence } = dependencies;
  switch (undo.type) {
    case 'weight_recorded': {
      const entry = readWeightEntry(tx, undo.entryId);
      if (entry === undefined || entry.deletedAt !== null) return;
      tombstoneWeightEntry(tx, undo.entryId, clock.read().instant);
      writer.delete(tx, { entityType: weightEntryEntity.entityType, entityId: undo.entryId, knownServerVersion: entry.serverVersion });
      persistence.reevaluateDailyGoals(tx, entry.personId, [entry.localDate], 'rueckgaengig');
      return;
    }
    case 'weight_updated': {
      const entry = readWeightEntry(tx, undo.entryId);
      if (entry === undefined || entry.deletedAt !== null) return;
      writeManualWeight(tx, dependencies, undo.entryId, undo.previous, 'rueckgaengig');
      return;
    }
    case 'weight_deleted': {
      const personId = EntityId.parse(requireOwnPerson(tx).id);
      const entryId = dependencies.newId();
      const payload = WeightEntryUpsert.parse({ ...undo.deleted, origin: manualOrigin });
      writeWeightEntry(tx, entryId, personId, payload, clock.read().instant);
      writer.upsert(tx, { entityType: weightEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: null });
      persistence.reevaluateDailyGoals(tx, personId, [payload.localDate], 'rueckgaengig');
      return;
    }
  }
}

/** Schreibt einen manuellen Eintrag samt Outbox-Operation und meldet alten und neuen Tag; liefert den neuen. */
function writeManualWeight(tx: TransactionContext, { clock, writer, persistence }: Dependencies, entryId: EntityId, { weightG, measuredAt }: WeightInput, cause: DailyGoalCause): LocalDate {
  if (!isValidManualWeight(weightG)) {
    throw new InvalidTrackerInputError(`Ungültiges Gewicht: ${weightG} g (erlaubt ${manualWeightG.min}–${manualWeightG.max} g in ${manualWeightG.step}-g-Schritten)`);
  }
  const now = clock.read();
  if (isInFuture(measuredAt, now.instant)) throw new InvalidTrackerInputError(`Messzeitpunkt ${measuredAt} liegt in der Zukunft`);
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const existing = readWeightEntry(tx, entryId);
  const measured = readingOf(measuredAt, existing?.timeZone ?? now.timeZone);
  const payload = WeightEntryUpsert.parse({
    weightG,
    origin: manualOrigin,
    measuredAt: measured.instant,
    localDate: measured.localDate,
    timeZone: measured.timeZone,
    utcOffsetMinutes: existing?.utcOffsetMinutes ?? measured.utcOffsetMinutes,
  });
  writeWeightEntry(tx, entryId, personId, payload, now.instant);
  writer.upsert(tx, { entityType: weightEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: existing?.serverVersion ?? null });
  const localDate = measured.localDate;
  const days = existing === undefined || existing.localDate === localDate ? [localDate] : [existing.localDate, localDate];
  persistence.reevaluateDailyGoals(tx, personId, days, cause);
  return localDate;
}

/** Ein nicht gelöschter manueller Eintrag; sonst `InvalidTrackerInputError`. */
function requireEditable(tx: ReadContext, entryId: EntityId): StoredWeightEntry {
  const existing = readWeightEntry(tx, entryId);
  if (existing === undefined || existing.deletedAt !== null || existing.origin !== manualOrigin) {
    throw new InvalidTrackerInputError(`Gewichtseintrag ${entryId} ist kein bearbeitbarer manueller Eintrag`);
  }
  return existing;
}
