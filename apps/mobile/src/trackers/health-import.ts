import { readingOf, type ClockReading } from '@abnehm/clock';
import { EntityId, type TimeZone, UtcOffsetMinutes, type Instant, type LocalDate } from '@abnehm/contracts/base';
import { activityTypeOfPlatform, importedSportMinutes, isValidImportedWeight, localDateAtOffset } from '@abnehm/contracts/tracker-rules';
import { importedSportEntryId, importedWeightEntryId, SportEntryUpsert, WeightEntryUpsert, type ImportOrigin } from '@abnehm/contracts/trackers';

import type { HealthDataType, HealthRecordOf, HealthWeightRecord, HealthWorkoutRecord } from '../health/platform';
import type { TransactionContext } from '../local-db';
import { requireOwnPerson } from '../local-db/person-header';
import { sportEntryEntity } from './sport-entity';
import { importedSportKeys, readImportedSport, tombstoneSportEntry, writeSportEntry, type ImportedSportUpsert, type StoredImport } from './sport-repository';
import type { TrackerDependencies } from './trackers';
import { weightEntryEntity } from './weight-entity';
import { importedWeightKeys, readImportedWeight, tombstoneWeightEntry, writeWeightEntry, type ImportedWeightUpsert } from './weight-repository';

// Interner Importbefehl des Tracker-Moduls (Spezifikation 3, Abschnitte 2, 3 und 6; #183). Der
// Health-Import-Dienst schreibt ausschließlich hierüber, eine Transaktion je Stapel. Ein Stapel ist das
// Ergebnis einer Abfrage des Plattform-Adapters für einen Typ: Upserts, gelöschte externe Schlüssel und
// nach verfallenem Token der Abgleich eines Zeitraums. Annahme, Rundung und Abbildung der Aktivitätsarten
// stammen aus den Tracker-Regeln. Die Ersetzung manueller Sporteinträge ergänzt #185.

/** Ein Stapel des Health-Imports für einen Typ. */
export type HealthImportBatch<T extends HealthDataType = HealthDataType> = Readonly<{
  origin: ImportOrigin;
  type: T;
  upserts: readonly HealthRecordOf<T>[];
  /** In der Quelle gelöschte externe Schlüssel. */
  deletedKeys: readonly string[];
  /**
   * Abgleich nach verfallenem Token: Die Upserts sind dann alle Datensätze ab diesem Zeitpunkt, und lokale
   * Importe dieser Herkunft ab hier, die darunter fehlen, werden gelöscht. Sonst `null`.
   */
  reconcileSince: Instant | null;
  /**
   * Datensätze vor diesem Zeitpunkt werden nicht übernommen: Gewichte vor den letzten 30 Tagen, Trainings vor
   * dem Beginn des lokalen Tags der Verbindung (Spezifikation 3, Abschnitt 6 und „Out of Scope“).
   */
  notBefore: Instant;
}>;

/** Was ein Stapel bewirkt hat; die betroffenen lokalen Tage gingen an `reevaluateDailyGoals`. */
export type HealthImportResult = Readonly<{ upserted: number; deleted: number; skipped: number; localDates: readonly LocalDate[] }>;

type Dependencies = Pick<TrackerDependencies, 'clock' | 'writer' | 'persistence'>;

/** Was der Stapel je Typ über die Einträge wissen muss. */
type ImportKind<R, P extends { localDate: LocalDate }> = Readonly<{
  entityType: string;
  idOf(personId: EntityId, origin: ImportOrigin, externalKey: string): EntityId;
  read(tx: TransactionContext, id: EntityId): StoredImport<P> | undefined;
  at(record: R): Instant;
  /** Die Nutzlast des Imports oder `null`, wenn der Datensatz nach den Tracker-Regeln nicht übernommen wird. */
  payloadOf(record: R, origin: ImportOrigin, stored: P | undefined, now: ClockReading): P | null;
  write(tx: TransactionContext, id: EntityId, personId: EntityId, payload: P, at: Instant): void;
  tombstone(tx: TransactionContext, id: EntityId, at: Instant): void;
  keys(tx: TransactionContext, personId: EntityId, origin: ImportOrigin): { externalKey: string; at: string }[];
}>;

