import { z } from 'zod';

import { readingOf } from '@abnehm/clock';
import { EntityId, type Instant, type LocalDate } from '@abnehm/contracts/base';
import {
  activityTypes,
  isInFuture,
  isValidManualSportMilliKcal,
  isValidManualSportMinutes,
  manualOrigin,
  manualSportMilliKcal,
  manualSportMinutes,
} from '@abnehm/contracts/tracker-rules';
import { ActivityType, ManualSportMinutes, SportEntryUpsert, type SportRecordedValues } from '@abnehm/contracts/trackers';

import type { ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import { readOwnPerson, requireOwnPerson } from '../local-db/person-header';
import { InvalidTrackerInputError } from './invalid-input';
import { sportEntryEntity } from './sport-entity';
import { readSportEntry, tombstoneSportEntry, writeSportEntry } from './sport-repository';
import type { TrackerDependencies } from './trackers';

// Sport-Befehle des Tracker-Moduls (Spezifikation 3, Abschnitte 3 und 4). Sie laufen in der Transaktion
// des Aufrufers: Sporteintrag, Outbox-Operation, `reevaluateDailyGoals` und die zuletzt genutzte Einheit
// entstehen gemeinsam. Es gibt keine Intensität; Kalorien werden nur angezeigt und nie auf das
// Kalorienbudget gutgeschrieben (#14, #38).

/** Eine manuelle Einheit: Art, Dauer in Minuten, Beginn und optionale aktive Kalorien in `milli_kcal`. */
export type SportInput = Readonly<{ activityType: ActivityType; durationMinutes: number; startedAt: Instant; activeMilliKcal: number | null }>;

/** Zuletzt genutzte Art und Dauer: Vorbelegung des Formulars, nur auf diesem Gerät. */
export type LastSport = Readonly<{ activityType: ActivityType; durationMinutes: number }>;

/** Was „Rückgängig“ nach dem Eintragen braucht; flüchtig und nie synchronisiert. */
export type SportUndo = Readonly<{ type: 'sport_recorded'; entryId: EntityId }>;

export type SportRecorded = Readonly<{ messageKey: 'sport.eingetragen'; values: SportRecordedValues; localDate: LocalDate; undo: SportUndo }>;

type Dependencies = Pick<TrackerDependencies, 'clock' | 'writer' | 'persistence'>;

/**
 * Legt eine manuelle Einheit unter `entryId` an. Lokaler Tag, Zone und Offset gehören zum Beginn in der
 * Zone der Uhr. Wirft `InvalidTrackerInputError` vor dem ersten Schreibzugriff, wenn Art, Dauer (1–600
 * Minuten) oder Kalorien (0–5000 kcal) ungültig sind oder der Beginn in der Zukunft liegt.
 */
export function recordSportEntry(tx: TransactionContext, { clock, writer, persistence }: Dependencies, entryId: EntityId, input: SportInput): SportRecorded {
  const { activityType, durationMinutes, startedAt, activeMilliKcal } = input;
  if (!(activityTypes as readonly string[]).includes(activityType)) throw new InvalidTrackerInputError(`Unbekannte Aktivitätsart: ${activityType}`);
  if (!isValidManualSportMinutes(durationMinutes)) {
    throw new InvalidTrackerInputError(`Ungültige Dauer: ${durationMinutes} min (erlaubt ${manualSportMinutes.min}–${manualSportMinutes.max} min)`);
  }
  if (!isValidManualSportMilliKcal(activeMilliKcal)) {
    throw new InvalidTrackerInputError(`Ungültige Kalorien: ${activeMilliKcal} milli_kcal (erlaubt ${manualSportMilliKcal.min}–${manualSportMilliKcal.max})`);
  }
  const now = clock.read();
  if (isInFuture(startedAt, now.instant)) throw new InvalidTrackerInputError(`Beginn ${startedAt} liegt in der Zukunft`);
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const started = readingOf(startedAt, now.timeZone);
  const payload = SportEntryUpsert.parse({
    activityType,
    startedAt: started.instant,
    durationMinutes,
    activeMilliKcal,
    origin: manualOrigin,
    replacedByEntryId: null,
    reactivatedAt: null,
    localDate: started.localDate,
    timeZone: started.timeZone,
    utcOffsetMinutes: started.utcOffsetMinutes,
  });
  writeSportEntry(tx, entryId, personId, payload, now.instant);
  writer.upsert(tx, { entityType: sportEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: null });
  persistence.reevaluateDailyGoals(tx, personId, [started.localDate], 'eingabe');
  writeDeviceState(tx, lastSportKey, { activityType, durationMinutes } satisfies LastSport, now.instant);
  return { messageKey: 'sport.eingetragen', values: { activityType, durationMinutes }, localDate: started.localDate, undo: { type: 'sport_recorded', entryId } };
}

/**
 * Nimmt das Eintragen zurück: Der Eintrag wird gelöscht (Tombstone) und sein gespeicherter Tag erneut
 * gemeldet. Ist er schon gelöscht, etwa durch einen Pull, bleibt alles, wie es ist. Die zuletzt genutzte
 * Einheit bleibt; sie ist nur eine Vorbelegung.
 */
export function undoSport(tx: TransactionContext, { clock, writer, persistence }: Dependencies, undo: SportUndo): void {
  const entry = readSportEntry(tx, undo.entryId);
  if (entry === undefined || entry.deletedAt !== null) return;
  tombstoneSportEntry(tx, undo.entryId, clock.read().instant);
  writer.delete(tx, { entityType: sportEntryEntity.entityType, entityId: undo.entryId, knownServerVersion: entry.serverVersion });
  persistence.reevaluateDailyGoals(tx, entry.personId, [entry.localDate], 'rueckgaengig');
}

// Zuletzt genutzte Art und Dauer sind lokaler Gerätezustand (`device_state`, Spezifikation 3, Abschnitt 8):
// nicht synchronisiert und beim Abmelden mit der Kontodatenbank gelöscht.
const lastSportKey = 'sport_last_used';
const LastSportValue = z.strictObject({ activityType: ActivityType, durationMinutes: ManualSportMinutes });

/** Die zuletzt genutzte Einheit dieses Geräts; ohne eigene Person, ohne Einheit oder bei unpassendem Wert `null`. */
export function lastSportOf(tx: ReadContext): LastSport | null {
  if (readOwnPerson(tx) === undefined) return null;
  return LastSportValue.safeParse(readDeviceState(tx, lastSportKey)).data ?? null;
}
