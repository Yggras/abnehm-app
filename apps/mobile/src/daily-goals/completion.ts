import { and, desc, eq, isNull } from 'drizzle-orm';

import { Instant, LocalDate, type EntityId, type ServerVersion } from '@abnehm/contracts/base';
import { DailyGoalCompletionRecord, type DailyGoalCompletion, type DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';

import type { ReadContext, TransactionContext } from '../local-db';
import { dailyGoalCompletion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { immutableDayEntity } from '../sync';

/**
 * Die fundamentseigene, unveränderliche Tageszielerfüllung zu Person, Tag und Platz des Snapshots.
 * Angelegt wird sie nur vom Persistenzdienst; Korrekturen der Einträge ändern sie nicht.
 */
export function readCompletion(tx: ReadContext, snapshot: DailyGoalSnapshot): DailyGoalCompletion {
  const row = sqliteOf(tx)
    .select({ firstCompletedAt: dailyGoalCompletion.firstCompletedAt })
    .from(dailyGoalCompletion)
    .where(
      and(
        eq(dailyGoalCompletion.personId, snapshot.personId),
        eq(dailyGoalCompletion.localDate, snapshot.localDate),
        eq(dailyGoalCompletion.slot, snapshot.slot),
      ),
    )
    .get();
  return row === undefined ? { type: 'nie' } : { type: 'festgehalten', firstCompletedAt: Instant.parse(row.firstCompletedAt) };
}

/** Alle Tageszielerfüllungen einer Person an einem Tag, nach Platz. */
export function completionsOfDay(tx: ReadContext, personId: EntityId, localDate: LocalDate): DailyGoalCompletionRecord[] {
  return sqliteOf(tx)
    .select()
    .from(dailyGoalCompletion)
    .where(and(eq(dailyGoalCompletion.personId, personId), eq(dailyGoalCompletion.localDate, localDate)))
    .all()
    .map(recordOf)
    .sort((a, b) => a.slot - b.slot);
}

/**
 * Lokaler Tag der jüngsten Tageszielerfüllung einer Person; `null` ohne jede. Spezifikation 4 leitet
 * daraus ab, ob Momo döst (#188).
 */
export function latestCompletionDate(tx: ReadContext, personId: EntityId): LocalDate | null {
  const row = sqliteOf(tx)
    .select({ localDate: dailyGoalCompletion.localDate })
    .from(dailyGoalCompletion)
    .where(eq(dailyGoalCompletion.personId, personId))
    .orderBy(desc(dailyGoalCompletion.localDate))
    .limit(1)
    .get();
  return row === undefined ? null : LocalDate.parse(row.localDate);
}

export function insertCompletion(tx: TransactionContext, record: DailyGoalCompletionRecord): void {
  sqliteOf(tx).insert(dailyGoalCompletion).values(rowOf(DailyGoalCompletionRecord.parse(record), null)).run();
}

/** Lokal unbestätigte Erfüllung entfernen, wenn der Server ihren Fachbefehl dauerhaft abgelehnt hat. */
export function removeUnconfirmedCompletion(tx: TransactionContext, completionId: EntityId): void {
  sqliteOf(tx)
    .delete(dailyGoalCompletion)
    .where(and(eq(dailyGoalCompletion.id, completionId), isNull(dailyGoalCompletion.serverVersion)))
    .run();
}

/** Sync-Entität: Erfüllungen kommen nur als kanonische Datensätze, nie als Upsert oder Löschung. */
export const dailyGoalCompletionEntity = immutableDayEntity({
  entityType: 'daily_goal_completion',
  ownerField: 'personId',
  record: DailyGoalCompletionRecord,
  table: dailyGoalCompletion,
  row: (record) => rowOf(record, null),
});

function rowOf(record: DailyGoalCompletionRecord, serverVersion: ServerVersion | null): typeof dailyGoalCompletion.$inferInsert {
  return { ...record, serverVersion };
}

function recordOf(row: typeof dailyGoalCompletion.$inferSelect): DailyGoalCompletionRecord {
  const { serverVersion: _serverVersion, ...record } = row;
  return DailyGoalCompletionRecord.parse(record);
}
