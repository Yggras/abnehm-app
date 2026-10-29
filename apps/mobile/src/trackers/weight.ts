import { readingOf } from '@abnehm/clock';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { isValidManualWeight } from '@abnehm/contracts/tracker-rules';
import { WeightEntryUpsert, type WeightRecordedValues } from '@abnehm/contracts/trackers';

import type { TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { InvalidTrackerInputError } from './invalid-input';
import type { TrackerDependencies } from './trackers';
import { weightEntryEntity } from './weight-entity';
import { readWeightEntry, tombstoneWeightEntry, writeWeightEntry } from './weight-repository';

// Gewichts-Befehle des Tracker-Moduls (Spezifikation 3, Abschnitte 3 und 4). Sie laufen in der
// Transaktion des Aufrufers: Gewichtseintrag, Outbox-Operation und `reevaluateDailyGoals` entstehen
// gemeinsam. Die Frage „Tippfehler?“ gehört zum Formular, nicht hierher.

/** Ein manueller Gewichtseintrag: Gewicht in g und Messzeitpunkt. */
export type WeightInput = Readonly<{ weightG: number; measuredAt: Instant }>;

/** Was „Rückgängig“ nach dem Eintragen braucht; flüchtig und nie synchronisiert. */
export type WeightUndo = Readonly<{ type: 'weight_recorded'; entryId: EntityId }>;

export type WeightRecorded = Readonly<{
  messageKey: 'gewicht.eingetragen';
  values: WeightRecordedValues;
  localDate: LocalDate;
  undo: WeightUndo;
}>;

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
export function recordWeightEntry(tx: TransactionContext, { clock, writer, persistence }: Dependencies, entryId: EntityId, { weightG, measuredAt }: WeightInput): WeightRecorded {
  if (!isValidManualWeight(weightG)) throw new InvalidTrackerInputError(`Ungültiges Gewicht: ${weightG} g (erlaubt 20,0–350,0 kg in 100-g-Schritten)`);
  const now = clock.read();
  if (Date.parse(measuredAt) > Date.parse(now.instant)) throw new InvalidTrackerInputError(`Messzeitpunkt ${measuredAt} liegt in der Zukunft`);
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const existing = readWeightEntry(tx, entryId);
  const measured = readingOf(measuredAt, existing?.timeZone ?? TimeZone.parse(now.timeZone));
  const payload = WeightEntryUpsert.parse({
    weightG,
    origin: 'manuell',
    measuredAt: measured.instant,
    localDate: measured.localDate,
    timeZone: measured.timeZone,
    utcOffsetMinutes: existing?.utcOffsetMinutes ?? measured.utcOffsetMinutes,
  });
  writeWeightEntry(tx, entryId, personId, payload, Instant.parse(now.instant));
  writer.upsert(tx, { entityType: weightEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: existing?.serverVersion ?? null });
  const localDate = LocalDate.parse(measured.localDate);
  const days = existing === undefined || existing.localDate === localDate ? [localDate] : [existing.localDate, localDate];
  persistence.reevaluateDailyGoals(tx, personId, days, 'eingabe');
  return { messageKey: 'gewicht.eingetragen', values: { weightG }, localDate, undo: { type: 'weight_recorded', entryId } };
}

/**
 * Nimmt das Eintragen zurück: Der Eintrag wird gelöscht (Tombstone) und sein gespeicherter Tag erneut
 * gemeldet. Ist er schon gelöscht, etwa durch einen Pull, bleibt alles, wie es ist.
 */
export function undoWeight(tx: TransactionContext, { clock, writer, persistence }: Dependencies, undo: WeightUndo): void {
  const entry = readWeightEntry(tx, undo.entryId);
  if (entry === undefined || entry.deletedAt !== null) return;
  tombstoneWeightEntry(tx, undo.entryId, Instant.parse(clock.read().instant));
  writer.delete(tx, { entityType: weightEntryEntity.entityType, entityId: undo.entryId, knownServerVersion: entry.serverVersion });
  persistence.reevaluateDailyGoals(tx, entry.personId, [entry.localDate], 'rueckgaengig');
}
