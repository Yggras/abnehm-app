import { and, eq } from 'drizzle-orm';

import { Instant } from '@abnehm/contracts/base';
import type { DailyGoalCompletion, DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';

import type { ReadContext } from '../local-db';
import { dailyGoalCompletion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

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
