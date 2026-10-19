import { eq } from 'drizzle-orm';

import { NotificationIntent } from '@abnehm/contracts/notifications';

import type { DbExecutor } from '../database.ts';
import { notificationIntent } from '../db/schema/index.ts';

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
    status: 'offen',
    createdAt: new Date(intent.createdAt),
    statusChangedAt: new Date(intent.createdAt),
  };
  const inserted = await tx.insert(notificationIntent).values(values).onConflictDoNothing().returning({ id: notificationIntent.intentId });
  if (inserted.length === 0) {
    const [existing] = await tx.select().from(notificationIntent).where(eq(notificationIntent.intentId, intent.intentId));
    if (existing === undefined || existing.sourceEventId !== intent.sourceEventId || existing.recipientPersonId !== intent.recipientPersonId ||
      existing.type !== intent.type || existing.messageKey !== intent.messageKey || canonicalJson(existing.payload) !== canonicalJson(intent.payload)) {
      throw new Error('Intent-ID mit anderem Inhalt wiederverwendet');
    }
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  return JSON.stringify(value);
}
