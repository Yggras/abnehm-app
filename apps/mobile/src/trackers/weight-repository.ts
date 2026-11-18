import { and, asc, eq, isNull } from 'drizzle-orm';

import { EntityId, LocalDate, TimeZone, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import type { WeightEntryFacts } from '@abnehm/contracts/tracker-rules';
import { ImportedWeightEntryUpsert, type ImportOrigin, type WeightEntryUpsert } from '@abnehm/contracts/trackers';

import type { ReadContext, TransactionContext } from '../local-db';
import { weightEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { StoredImport } from './stored-import';

// Repository der Gewichtseinträge: neben dem Sync-Adapter `weight-entity.ts` die einzige Stelle des
// Tracker-Moduls, die Drizzle und die Tabelle `weight_entry` sieht. Andere Bereiche lesen sie nie
// (Spezifikation 3, Abschnitt 2).

/** Was Befehle und Sync von einem gespeicherten Eintrag wissen müssen. */
export type StoredWeightEntry = Readonly<{
  personId: EntityId;
  /** `manuell` oder die Herkunft eines Imports; nur manuelle Einträge lassen sich bearbeiten und löschen. */
  origin: string;
  weightG: number;
  measuredAt: Instant;
  localDate: LocalDate;
  /** Zone und Offset der Anlage; eine Aktualisierung behält beide (Spezifikation 3, Abschnitt 4). */
  timeZone: TimeZone;
  utcOffsetMinutes: number;
  deletedAt: Instant | null;
  serverVersion: ServerVersion | null;
}>;

/**
 * Alle fachlichen Spalten zur Nutzlast: Die Felder der jeweils anderen Herkunft sind leer, wie es die
 * `CHECK`-Constraints der Tabelle verlangen.
 */
export function weightColumns(payload: WeightEntryUpsert) {
  if (payload.origin === 'manuell') return { ...payload, externalKey: null, sourceAppId: null, sourceAppName: null, hiddenAt: null };
  return payload;
}

/** Legt den Eintrag an oder überschreibt seine fachlichen Felder (Last-Write-Wins). */
export function writeWeightEntry(tx: TransactionContext, entityId: EntityId, personId: EntityId, payload: WeightEntryUpsert, at: Instant): void {
  const fields = { ...weightColumns(payload), updatedAt: at };
  sqliteOf(tx)
    .insert(weightEntry)
    .values({ ...fields, id: entityId, personId, createdAt: at })
    .onConflictDoUpdate({ target: weightEntry.id, set: fields })
    .run();
}

/** Setzt die Löschmarkierung; Löschen ist ein Tombstone und für Clientoperationen endgültig. */
export function tombstoneWeightEntry(tx: TransactionContext, entityId: EntityId, at: Instant): void {
  sqliteOf(tx).update(weightEntry).set({ deletedAt: at, updatedAt: at }).where(eq(weightEntry.id, entityId)).run();
}

export function readWeightEntry(tx: ReadContext, entityId: EntityId): StoredWeightEntry | undefined {
  const row = sqliteOf(tx)
    .select({
      personId: weightEntry.personId,
      origin: weightEntry.origin,
      weightG: weightEntry.weightG,
      measuredAt: weightEntry.measuredAt,
      localDate: weightEntry.localDate,
      timeZone: weightEntry.timeZone,
      utcOffsetMinutes: weightEntry.utcOffsetMinutes,
      deletedAt: weightEntry.deletedAt,
      serverVersion: weightEntry.serverVersion,
    })
    .from(weightEntry)
    .where(eq(weightEntry.id, entityId))
    .get();
  return row && {
    personId: EntityId.parse(row.personId),
    origin: row.origin,
    weightG: row.weightG,
    measuredAt: row.measuredAt as Instant,
    localDate: LocalDate.parse(row.localDate),
    timeZone: TimeZone.parse(row.timeZone),
    utcOffsetMinutes: row.utcOffsetMinutes,
    deletedAt: row.deletedAt as Instant | null,
    serverVersion: row.serverVersion as ServerVersion | null,
  };
}

/** Ein Gewichtseintrag mit allem, was Regeln und Verlauf brauchen. */
export type WeightRow = WeightEntryFacts &
  Readonly<{
    id: string;
    /** `manuell` oder die Herkunft eines Imports. */
    origin: string;
    /** Anzeigename der Quell-App eines Imports, falls bekannt. */
    sourceAppName: string | null;
  }>;

/**
 * Alle Gewichtseinträge einer Person, auch gelöschte und ausgeblendete; die Regeln filtern selbst.
 * Aufsteigend nach Messzeitpunkt.
 */
export function weightEntriesOf(tx: ReadContext, personId: EntityId): WeightRow[] {
  return sqliteOf(tx)
    .select({
      id: weightEntry.id,
      origin: weightEntry.origin,
      sourceAppName: weightEntry.sourceAppName,
      weightG: weightEntry.weightG,
      measuredAt: weightEntry.measuredAt,
      localDate: weightEntry.localDate,
      deletedAt: weightEntry.deletedAt,
      hiddenAt: weightEntry.hiddenAt,
    })
    .from(weightEntry)
    .where(eq(weightEntry.personId, personId))
    .orderBy(asc(weightEntry.measuredAt), asc(weightEntry.id))
    .all();
}

/** Der importierte Gewichtseintrag zur ID, auch gelöscht; `undefined` ohne Eintrag oder bei einem manuellen. */
export function readImportedWeight(tx: ReadContext, entityId: EntityId): StoredImport<ImportedWeightEntryUpsert> | undefined {
  const row = sqliteOf(tx).select().from(weightEntry).where(eq(weightEntry.id, entityId)).get();
  if (row === undefined || row.origin === 'manuell') return undefined;
  const payload = ImportedWeightEntryUpsert.parse({
    weightG: row.weightG,
    measuredAt: row.measuredAt,
    origin: row.origin,
    externalKey: row.externalKey,
    sourceAppId: row.sourceAppId,
    sourceAppName: row.sourceAppName,
    hiddenAt: row.hiddenAt,
    localDate: row.localDate,
    timeZone: row.timeZone,
    utcOffsetMinutes: row.utcOffsetMinutes,
  });
  return { payload, deletedAt: row.deletedAt as Instant | null, serverVersion: row.serverVersion as ServerVersion | null };
}

/** Nicht gelöschte Importe einer Person aus einer Herkunft: externer Schlüssel und Messzeitpunkt. */
export function importedWeightKeys(tx: ReadContext, personId: EntityId, origin: ImportOrigin): { externalKey: string; at: string }[] {
  return sqliteOf(tx)
    .select({ externalKey: weightEntry.externalKey, at: weightEntry.measuredAt })
    .from(weightEntry)
    .where(and(eq(weightEntry.personId, personId), eq(weightEntry.origin, origin), isNull(weightEntry.deletedAt)))
    .all()
    .flatMap(({ externalKey, at }) => (externalKey === null ? [] : [{ externalKey, at }]));
}