/**
 * Wendet den Stapel in der Transaktion des Aufrufers an und meldet alle betroffenen lokalen Tage (alter und
 * neuer Tag) mit `health_import` an `reevaluateDailyGoals`:
 * - Ein Upsert eines bekannten Schlüssels aktualisiert Beginn, Dauer, Kalorien, Gewicht, Messzeitpunkt und
 *   lokalen Tag; `hidden_at` und eine überschriebene Aktivitätsart bleiben. Ein gelöschter Eintrag bleibt
 *   gelöscht, weil Löschen gewinnt (Spezifikation 0). Unveränderte Datensätze schreiben nichts.
 * - Wird ein bekannter Datensatz nach den Tracker-Regeln nicht mehr übernommen, etwa weil seine Dauer unter
 *   60 Sekunden gefallen ist, wird der Import gelöscht, damit kein veralteter Wert zählt.
 * - Eine Löschung in der Quelle löscht den Import.
 */
export function applyHealthImport(tx: TransactionContext, dependencies: Dependencies, batch: HealthImportBatch): HealthImportResult {
  return batch.type === 'workout'
    ? applyBatch(tx, dependencies, batch as HealthImportBatch<'workout'>, workoutKind)
    : applyBatch(tx, dependencies, batch as HealthImportBatch<'weight'>, weightKind);
}

function applyBatch<T extends HealthDataType, P extends { localDate: LocalDate }>(
  tx: TransactionContext,
  { clock, writer, persistence }: Dependencies,
  batch: HealthImportBatch<T>,
  kind: ImportKind<HealthRecordOf<T>, P>,
): HealthImportResult {
  const now = clock.read();
  const personId = EntityId.parse(requireOwnPerson(tx).id);
  const days = new Set<LocalDate>();
  let upserted = 0;
  let deleted = 0;
  let skipped = 0;

  const remove = (id: EntityId) => {
    const stored = kind.read(tx, id);
    if (stored === undefined || stored.deletedAt !== null) return;
    kind.tombstone(tx, id, now.instant);
    writer.delete(tx, { entityType: kind.entityType, entityId: id, knownServerVersion: stored.serverVersion });
    days.add(stored.payload.localDate);
    deleted += 1;
  };

  const seen = new Set<string>();
  for (const record of batch.upserts) {
    seen.add(record.externalKey);
    if (Date.parse(kind.at(record)) < Date.parse(batch.notBefore)) {
      skipped += 1;
      continue;
    }
    const id = kind.idOf(personId, batch.origin, record.externalKey);
    const stored = kind.read(tx, id);
    if (stored?.deletedAt != null) {
      skipped += 1;
      continue;
    }
    const payload = kind.payloadOf(record, batch.origin, stored?.payload, now);
    if (payload === null) {
      skipped += 1;
      remove(id);
      continue;
    }
    if (stored !== undefined && sameValues(stored.payload, payload)) continue;
    kind.write(tx, id, personId, payload, now.instant);
    writer.upsert(tx, { entityType: kind.entityType, entityId: id, payload, knownServerVersion: stored?.serverVersion ?? null });
    if (stored !== undefined) days.add(stored.payload.localDate);
    days.add(payload.localDate);
    upserted += 1;
  }

  for (const key of batch.deletedKeys) remove(kind.idOf(personId, batch.origin, key));

  const since = batch.reconcileSince;
  if (since !== null) {
    for (const { externalKey, at } of kind.keys(tx, personId, batch.origin)) {
      if (!seen.has(externalKey) && Date.parse(at) >= Date.parse(since)) remove(kind.idOf(personId, batch.origin, externalKey));
    }
  }

  const localDates = [...days].sort();
  if (localDates.length > 0) persistence.reevaluateDailyGoals(tx, personId, localDates, 'health_import');
  return { upserted, deleted, skipped, localDates };
}

