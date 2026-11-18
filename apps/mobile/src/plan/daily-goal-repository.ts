import { and, asc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';

import { Instant, LocalDate, type EntityId } from '@abnehm/contracts/base';
import type { MaterializeDailyGoals } from '@abnehm/contracts/plan';

import type { ReadContext, TransactionContext } from '../local-db';
import { dailyGoal } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Repository der materialisierten Tagesziele (Spezifikation 1, Abschnitt 5): Das Plan-Modul legt sie an
// und entfernt sie nur, wenn der Server ihre Materialisierung nie bestätigt hat. Ausgewertet werden sie
// vom Persistenzdienst des Fundaments, der die Tabelle selbst liest.

/** Sync-Typ der Tagesziele in `affectedRefs`; den Sync-Adapter für kanonische Tagesziele liefert #133. */
export const dailyGoalEntityType = 'daily_goal';

/** Ein materialisierter Tag einer Person: lokaler Tag und festgeschriebenes Tagesende. */
export type MaterializedDay = Readonly<{ localDate: LocalDate; dayEndsAt: Instant }>;

/** Ob für Person und Tag schon Tagesziele bestehen; ein bestehender Tag bleibt unverändert. */
export function hasDailyGoals(tx: ReadContext, personId: EntityId, localDate: LocalDate): boolean {
  return sqliteOf(tx)
    .select({ id: dailyGoal.id })
    .from(dailyGoal)
    .where(and(eq(dailyGoal.personId, personId), eq(dailyGoal.localDate, localDate)))
    .limit(1)
    .get() !== undefined;
}

/** Die materialisierten Tage zwischen `from` und `to` (beide einschließlich), aufsteigend. */
export function materializedDays(tx: ReadContext, personId: EntityId, from: LocalDate, to: LocalDate): MaterializedDay[] {
  return sqliteOf(tx)
    .selectDistinct({ localDate: dailyGoal.localDate, dayEndsAt: dailyGoal.dayEndsAt })
    .from(dailyGoal)
    .where(and(eq(dailyGoal.personId, personId), gte(dailyGoal.localDate, from), lte(dailyGoal.localDate, to)))
    .orderBy(asc(dailyGoal.localDate))
    .all()
    .map((row) => ({ localDate: LocalDate.parse(row.localDate), dayEndsAt: Instant.parse(row.dayEndsAt) }));
}

/** Legt die drei Tagesziele eines Tags an; Zone und Offset gehören zum Beginn des Tags. */
export function insertDailyGoals(
  tx: TransactionContext,
  { goals }: MaterializeDailyGoals,
  stamps: Readonly<{ utcOffsetMinutes: number; createdAt: Instant }>,
): void {
  sqliteOf(tx)
    .insert(dailyGoal)
    .values(goals.map(({ id, snapshot }) => ({
      id,
      personId: snapshot.personId,
      localDate: snapshot.localDate,
      timeZone: snapshot.timeZone,
      utcOffsetMinutes: stamps.utcOffsetMinutes,
      slot: snapshot.slot,
      baustein: snapshot.type,
      snapshot,
      dayEndsAt: snapshot.dayEndsAt,
      createdAt: stamps.createdAt,
    })))
    .run();
}

/**
 * Entfernt die Tagesziele eines Tags, solange der Server keines davon bestätigt hat; sonst bleibt der Tag,
 * wie er ist. Ob noch eine Erfüllung auf sie zeigt, klärt vorher das Fundament (`removeUnconfirmedDayCredits`).
 */
export function removeUnconfirmedDailyGoals(tx: TransactionContext, ids: readonly EntityId[]): void {
  const db = sqliteOf(tx);
  const confirmed = db.select({ id: dailyGoal.id }).from(dailyGoal).where(and(inArray(dailyGoal.id, [...ids]), isNotNull(dailyGoal.serverVersion))).limit(1).get();
  if (confirmed === undefined) db.delete(dailyGoal).where(inArray(dailyGoal.id, [...ids])).run();
}
