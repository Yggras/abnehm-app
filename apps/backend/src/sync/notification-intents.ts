import { eq, sql } from 'drizzle-orm';

import { NotificationIntent } from '@abnehm/contracts/notifications';

import type { DbExecutor } from '../database.ts';
import { notificationIntent } from '../db/schema/index.ts';
import { canonicalJson } from '../canonical-json.ts';

/** `NOTIFY`-Kanal, über den der Commit eines neuen Intents den Push-Zusteller anstößt (#142). */
export const NOTIFICATION_INTENT_CHANNEL = 'notification_intent';

/** Die einzige Schreibgrenze für Push-Intents. Aufrufer reichen ihren Fach-Savepoint durch; bei
 * Rollback des Befehls bleibt weder Intent noch Fachereignis bestehen. */
export async function insertNotificationIntent(tx: DbExecutor, raw: unknown): Promise<void> {
  const intent = NotificationIntent.parse(raw);
  const values = {
    intentId: intent.intentId,
    sourceEventId: intent.sourceEventId,
    recipientPersonId: intent.recipientPersonId,
    type: intent.type,
    messageKey: intent.messageKey,
    payload: intent.payload,
    status: 'offen' as const,
    createdAt: new Date(intent.createdAt),
    statusChangedAt: new Date(intent.createdAt),
  };
  const inserted = await tx.insert(notificationIntent).values(values).onConflictDoNothing().returning({ id: notificationIntent.intentId });
  if (inserted.length > 0) {
    // Stößt den Zusteller an; Postgres stellt die Benachrichtigung erst nach dem Commit zu, nach einem
    // Rollback nie (https://www.postgresql.org/docs/current/sql-notify.html).
    await tx.execute(sql`select pg_notify(${NOTIFICATION_INTENT_CHANNEL}, '')`);
  } else {
    const [existing] = await tx.select().from(notificationIntent).where(eq(notificationIntent.intentId, intent.intentId));
    if (existing === undefined || existing.sourceEventId !== intent.sourceEventId || existing.recipientPersonId !== intent.recipientPersonId ||
      existing.type !== intent.type || existing.messageKey !== intent.messageKey || canonicalJson(existing.payload) !== canonicalJson(intent.payload)) {
      throw new Error('Intent-ID mit anderem Inhalt wiederverwendet');
    }
  }
}
