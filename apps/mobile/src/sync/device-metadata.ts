import { eq } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant } from '@abnehm/contracts/base';

import type { LocalDatabase } from '../local-db';
import { deviceState, outbox } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

/** Installation und Outbox-Beobachtung bleiben hinter der Sync-Schnittstelle, nicht im App-Root. */
export function installationId(database: LocalDatabase, clock: Clock, newId: () => EntityId): EntityId {
  return database.transaction((tx) => {
    const db = sqliteOf(tx);
    const existing = db.select().from(deviceState).where(eq(deviceState.key, 'sync_installation_id')).get();
    if (existing) return EntityId.parse(existing.value);
    const id = newId();
    db.insert(deviceState).values({ key: 'sync_installation_id', value: id, updatedAt: Instant.parse(clock.read().instant) }).run();
    return id;
  });
}

/** Meldet Outbox-Änderungen nach Commits, nicht Wiederholungs-Metadaten derselben Operation. */
export function observePendingSignature(database: LocalDatabase, listener: (signature: string) => void): () => void {
  return database.observe((tx) => sqliteOf(tx).select({ operationId: outbox.operationId }).from(outbox).orderBy(outbox.sequence).all(),
    (rows) => listener(rows.map((row) => row.operationId).join(',')));
}

export function observeOutbox(database: LocalDatabase, listener: () => void): () => void {
  return database.observe((tx) => sqliteOf(tx).select({ operationId: outbox.operationId }).from(outbox).all(), listener);
}
