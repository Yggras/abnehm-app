import { and, asc, eq } from 'drizzle-orm';

import { EntityId, LocalDate, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import type { WaterEntryFacts } from '@abnehm/contracts/tracker-rules';
import type { WaterEntryUpsert } from '@abnehm/contracts/trackers';

import type { ReadContext, TransactionContext } from '../local-db';
import { waterEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository der Wassereinträge: die einzige Stelle des Tracker-Moduls, die Drizzle und die Tabelle
// `water_entry` sieht. Andere Bereiche lesen sie nie (Spezifikation 3, Abschnitt 2).

/** Was Befehle und Sync von einem gespeicherten Eintrag wissen müssen. */
export type StoredWaterEntry = Readonly<{
  personId: EntityId;
  localDate: LocalDate;
  deletedAt: Instant | null;
  serverVersion: ServerVersion | null;
}>;

/** Legt den Eintrag an oder überschreibt seine fachlichen Felder (Last-Write-Wins). */
export function writeWaterEntry(tx: TransactionContext, entityId: EntityId, personId: EntityId, payload: WaterEntryUpsert, at: Instant): void {
  const fields = { ...payload, updatedAt: at };
  sqliteOf(tx)
    .insert(waterEntry)
    .values({ ...fields, id: entityId, personId, createdAt: at })
    .onConflictDoUpdate({ target: waterEntry.id, set: fields })
    .run();
}

/** Setzt die Löschmarkierung; Löschen ist ein Tombstone und für Clientoperationen endgültig. */
export function tombstoneWaterEntry(tx: TransactionContext, entityId: EntityId, at: Instant): void {
  sqliteOf(tx).update(waterEntry).set({ deletedAt: at, updatedAt: at }).where(eq(waterEntry.id, entityId)).run();
}

export function readWaterEntry(tx: ReadContext, entityId: EntityId): StoredWaterEntry | undefined {
  const row = sqliteOf(tx)
    .select({ personId: waterEntry.personId, localDate: waterEntry.localDate, deletedAt: waterEntry.deletedAt, serverVersion: waterEntry.serverVersion })
    .from(waterEntry)
    .where(eq(waterEntry.id, entityId))
    .get();
  return row && {
    personId: EntityId.parse(row.personId),
    localDate: LocalDate.parse(row.localDate),
    deletedAt: row.deletedAt as Instant | null,
    serverVersion: row.serverVersion as ServerVersion | null,
  };
}

/** Alle Einträge einer Person an einem lokalen Tag, auch gelöschte; die Zählregel filtert selbst. */
export function waterEntriesOfDay(tx: ReadContext, personId: EntityId, localDate: LocalDate): WaterEntryFacts[] {
  return sqliteOf(tx)
    .select({ amountMl: waterEntry.amountMl, localDate: waterEntry.localDate, deletedAt: waterEntry.deletedAt })
    .from(waterEntry)
    .where(and(eq(waterEntry.personId, personId), eq(waterEntry.localDate, localDate)))
    .orderBy(asc(waterEntry.loggedAt), asc(waterEntry.id))
    .all();
}
