import { z } from 'zod';

import { readingOf } from '@abnehm/clock';
import { EntityId, type Instant, type LocalDate } from '@abnehm/contracts/base';
import type { DailyGoalCause } from '@abnehm/contracts/daily-goals';
import {
  activityTypes,
  isInFuture,
  isValidManualSportMilliKcal,
  isValidManualSportMinutes,
  manualOrigin,
  manualSportMilliKcal,
  manualSportMinutes,
} from '@abnehm/contracts/tracker-rules';
import { ActivityType, ManualSportMinutes, SportEntryUpsert, type SportMessageValues } from '@abnehm/contracts/trackers';

import type { ReadContext, TransactionContext } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import { readOwnPerson, requireOwnPerson } from '../local-db/person-header';
import { InvalidTrackerInputError } from './invalid-input';
import { sportEntryEntity } from './sport-entity';
import { readSportEntry, tombstoneSportEntry, writeSportEntry, type StoredSportEntry } from './sport-repository';
import type { TrackerDependencies } from './trackers';

// Sport-Befehle des Tracker-Moduls (Spezifikation 3, Abschnitte 3 und 4). Sie laufen in der Transaktion
// des Aufrufers: Sporteintrag, Outbox-Operation, `reevaluateDailyGoals` für alle betroffenen Tage und beim
// Eintragen die zuletzt genutzte Einheit entstehen gemeinsam. Es gibt keine Intensität; Kalorien werden
// nur angezeigt und nie auf das Kalorienbudget gutgeschrieben (#14, #38). Bearbeiten und Löschen gibt es
// nur für manuelle Einträge; importierte ändert die Person in der Quell-App (#186).

/** Eine manuelle Einheit: Art, Dauer in Minuten, Beginn und optionale aktive Kalorien in `milli_kcal`. */
export type SportInput = Readonly<{ activityType: ActivityType; durationMinutes: number; startedAt: Instant; activeMilliKcal: number | null }>;

/** Zuletzt genutzte Art und Dauer: Vorbelegung des Formulars, nur auf diesem Gerät. */
export type LastSport = Readonly<{ activityType: ActivityType; durationMinutes: number }>;

/** Fachliche Werte eines gelöschten Eintrags, aus denen „Rückgängig“ einen neuen anlegt. */
type DeletedSport = Readonly<
  Pick<
    StoredSportEntry,
    'activityType' | 'startedAt' | 'durationMinutes' | 'activeMilliKcal' | 'replacedByEntryId' | 'reactivatedAt' | 'localDate' | 'timeZone' | 'utcOffsetMinutes'
  >
>;

/** Was „Rückgängig“ braucht; flüchtig und nie synchronisiert. */
export type SportUndo =
  | Readonly<{ type: 'sport_recorded'; entryId: EntityId }>
  | Readonly<{ type: 'sport_updated'; entryId: EntityId; previous: SportInput }>
  | Readonly<{ type: 'sport_deleted'; deleted: DeletedSport }>;

/** Ergebnis eines Sportbefehls in der Transaktion: Meldung, Werte, gemeldeter Tag und Undo. */
export type SportChanged<K extends string> = Readonly<{ messageKey: K; values: SportMessageValues; localDate: LocalDate; undo: SportUndo }>;
export type SportRecorded = SportChanged<'sport.eingetragen'>;

type Dependencies = Pick<TrackerDependencies, 'clock' | 'writer' | 'persistence'>;

/**
 * Legt eine manuelle Einheit unter `entryId` an. Lokaler Tag, Zone und Offset gehören zum Beginn in der
 * Zone der Uhr; Art und Dauer merkt sich das Gerät als Vorbelegung. Wirft `InvalidTrackerInputError` vor
 * dem ersten Schreibzugriff, wenn Art, Dauer (1–600 Minuten) oder Kalorien (0–5000 kcal) ungültig sind
 * oder der Beginn in der Zukunft liegt.
 */
