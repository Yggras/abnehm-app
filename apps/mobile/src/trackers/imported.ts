import type { EntityId } from '@abnehm/contracts/base';
import type { DailyGoalCause } from '@abnehm/contracts/daily-goals';
import { activityTypes } from '@abnehm/contracts/tracker-rules';
import type {
  ActivityType,
  ActivityTypeOverriddenValues,
  ImportedSportEntryUpsert,
  ImportedSportMessageValues,
  ImportedWeightEntryUpsert,
  ImportedWeightMessageValues,
} from '@abnehm/contracts/trackers';

import type { TransactionContext } from '../local-db';
import { InvalidTrackerInputError } from './invalid-input';
import { sportEntryEntity } from './sport-entity';
import { readImportedSport, writeSportEntry } from './sport-repository';
import type { StoredImport } from './stored-import';
import type { TrackerDependencies } from './trackers';
import { weightEntryEntity } from './weight-entity';
import { readImportedWeight, writeWeightEntry } from './weight-repository';

// Befehle für importierte Einträge (Spezifikation 3, Abschnitte 3, 4 und 6; #186). Ihre Werte sind
// schreibgeschützt und werden in der Quell-App korrigiert. Die Person kann einen Import nur ausblenden
// (Training und Gewicht) und die Aktivitätsart eines Trainings überschreiben. Beides schreibt die volle
// Import-Nutzlast samt Outbox-Operation und meldet den Tag des Eintrags an `reevaluateDailyGoals`, in der
// Transaktion des Aufrufers. Der Importbefehl (`health-import.ts`) übernimmt `hidden_at` und die
// überschriebene Art bei jedem Upsert, deshalb überdauern beide spätere Quelländerungen. Ob ein ersetzter
// manueller Eintrag nach dem Ausblenden seines Imports wieder zählt, berechnen die Tracker-Regeln beim Zählen.

/** Was „Rückgängig“ braucht; flüchtig und nie synchronisiert. */
export type ImportedUndo =
  | Readonly<{ type: 'import_hidden'; entryId: EntityId }>
  | Readonly<{ type: 'activity_type_overridden'; entryId: EntityId; previous: ActivityType | null }>;

/** Ergebnis von `hideImportedEntry` in der Transaktion: Meldung je nach Eintrag, Werte und Undo. */
export type ImportHidden = Readonly<
  | { messageKey: 'sport.ausgeblendet'; values: ImportedSportMessageValues; undo: ImportedUndo }
  | { messageKey: 'gewicht.ausgeblendet'; values: ImportedWeightMessageValues; undo: ImportedUndo }
>;

/** Ergebnis von `overrideImportedActivityType` in der Transaktion. */
export type ActivityTypeOverridden = Readonly<{ messageKey: 'sport.art_geaendert'; values: ActivityTypeOverriddenValues; undo: ImportedUndo }>;

type Dependencies = Pick<TrackerDependencies, 'clock' | 'writer' | 'persistence'>;

/**
 * Blendet einen importierten Eintrag aus, ohne Bestätigungsdialog: `hidden_at` wird gesetzt, der Eintrag
 * zählt nicht mehr und verschwindet aus allen Listen und Summen. Wirft `InvalidTrackerInputError`, ohne zu
 * schreiben, für einen unbekannten, manuellen, gelöschten oder schon ausgeblendeten Eintrag.
 */
export function hideImportedEntry(tx: TransactionContext, dependencies: Dependencies, entryId: EntityId): ImportHidden {
  const hiddenAt = dependencies.clock.read().instant;
  const undo: ImportedUndo = { type: 'import_hidden', entryId };
  const sport = readImportedSport(tx, entryId);
  if (sport !== undefined) {
    requireVisible(sport, entryId);
    rewriteSport(tx, dependencies, entryId, sport, { ...sport.payload, hiddenAt }, 'eingabe');
    return { messageKey: 'sport.ausgeblendet', values: sportValues(sport.payload), undo };
  }
  const weight = readImportedWeight(tx, entryId);
  if (weight !== undefined) {
    requireVisible(weight, entryId);
    rewriteWeight(tx, dependencies, entryId, weight, { ...weight.payload, hiddenAt }, 'eingabe');
    return { messageKey: 'gewicht.ausgeblendet', values: { weightG: weight.payload.weightG }, undo };
  }
  throw new InvalidTrackerInputError(`Eintrag ${entryId} ist kein importierter Eintrag`);
}

/**
 * Überschreibt die Aktivitätsart eines importierten Trainings, etwa wenn die Plattform ein Krafttraining als
 * Radfahren erkannt hat. Angezeigt wird danach die überschriebene vor der Plattformart. Wirft
 * `InvalidTrackerInputError`, ohne zu schreiben, für eine unbekannte Art und für einen Eintrag, der kein
 * sichtbares importiertes Training ist.
 */
