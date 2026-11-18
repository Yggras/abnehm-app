import type { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
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
import { daysReplacedBy, readImportedSport, writeSportEntry } from './sport-repository';
import type { StoredImport } from './stored-import';
import type { TrackerDependencies } from './trackers';
import { weightEntryEntity } from './weight-entity';
import { readImportedWeight, writeWeightEntry } from './weight-repository';

// Befehle für importierte Einträge (Spezifikation 3, Abschnitte 3, 4 und 6; #186). Ihre Werte sind
// schreibgeschützt und werden in der Quell-App korrigiert. Die Person kann einen Import nur ausblenden
// (Training und Gewicht) und die Aktivitätsart eines Trainings überschreiben. Beides schreibt die volle
// Import-Nutzlast samt Outbox-Operation und meldet den Tag des Eintrags an `reevaluateDailyGoals`, in der
// Transaktion des Aufrufers; beim Training auch die Tage der manuellen Einträge, die es ersetzt. Der Importbefehl (`health-import.ts`) übernimmt `hidden_at` und die
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

/** Wie ein importierter Eintrag eines Typs geschrieben wird und welche Tage er beim Zählen berührt. */
type ImportKind<P extends { localDate: LocalDate }> = Readonly<{
  entityType: string;
  write(tx: TransactionContext, id: EntityId, personId: EntityId, payload: P, at: Instant): void;
  /** Die lokalen Tage, deren Zählen an diesem Eintrag hängt. */
  days(tx: TransactionContext, id: EntityId, payload: P): LocalDate[];
}>;

const sportKind: ImportKind<ImportedSportEntryUpsert> = {
  entityType: sportEntryEntity.entityType,
  write: writeSportEntry,
  // Ein ausgeblendeter ersetzender Import lässt seine ersetzten manuellen Einträge wieder zählen, auch am Nachbartag.
  days: (tx, id, payload) => [...new Set([payload.localDate, ...daysReplacedBy(tx, id)])],
};

const weightKind: ImportKind<ImportedWeightEntryUpsert> = {
  entityType: weightEntryEntity.entityType,
  write: writeWeightEntry,
  days: (_tx, _id, payload) => [payload.localDate],
};

/** Ein importierter Eintrag zur ID, auch gelöscht oder ausgeblendet; `undefined` für einen unbekannten oder manuellen. */
type Imported =
  | Readonly<{ type: 'training'; stored: StoredImport<ImportedSportEntryUpsert> }>
  | Readonly<{ type: 'gewicht'; stored: StoredImport<ImportedWeightEntryUpsert> }>;

function readImported(tx: TransactionContext, entryId: EntityId): Imported | undefined {
  const sport = readImportedSport(tx, entryId);
  if (sport !== undefined) return { type: 'training', stored: sport };
  const weight = readImportedWeight(tx, entryId);
  return weight === undefined ? undefined : { type: 'gewicht', stored: weight };
}

/**
 * Blendet einen importierten Eintrag aus, ohne Bestätigungsdialog: `hidden_at` wird gesetzt, der Eintrag
 * zählt nicht mehr und verschwindet aus allen Listen und Summen. Wirft `InvalidTrackerInputError`, ohne zu
 * schreiben, für einen unbekannten, manuellen, gelöschten oder schon ausgeblendeten Eintrag.
 */
export function hideImportedEntry(tx: TransactionContext, dependencies: Dependencies, entryId: EntityId): ImportHidden {
  const hiddenAt = dependencies.clock.read().instant;
  const undo: ImportedUndo = { type: 'import_hidden', entryId };
  const imported = readImported(tx, entryId);
  if (imported === undefined) throw new InvalidTrackerInputError(`Eintrag ${entryId} ist kein importierter Eintrag`);
  requireVisible(imported.stored, entryId);
  if (imported.type === 'training') {
    const { stored } = imported;
    rewrite(tx, dependencies, sportKind, entryId, stored, { ...stored.payload, hiddenAt }, 'eingabe');
    return { messageKey: 'sport.ausgeblendet', values: sportValues(stored.payload), undo };
  }
  const { stored } = imported;
  rewrite(tx, dependencies, weightKind, entryId, stored, { ...stored.payload, hiddenAt }, 'eingabe');
  return { messageKey: 'gewicht.ausgeblendet', values: { weightG: stored.payload.weightG }, undo };
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
  rewrite(tx, dependencies, sportKind, entryId, sport, { ...sport.payload, overrideActivityType: activityType }, 'eingabe');
  return {
    messageKey: 'sport.art_geaendert',
    values: { activityType, previousActivityType: sportValues(sport.payload).activityType },
    undo: { type: 'activity_type_overridden', entryId, previous: sport.payload.overrideActivityType },
  };
}

/**
 * Nimmt einen Befehl für importierte Einträge zurück und meldet die Tage mit `rueckgaengig` (Spezifikation 3,
 * Abschnitt 4): Ausblenden entfernt `hidden_at`, „Aktivitätsart ändern“ stellt die vorher überschriebene Art
 * wieder her (beim ersten Ändern keine, also die erkannte). Hat die Quelle den Eintrag inzwischen gelöscht oder
 * ist schon nichts mehr zu tun, bleibt alles, wie es ist.
 */
export function undoImported(tx: TransactionContext, dependencies: Dependencies, undo: ImportedUndo): void {
  const imported = readImported(tx, undo.entryId);
  if (imported === undefined || imported.stored.deletedAt !== null) return;
  if (imported.type === 'training') {
    const { stored } = imported;
    if (undo.type === 'activity_type_overridden') {
      if (stored.payload.overrideActivityType !== undo.previous) {
        rewrite(tx, dependencies, sportKind, undo.entryId, stored, { ...stored.payload, overrideActivityType: undo.previous }, 'rueckgaengig');
      }
    } else if (stored.payload.hiddenAt !== null) {
      rewrite(tx, dependencies, sportKind, undo.entryId, stored, { ...stored.payload, hiddenAt: null }, 'rueckgaengig');
    }
    return;
  }
  const { stored } = imported;
  if (undo.type === 'import_hidden' && stored.payload.hiddenAt !== null) {
    rewrite(tx, dependencies, weightKind, undo.entryId, stored, { ...stored.payload, hiddenAt: null }, 'rueckgaengig');
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

/**
 * Schreibt die volle Import-Nutzlast samt Outbox-Operation und meldet die berührten Tage. Die Tage ersetzter
 * Einträge liest es nach dem Schreiben; der Verweis „ersetzt durch“ ändert sich dabei nicht.
 */
function rewrite<P extends { localDate: LocalDate }>(
  tx: TransactionContext,
  { clock, writer, persistence }: Dependencies,
  kind: ImportKind<P>,
  entryId: EntityId,
  stored: StoredImport<P>,
  payload: P,
  cause: DailyGoalCause,
): void {
  kind.write(tx, entryId, stored.personId, payload, clock.read().instant);
  writer.upsert(tx, { entityType: kind.entityType, entityId: entryId, payload, knownServerVersion: stored.serverVersion });
  persistence.reevaluateDailyGoals(tx, stored.personId, kind.days(tx, entryId, payload), cause);
}
