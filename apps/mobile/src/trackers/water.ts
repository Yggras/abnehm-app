import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { isValidWaterAmount, waterOrigin } from '@abnehm/contracts/tracker-rules';
import { WaterEntryUpsert, type WaterAddedValues } from '@abnehm/contracts/trackers';

import type { TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { waterEntryEntity } from './water-entity';
import { readWaterEntry, tombstoneWaterEntry, writeWaterEntry } from './water-repository';
import type { TrackerDependencies } from './trackers';

// Wasser-Befehle des Tracker-Moduls (Spezifikation 3, Abschnitt 4). Sie laufen in der Transaktion
// des Aufrufers: Fachänderung, Outbox-Operation und `reevaluateDailyGoals` entstehen gemeinsam.

/** Eine Eingabe verletzt die Tracker-Regeln; es wurde nichts geschrieben. */
export class InvalidTrackerInputError extends Error {
  override name = 'InvalidTrackerInputError';
}

/** Was „Rückgängig“ nach einer Wasserbuchung braucht; flüchtig und nie synchronisiert. */
export type WaterUndo = Readonly<{ type: 'water_added'; entryId: EntityId }>;

export type WaterAdded = Readonly<{ messageKey: 'wasser.hinzugefuegt'; values: WaterAddedValues; undo: WaterUndo }>;

type Dependencies = Pick<TrackerDependencies, 'clock' | 'writer' | 'persistence' | 'newId'>;

/** Bucht Wasser jetzt. Lokaler Tag, Zone und Offset stammen aus derselben Ablesung der Uhr. */
export function addWaterEntry(tx: TransactionContext, { clock, writer, persistence, newId }: Dependencies, ml: number): WaterAdded {
  // Vor dem ersten Schreibzugriff: Eine ungültige Menge hinterlässt nichts.
  if (!isValidWaterAmount(ml)) throw new InvalidTrackerInputError(`Ungültige Wassermenge: ${ml} ml (erlaubt 1–3000 ml)`);
  const reading = clock.read();
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const entryId = newId();
  const payload = WaterEntryUpsert.parse({
    amountMl: ml,
    origin: waterOrigin,
    loggedAt: reading.instant,
    localDate: reading.localDate,
    timeZone: TimeZone.parse(reading.timeZone),
    utcOffsetMinutes: reading.utcOffsetMinutes,
  });
  writeWaterEntry(tx, entryId, personId, payload, Instant.parse(reading.instant));
  writer.upsert(tx, { entityType: waterEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: null });
  persistence.reevaluateDailyGoals(tx, personId, [LocalDate.parse(reading.localDate)], 'eingabe');
  return { messageKey: 'wasser.hinzugefuegt', values: { ml }, undo: { type: 'water_added', entryId } };
}

/**
 * Nimmt eine Wasserbuchung zurück: Der Eintrag wird gelöscht (Tombstone) und sein gespeicherter Tag
 * erneut gemeldet. Ist er schon gelöscht, etwa durch einen Pull, bleibt alles, wie es ist.
 */
export function undoWater(tx: TransactionContext, { clock, writer, persistence }: Dependencies, undo: WaterUndo): void {
  const entry = readWaterEntry(tx, undo.entryId);
  if (entry === undefined || entry.deletedAt !== null) return;
  tombstoneWaterEntry(tx, undo.entryId, Instant.parse(clock.read().instant));
  writer.delete(tx, { entityType: waterEntryEntity.entityType, entityId: undo.entryId, knownServerVersion: entry.serverVersion });
  persistence.reevaluateDailyGoals(tx, entry.personId, [entry.localDate], 'rueckgaengig');
}
