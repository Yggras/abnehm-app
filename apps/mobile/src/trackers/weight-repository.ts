import { asc, eq } from 'drizzle-orm';

import { EntityId, LocalDate, TimeZone, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import type { WeightEntryFacts } from '@abnehm/contracts/tracker-rules';
import type { WeightEntryUpsert } from '@abnehm/contracts/trackers';

import type { ReadContext, TransactionContext } from '../local-db';
import { weightEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository der Gewichtseinträge: neben dem Sync-Adapter `weight-entity.ts` die einzige Stelle des
// Tracker-Moduls, die Drizzle und die Tabelle `weight_entry` sieht. Andere Bereiche lesen sie nie
// (Spezifikation 3, Abschnitt 2).

/** Was Befehle und Sync von einem gespeicherten Eintrag wissen müssen. */
export type StoredWeightEntry = Readonly<{
  personId: EntityId;
  localDate: LocalDate;
  /** Zone und Offset der Anlage; eine Aktualisierung behält beide (Spezifikation 3, Abschnitt 4). */
  timeZone: TimeZone;
  utcOffsetMinutes: number;
  deletedAt: Instant | null;
  serverVersion: ServerVersion | null;
}>;

/** Legt den Eintrag an oder überschreibt seine fachlichen Felder (Last-Write-Wins). */
export function writeWeightEntry(tx: TransactionContext, entityId: EntityId, personId: EntityId, payload: WeightEntryUpsert, at: Instant): void {
  const fields = { ...payload, updatedAt: at };
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
    localDate: LocalDate.parse(row.localDate),
    timeZone: TimeZone.parse(row.timeZone),
    utcOffsetMinutes: row.utcOffsetMinutes,
    deletedAt: row.deletedAt as Instant | null,
    serverVersion: row.serverVersion as ServerVersion | null,
  };
}

/** Alle Gewichtseinträge einer Person, auch gelöschte und ausgeblendete; die Regeln filtern selbst. */
export function weightEntriesOf(tx: ReadContext, personId: EntityId): WeightEntryFacts[] {
  return sqliteOf(tx)
    .select({
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