/**
 * Lokaler Tag, Zone und Offset eines Imports (Spezifikation 3, Abschnitt 6): Offset ist der mitgelieferte,
 * sonst der der Zone zum Zeitpunkt; Zone ist die IANA-Zone des Geräts beim Import. Ein bekannter Eintrag
 * behält seine Zone, wie bei Korrekturen (Abschnitt 4).
 */
function dayOf(at: Instant, utcOffsetMinutes: number | null, stored: { timeZone: TimeZone } | undefined, now: ClockReading) {
  const timeZone = stored?.timeZone ?? now.timeZone;
  const supplied = UtcOffsetMinutes.safeParse(utcOffsetMinutes);
  const offset = supplied.success ? supplied.data : readingOf(at, timeZone).utcOffsetMinutes;
  return { localDate: localDateAtOffset(at, offset), timeZone, utcOffsetMinutes: offset };
}

/** Aktive Kalorien sind nur Anzeige: ganze, nicht negative `milli_kcal`, sonst keine Angabe. */
function milliKcalOf(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

const workoutKind: ImportKind<HealthWorkoutRecord, ImportedSportUpsert> = {
  entityType: sportEntryEntity.entityType,
  idOf: importedSportEntryId,
  read: readImportedSport,
  at: (record) => record.startedAt,
  payloadOf(record, origin, stored, now) {
    const durationMinutes = importedSportMinutes(record.durationSeconds);
    if (durationMinutes === null) return null;
    const parsed = SportEntryUpsert.safeParse({
      activityType: activityTypeOfPlatform(origin, record.platformActivityType),
      overrideActivityType: stored?.overrideActivityType ?? null,
      startedAt: record.startedAt,
      durationMinutes,
      activeMilliKcal: milliKcalOf(record.activeMilliKcal),
      origin,
      externalKey: record.externalKey,
      sourceAppId: record.sourceApp.id,
      sourceAppName: record.sourceApp.name,
      hiddenAt: stored?.hiddenAt ?? null,
      ...dayOf(record.startedAt, record.utcOffsetMinutes, stored, now),
    });
    return parsed.success ? (parsed.data as ImportedSportUpsert) : null;
  },
  write: writeSportEntry,
  tombstone: tombstoneSportEntry,
  keys: importedSportKeys,
};

const weightKind: ImportKind<HealthWeightRecord, ImportedWeightUpsert> = {
  entityType: weightEntryEntity.entityType,
  idOf: importedWeightEntryId,
  read: readImportedWeight,
  at: (record) => record.measuredAt,
  payloadOf(record, origin, stored, now) {
    if (!isValidImportedWeight(record.weightG)) return null;
    const parsed = WeightEntryUpsert.safeParse({
      weightG: record.weightG,
      measuredAt: record.measuredAt,
      origin,
      externalKey: record.externalKey,
      sourceAppId: record.sourceApp.id,
      sourceAppName: record.sourceApp.name,
      hiddenAt: stored?.hiddenAt ?? null,
      ...dayOf(record.measuredAt, record.utcOffsetMinutes, stored, now),
    });
    return parsed.success ? (parsed.data as ImportedWeightUpsert) : null;
  },
  write: writeWeightEntry,
  tombstone: tombstoneWeightEntry,
  keys: importedWeightKeys,
};

/** Gleiche fachliche Werte; Zeitpunkte vergleicht es als Zeitpunkte, damit Schreibweisen nicht stören. */
function sameValues(stored: object, next: object): boolean {
  const a = stored as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (left === right) continue;
    if (typeof left === 'string' && typeof right === 'string' && /At$/.test(key) && Date.parse(left) === Date.parse(right)) continue;
    return false;
  }
  return true;
}
