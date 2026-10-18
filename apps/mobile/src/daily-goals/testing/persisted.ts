import type { DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';

import type { TransactionContext } from '../../local-db';
import * as schema from '../../local-db/schema';
import { sqliteOf } from '../../local-db/sqlite';
import { personRow } from '../../local-db/testing/rows';

// Persistierte Tagesziele und Tageszielerfüllungen für Tests. Im Betrieb legt sie der
// Persistenzdienst an (#105); hier entstehen sie direkt, damit der Orchestrator sie lesen kann.

export function insertPersonForTest(tx: TransactionContext, personId: string): void {
  sqliteOf(tx).insert(schema.person).values(personRow(personId, `konto-${personId}`)).run();
}

export function insertDailyGoalForTest(tx: TransactionContext, id: string, snapshot: DailyGoalSnapshot): void {
  sqliteOf(tx)
    .insert(schema.dailyGoal)
    .values({
      id,
      personId: snapshot.personId,
      localDate: snapshot.localDate,
      timeZone: snapshot.timeZone,
      // Der Offset beim Anlegen spielt für die Auswertung keine Rolle.
      utcOffsetMinutes: 0,
      slot: snapshot.slot,
      baustein: snapshot.type,
      snapshot,
      dayEndsAt: snapshot.dayEndsAt,
      createdAt: snapshot.dayEndsAt,
    })
    .run();
}

export function insertCompletionForTest(
  tx: TransactionContext,
  id: string,
  dailyGoalId: string,
  snapshot: DailyGoalSnapshot,
  firstCompletedAt: string,
): void {
  sqliteOf(tx)
    .insert(schema.dailyGoalCompletion)
    .values({
      id,
      dailyGoalId,
      personId: snapshot.personId,
      localDate: snapshot.localDate,
      slot: snapshot.slot,
      baustein: snapshot.type,
      firstCompletedAt,
      completionKey: `tagesziel:${snapshot.personId}:${snapshot.localDate}:${snapshot.slot}`,
      createdAt: firstCompletedAt,
    })
    .run();
}