export function recordSportEntry(tx: TransactionContext, dependencies: Dependencies, entryId: EntityId, input: SportInput): SportRecorded {
  const localDate = writeManualSport(tx, dependencies, entryId, input, 'eingabe');
  const { activityType, durationMinutes } = input;
  writeDeviceState(tx, lastSportKey, { activityType, durationMinutes } satisfies LastSport, dependencies.clock.read().instant);
  return { messageKey: 'sport.eingetragen', values: { activityType, durationMinutes }, localDate, undo: { type: 'sport_recorded', entryId } };
}

/**
 * Ändert Art, Dauer, Beginn und Kalorien einer manuellen Einheit (Spezifikation 3, Abschnitt 4) und meldet
 * den alten und den neuen Tag. Zone und Offset bleiben die der Anlage, ebenso Ersetzung und Reaktivierung;
 * die Überschneidung mit Importen prüft #185. Die zuletzt genutzte Einheit bleibt, sie gehört zum
 * Eintragen. Wirft `InvalidTrackerInputError`, ohne zu schreiben, für ungültige Werte wie
 * `recordSportEntry` und für einen unbekannten, gelöschten oder importierten Eintrag.
 */
export function updateSportEntry(tx: TransactionContext, dependencies: Dependencies, entryId: EntityId, input: SportInput): SportChanged<'sport.geaendert'> {
  const existing = requireEditable(tx, entryId);
  const localDate = writeManualSport(tx, dependencies, entryId, input, 'eingabe');
  const { activityType, durationMinutes, startedAt, activeMilliKcal } = existing;
  return {
    messageKey: 'sport.geaendert',
    values: { activityType: input.activityType, durationMinutes: input.durationMinutes },
    localDate,
    undo: { type: 'sport_updated', entryId, previous: { activityType, durationMinutes, startedAt, activeMilliKcal } },
  };
}

/**
 * Löscht eine manuelle Einheit als Tombstone (Spezifikation 3, Abschnitt 4), ohne Bestätigungsdialog, und
 * meldet ihren Tag. Wirft `InvalidTrackerInputError`, ohne zu schreiben, für einen unbekannten, schon
 * gelöschten oder importierten Eintrag; importierte blendet die Person aus (#186).
 */
export function deleteSportEntry(tx: TransactionContext, { clock, writer, persistence }: Dependencies, entryId: EntityId): SportChanged<'sport.geloescht'> {
  const existing = requireEditable(tx, entryId);
  tombstoneSportEntry(tx, entryId, clock.read().instant);
  writer.delete(tx, { entityType: sportEntryEntity.entityType, entityId: entryId, knownServerVersion: existing.serverVersion });
  persistence.reevaluateDailyGoals(tx, existing.personId, [existing.localDate], 'eingabe');
  const { activityType, startedAt, durationMinutes, activeMilliKcal, replacedByEntryId, reactivatedAt, localDate, timeZone, utcOffsetMinutes } = existing;
  return {
    messageKey: 'sport.geloescht',
    values: { activityType, durationMinutes },
    localDate,
    undo: {
      type: 'sport_deleted',
      deleted: { activityType, startedAt, durationMinutes, activeMilliKcal, replacedByEntryId, reactivatedAt, localDate, timeZone, utcOffsetMinutes },
    },
  };
}

/**
 * Nimmt einen Sportbefehl zurück und meldet die betroffenen Tage mit `rueckgaengig` (Spezifikation 3,
 * Abschnitt 4). Das Undo ist sync-sicher, weil Tombstones endgültig sind:
 * - Eintragen: Der Eintrag wird gelöscht. Die zuletzt genutzte Einheit bleibt; sie ist nur eine Vorbelegung.
 * - Bearbeiten: Die vorherigen Werte werden zurückgeschrieben (Last-Write-Wins).
 * - Löschen: Ein neuer Eintrag mit neuer ID und denselben fachlichen Werten entsteht, samt Tag, Zone und Offset.
 *
 * Ist der Eintrag inzwischen gelöscht, etwa durch einen Pull, bleibt beim Eintragen und Bearbeiten alles,
 * wie es ist.
 */
