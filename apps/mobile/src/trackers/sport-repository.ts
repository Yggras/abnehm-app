import { and, asc, between, eq, inArray, isNotNull, or } from 'drizzle-orm';

import { EntityId, LocalDate, TimeZone, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import { weekOf, type SportEntryFacts } from '@abnehm/contracts/tracker-rules';
import type { SportEntryUpsert } from '@abnehm/contracts/trackers';

import type { ReadContext, TransactionContext } from '../local-db';
import { sportEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository der Sporteinträge: neben dem Sync-Adapter `sport-entity.ts` die einzige Stelle des
// Tracker-Moduls, die Drizzle und die Tabelle `sport_entry` sieht. Andere Bereiche lesen sie nie
// (Spezifikation 3, Abschnitt 2).

/** Was Befehle und Sync von einem gespeicherten Eintrag wissen müssen. */
export type StoredSportEntry = Readonly<{
  personId: EntityId;
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
export function sportColumns(payload: SportEntryUpsert) {
  const shared = {
    activityType: payload.activityType,
    startedAt: payload.startedAt,
    durationMinutes: payload.durationMinutes,
    activeMilliKcal: payload.activeMilliKcal,
    origin: payload.origin,
    localDate: payload.localDate,
    timeZone: payload.timeZone,
    utcOffsetMinutes: payload.utcOffsetMinutes,
  };
  if (payload.origin === 'manuell') {
    return {
      ...shared,
      overrideActivityType: null,
      externalKey: null,
      sourceAppId: null,
      sourceAppName: null,
      hiddenAt: null,
      replacedByEntryId: payload.replacedByEntryId,
      reactivatedAt: payload.reactivatedAt,
    };
  }
  return {
    ...shared,
    overrideActivityType: payload.overrideActivityType,
    externalKey: payload.externalKey,
    sourceAppId: payload.sourceAppId,
    sourceAppName: payload.sourceAppName,
    hiddenAt: payload.hiddenAt,
    replacedByEntryId: null,
    reactivatedAt: null,
  };
}

/** Legt den Eintrag an oder überschreibt seine fachlichen Felder (Last-Write-Wins). */
export function writeSportEntry(tx: TransactionContext, entityId: EntityId, personId: EntityId, payload: SportEntryUpsert, at: Instant): void {
  const fields = { ...sportColumns(payload), updatedAt: at };
  sqliteOf(tx)
    .insert(sportEntry)
    .values({ ...fields, id: entityId, personId, createdAt: at })
    .onConflictDoUpdate({ target: sportEntry.id, set: fields })
    .run();
}

/** Setzt die Löschmarkierung; Löschen ist ein Tombstone und für Clientoperationen endgültig. */
export function tombstoneSportEntry(tx: TransactionContext, entityId: EntityId, at: Instant): void {
  sqliteOf(tx).update(sportEntry).set({ deletedAt: at, updatedAt: at }).where(eq(sportEntry.id, entityId)).run();
}

export function readSportEntry(tx: ReadContext, entityId: EntityId): StoredSportEntry | undefined {
  const row = sqliteOf(tx)
    .select({
      personId: sportEntry.personId,
      localDate: sportEntry.localDate,
      timeZone: sportEntry.timeZone,
      utcOffsetMinutes: sportEntry.utcOffsetMinutes,
      deletedAt: sportEntry.deletedAt,
      serverVersion: sportEntry.serverVersion,
    })
    .from(sportEntry)
    .where(eq(sportEntry.id, entityId))
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

const facts = {
  id: sportEntry.id,
  origin: sportEntry.origin,
  durationMinutes: sportEntry.durationMinutes,
  localDate: sportEntry.localDate,
  deletedAt: sportEntry.deletedAt,
  hiddenAt: sportEntry.hiddenAt,
  replacedByEntryId: sportEntry.replacedByEntryId,
  reactivatedAt: sportEntry.reactivatedAt,
};

/**
 * Alle Einträge einer Person in der Woche (Montag bis Sonntag) eines lokalen Tags, auch gelöschte und
 * ausgeblendete, dazu die ersetzenden Importe dieser Einträge, auch aus Nachbarwochen. Die Zählregel
 * filtert selbst und braucht dafür den ersetzenden Import (Spezifikation 3, Abschnitt 3).
 */
export function sportEntriesOfWeek(tx: ReadContext, personId: EntityId, localDate: LocalDate): SportEntryFacts[] {
  const db = sqliteOf(tx);
  const { monday, sunday } = weekOf(localDate);
  const inWeek = and(eq(sportEntry.personId, personId), between(sportEntry.localDate, monday, sunday));
  const replacing = db.select({ id: sportEntry.replacedByEntryId }).from(sportEntry).where(and(inWeek, isNotNull(sportEntry.replacedByEntryId)));
  return db
    .select(facts)
    .from(sportEntry)
    .where(or(inWeek, and(eq(sportEntry.personId, personId), inArray(sportEntry.id, replacing))))
    .orderBy(asc(sportEntry.startedAt), asc(sportEntry.id))
    .all();
}
