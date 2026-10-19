import { and, eq, isNull } from 'drizzle-orm';

import { EntityId, Instant, LocalDate, type ServerVersion } from '@abnehm/contracts/base';
import { DailyGoalCompletionRecord, type DailyGoalCompletion, type DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';

import type { ReadContext, TransactionContext } from '../local-db';
import { dailyGoalCompletion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { SyncEntityAdapter } from '../sync';

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
export const dailyGoalCompletionEntity: SyncEntityAdapter<never, DailyGoalCompletionRecord> = {
  entityType: 'daily_goal_completion',
  ownerField: 'personId',
  upsert: null,
  deletable: false,
  record: DailyGoalCompletionRecord,
  applyCanonical(tx, { entityId, serverVersion, data }) {
    if (data.id !== entityId) throw new Error('Tageszielerfüllung mit abweichender ID');
    const local = sqliteOf(tx)
      .select({ serverVersion: dailyGoalCompletion.serverVersion })
      .from(dailyGoalCompletion)
      .where(eq(dailyGoalCompletion.id, entityId))
      .get();
    if (local?.serverVersion != null && BigInt(local.serverVersion) > BigInt(serverVersion)) return;
    // Ein lokales Duplikat derselben ID wird vollständig durch den kanonischen Datensatz ersetzt.
    const row = rowOf(data, serverVersion);
    sqliteOf(tx).insert(dailyGoalCompletion).values(row).onConflictDoUpdate({ target: dailyGoalCompletion.id, set: row }).run();
  },
  applyTombstone() {
    throw new Error('Tageszielerfüllungen sind unveränderlich und werden nie gelöscht');
  },
  reconcileRejected() {
    throw new Error('Tageszielerfüllungen entstehen nur im Fachbefehl completeDailyGoal');
  },
  affectedDays(tx, entityId) {
    const row = sqliteOf(tx)
      .select({ personId: dailyGoalCompletion.personId, localDate: dailyGoalCompletion.localDate })
      .from(dailyGoalCompletion)
      .where(eq(dailyGoalCompletion.id, entityId))
      .get();
    return row === undefined ? [] : [{ type: 'tag', personId: EntityId.parse(row.personId), localDate: LocalDate.parse(row.localDate) }];
  },
};

function rowOf(record: DailyGoalCompletionRecord, serverVersion: ServerVersion | null): typeof dailyGoalCompletion.$inferInsert {
  return { ...record, serverVersion };
}

function recordOf(row: typeof dailyGoalCompletion.$inferSelect): DailyGoalCompletionRecord {
  const { serverVersion: _serverVersion, ...record } = row;
  return DailyGoalCompletionRecord.parse(record);
}