export function undoSport(tx: TransactionContext, dependencies: Dependencies & Pick<TrackerDependencies, 'newId'>, undo: SportUndo): void {
  const { clock, writer, persistence } = dependencies;
  switch (undo.type) {
    case 'sport_recorded': {
      const entry = readSportEntry(tx, undo.entryId);
      if (entry === undefined || entry.deletedAt !== null) return;
      tombstoneSportEntry(tx, undo.entryId, clock.read().instant);
      writer.delete(tx, { entityType: sportEntryEntity.entityType, entityId: undo.entryId, knownServerVersion: entry.serverVersion });
      persistence.reevaluateDailyGoals(tx, entry.personId, [entry.localDate], 'rueckgaengig');
      return;
    }
    case 'sport_updated': {
      const entry = readSportEntry(tx, undo.entryId);
      if (entry === undefined || entry.deletedAt !== null) return;
      writeManualSport(tx, dependencies, undo.entryId, undo.previous, 'rueckgaengig');
      return;
    }
    case 'sport_deleted': {
      const personId = EntityId.parse(requireOwnPerson(tx).id);
      const entryId = dependencies.newId();
      const payload = SportEntryUpsert.parse({ ...undo.deleted, origin: manualOrigin });
      writeSportEntry(tx, entryId, personId, payload, clock.read().instant);
      writer.upsert(tx, { entityType: sportEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: null });
      persistence.reevaluateDailyGoals(tx, personId, [payload.localDate], 'rueckgaengig');
      return;
    }
  }
}

/**
 * Schreibt eine manuelle Einheit samt Outbox-Operation und meldet alten und neuen Tag; liefert den neuen.
 * Eine neue Einheit bekommt Tag, Zone und Offset des Beginns in der Zone der Uhr. Eine vorhandene behält
 * Zone, Offset, Ersetzung und Reaktivierung; ihr Tag folgt dem Beginn in dieser Zone (Spezifikation 3,
 * Abschnitt 4). Prüft alle Werte vor dem ersten Schreibzugriff.
 */
function writeManualSport(tx: TransactionContext, { clock, writer, persistence }: Dependencies, entryId: EntityId, input: SportInput, cause: DailyGoalCause): LocalDate {
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
  const existing = readSportEntry(tx, entryId);
  const started = readingOf(startedAt, existing?.timeZone ?? now.timeZone);
  const payload = SportEntryUpsert.parse({
    activityType,
    startedAt: started.instant,
    durationMinutes,
    activeMilliKcal,
    origin: manualOrigin,
    replacedByEntryId: existing?.replacedByEntryId ?? null,
    reactivatedAt: existing?.reactivatedAt ?? null,
    localDate: started.localDate,
    timeZone: started.timeZone,
    utcOffsetMinutes: existing?.utcOffsetMinutes ?? started.utcOffsetMinutes,
  });
  writeSportEntry(tx, entryId, personId, payload, now.instant);
  writer.upsert(tx, { entityType: sportEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: existing?.serverVersion ?? null });
  const localDate = started.localDate;
  const days = existing === undefined || existing.localDate === localDate ? [localDate] : [existing.localDate, localDate];
  persistence.reevaluateDailyGoals(tx, personId, days, cause);
  return localDate;
}

/** Ein nicht gelöschter manueller Eintrag; sonst `InvalidTrackerInputError`. */
function requireEditable(tx: ReadContext, entryId: EntityId): StoredSportEntry {
  const existing = readSportEntry(tx, entryId);
  if (existing === undefined || existing.deletedAt !== null || existing.origin !== manualOrigin) {
    throw new InvalidTrackerInputError(`Sporteintrag ${entryId} ist kein bearbeitbarer manueller Eintrag`);
  }
  return existing;
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
