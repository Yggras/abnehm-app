import { randomUUID } from 'node:crypto';

import { and, eq, inArray } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { islandEventId } from '@abnehm/contracts/island-records';
import { notificationIntentId } from '@abnehm/contracts/notifications';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import type { GameCatalog } from '@abnehm/game-rules/catalog';
import { unlocksAt } from '@abnehm/game-rules/unlocks';

import { batchChangeWriter, changeWriter } from '../coupling/change-writer.ts';
import type { DbExecutor } from '../database.ts';
import { blueprintUnlock, couplingMember, islandEvent } from '../db/schema/index.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { insertNotificationIntent } from '../sync/notification-intents.ts';
import { blueprintUnlockEntity, islandEventEntity } from './island-entities.ts';

// Levelaufstieg im selben Befehl (Spezifikation 4, Abschnitt 2.2; Spezifikation 0, Abschnitt 4; #200).
// Hebt ein Spielbefehl die Insel auf ein höheres Level, entstehen in seiner Transaktion für jedes neu
// erreichte Level die Level-Freischaltung je Rolle aus dem Katalog (Abschnitt 5) und das gemeinsame Ereignis
// „Levelaufstieg“ mit dem Anlassschlüssel `level:<insel>:<L>`, dazu genau ein `levelaufstieg`-Intent je
// Mitglied mit dem höchsten neuen Level.
//
// Idempotent über den Anlassschlüssel: Ein Level, dessen Ereignis schon besteht, gilt als gefeiert. Erreicht
// die Insel es nach einer Gegenbuchung erneut, entsteht nichts Neues, auch kein Push. Gebiete, Formen und
// Entdeckung an den Formlevels liefert #204.

export type LevelUp = Readonly<{
  islandId: EntityId;
  couplingId: EntityId;
  /** Level der Projektion vor dem Befehl. */
  fromLevel: number;
  /** Level der Projektion nach dem Befehl. */
  toLevel: number;
  at: Date;
  catalog: GameCatalog;
}>;

/** Anlassschlüssel des Levelaufstiegs auf Level `level`. */
export const levelOccasionKey = (islandId: EntityId, level: number) => `level:${islandId}:${level}`;

/** Schreibt Freischaltungen, Ereignisse und Intents der neu erreichten Level; liefert die kanonischen Änderungen. */
export async function levelUpChanges(tx: DbExecutor, { islandId, couplingId, fromLevel, toLevel, at, catalog }: LevelUp): Promise<CanonicalChange[]> {
  const candidates = Array.from({ length: Math.max(toLevel - fromLevel, 0) }, (_, index) => fromLevel + 1 + index).filter((level) => level >= 2);
  if (candidates.length === 0) return [];
  const known = new Set(
    (
      await tx
        .select({ occasionKey: islandEvent.occasionKey })
        .from(islandEvent)
        .where(and(eq(islandEvent.islandId, islandId), inArray(islandEvent.occasionKey, candidates.map((level) => levelOccasionKey(islandId, level)))))
    ).map((row) => row.occasionKey),
  );
  const levels = candidates.filter((level) => !known.has(levelOccasionKey(islandId, level)));
  if (levels.length === 0) return [];

  const changes = await unlockBlueprints(tx, { islandId, couplingId, levels, at, catalog });
  const write = changeWriter(tx, at);
  for (const level of levels) {
    const occasionKey = levelOccasionKey(islandId, level);
    const id = islandEventId(islandId, occasionKey);
    await write({ entityType: 'island_event', couplingId }, async (stamp) => {
      await tx.insert(islandEvent).values({
        id, islandId, couplingId, type: 'levelaufstieg', templateKey: null, responsiblePersonId: null, occasionKey, status: 'abgeschlossen', reward: null, occurredAt: at, ...stamp,
      });
      return id;
    });
    changes.push(await canonicalAfterWrite(tx, islandEventEntity, id));
  }

  // Nur ein Push je Empfänger, auch über mehrere Level: der des höchsten (Spezifikation 0, Abschnitt 4).
  const level = levels.at(-1)!;
  const sourceEventId = islandEventId(islandId, levelOccasionKey(islandId, level));
  const members = await tx.select({ personId: couplingMember.personId }).from(couplingMember).where(eq(couplingMember.couplingId, couplingId));
  for (const { personId } of members) {
    const recipientPersonId = EntityId.parse(personId);
    await insertNotificationIntent(tx, {
      intentId: notificationIntentId({ sourceEventId, recipientPersonId, type: 'levelaufstieg' }),
      sourceEventId,
      recipientPersonId,
      type: 'levelaufstieg',
      messageKey: 'levelaufstieg',
      createdAt: Instant.parse(at.toISOString()),
      payload: { level },
    });
  }
  return changes;
}

/** Die Level-Freischaltungen je Rolle der Level; Baupläne, die die Insel schon hat, bleiben unberührt. */
async function unlockBlueprints(
  tx: DbExecutor,
  { islandId, couplingId, levels, at, catalog }: Readonly<{ islandId: EntityId; couplingId: EntityId; levels: readonly number[]; at: Date; catalog: GameCatalog }>,
): Promise<CanonicalChange[]> {
  const owned = new Set((await tx.select({ key: blueprintUnlock.catalogKey }).from(blueprintUnlock).where(eq(blueprintUnlock.islandId, islandId))).map((row) => row.key));
  const keys = [...new Set(levels.flatMap((level) => unlocksAt(catalog, level).blueprints.filter((b) => b.reason === 'level').map((b) => b.key)))].filter((key) => !owned.has(key));
  if (keys.length === 0) return [];
  const rows = keys.map((key) => ({ id: randomUUID(), key }));
  await batchChangeWriter(tx, at)({ entityType: 'blueprint_unlock', couplingId }, rows.map(({ id }) => id), async (stamped) => {
    await tx.insert(blueprintUnlock).values(
      stamped.map(({ id, createdAt, serverVersion }, index) => ({
        id, islandId, couplingId, catalogKey: rows[index]!.key, reason: 'level', unlockedAt: at, createdAt, serverVersion,
      })),
    );
  });
  return Promise.all(rows.map(({ id }) => canonicalAfterWrite(tx, blueprintUnlockEntity, EntityId.parse(id))));
}