export function overrideImportedActivityType(
  tx: TransactionContext,
  dependencies: Dependencies,
  entryId: EntityId,
  activityType: ActivityType,
): ActivityTypeOverridden {
  if (!(activityTypes as readonly string[]).includes(activityType)) throw new InvalidTrackerInputError(`Unbekannte Aktivitätsart: ${activityType}`);
  const sport = readImportedSport(tx, entryId);
  if (sport === undefined) throw new InvalidTrackerInputError(`Eintrag ${entryId} ist kein importiertes Training`);
  requireVisible(sport, entryId);
  const payload = { ...sport.payload, overrideActivityType: activityType };
  rewriteSport(tx, dependencies, entryId, sport, payload, 'eingabe');
  return {
    messageKey: 'sport.art_geaendert',
    values: { activityType, previousActivityType: sportValues(sport.payload).activityType },
    undo: { type: 'activity_type_overridden', entryId, previous: sport.payload.overrideActivityType },
  };
}

/**
 * Nimmt einen Befehl für importierte Einträge zurück und meldet den Tag mit `rueckgaengig` (Spezifikation 3,
 * Abschnitt 4): Ausblenden entfernt `hidden_at`, Umbenennen stellt die vorher überschriebene Art wieder her
 * (beim ersten Umbenennen keine, also die erkannte). Hat die Quelle den Eintrag inzwischen gelöscht oder ist
 * schon nichts mehr zu tun, bleibt alles, wie es ist.
 */
export function undoImported(tx: TransactionContext, dependencies: Dependencies, undo: ImportedUndo): void {
  const sport = readImportedSport(tx, undo.entryId);
  if (undo.type === 'activity_type_overridden') {
    if (sport === undefined || sport.deletedAt !== null || sport.payload.overrideActivityType === undo.previous) return;
    rewriteSport(tx, dependencies, undo.entryId, sport, { ...sport.payload, overrideActivityType: undo.previous }, 'rueckgaengig');
    return;
  }
  if (sport !== undefined) {
    if (sport.deletedAt === null && sport.payload.hiddenAt !== null) rewriteSport(tx, dependencies, undo.entryId, sport, { ...sport.payload, hiddenAt: null }, 'rueckgaengig');
    return;
  }
  const weight = readImportedWeight(tx, undo.entryId);
  if (weight !== undefined && weight.deletedAt === null && weight.payload.hiddenAt !== null) {
    rewriteWeight(tx, dependencies, undo.entryId, weight, { ...weight.payload, hiddenAt: null }, 'rueckgaengig');
  }
}

/** Ein nicht gelöschter, nicht ausgeblendeter Import; sonst `InvalidTrackerInputError`. */
function requireVisible(stored: StoredImport<{ hiddenAt: string | null }>, entryId: EntityId): void {
  if (stored.deletedAt !== null) throw new InvalidTrackerInputError(`Import ${entryId} ist gelöscht`);
  if (stored.payload.hiddenAt !== null) throw new InvalidTrackerInputError(`Import ${entryId} ist schon ausgeblendet`);
}

/** Angezeigte Art (überschriebene vor Plattformart) und Dauer eines Trainings. */
function sportValues({ overrideActivityType, activityType, durationMinutes }: ImportedSportEntryUpsert): ImportedSportMessageValues {
  return { activityType: overrideActivityType ?? activityType, durationMinutes };
}

function rewriteSport(
  tx: TransactionContext,
  { clock, writer, persistence }: Dependencies,
  entryId: EntityId,
  stored: StoredImport<ImportedSportEntryUpsert>,
  payload: ImportedSportEntryUpsert,
  cause: DailyGoalCause,
): void {
  writeSportEntry(tx, entryId, stored.personId, payload, clock.read().instant);
  writer.upsert(tx, { entityType: sportEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: stored.serverVersion });
  persistence.reevaluateDailyGoals(tx, stored.personId, [payload.localDate], cause);
}

function rewriteWeight(
  tx: TransactionContext,
  { clock, writer, persistence }: Dependencies,
  entryId: EntityId,
  stored: StoredImport<ImportedWeightEntryUpsert>,
  payload: ImportedWeightEntryUpsert,
  cause: DailyGoalCause,
): void {
  writeWeightEntry(tx, entryId, stored.personId, payload, clock.read().instant);
  writer.upsert(tx, { entityType: weightEntryEntity.entityType, entityId: entryId, payload, knownServerVersion: stored.serverVersion });
  persistence.reevaluateDailyGoals(tx, stored.personId, [payload.localDate], cause);
}
