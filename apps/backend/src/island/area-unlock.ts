import { and, asc, eq, inArray } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { DiscoveryEventDetails, islandContentId, islandEventId, islandEventStateId } from '@abnehm/contracts/island-records';
import { notificationIntentId } from '@abnehm/contracts/notifications';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import { areaOccasionKey, areaUnlockAt, sidesOf, type AreaUnlock } from '@abnehm/game-rules/areas';
import { unlocksAt } from '@abnehm/game-rules/unlocks';
import type { GameCatalog } from '@abnehm/game-rules/catalog';

import { batchChangeWriter, changeWriter } from '../coupling/change-writer.ts';
import type { DbExecutor } from '../database.ts';
import { areaUnlock, blueprintUnlock, couplingMember, islandEvent, islandEventState, islandField } from '../db/schema/index.ts';
import { insertNotificationIntent } from '../sync/notification-intents.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { areaUnlockEntity, blueprintUnlockEntity, islandEventEntity, islandFieldEntity } from './island-entities.ts';

// Gebietsfreischaltung im Befehl des Levelaufstiegs (Spezifikation 4, Abschnitte 2.2, 5 und 9; #204). Für jedes
// neu erreichte Level mit Gebiet entstehen in derselben Transaktion:
//
// - die Gebietsfreischaltung (`area_unlock`) und die Inselfelder aus dem Feldplan des Katalogs für beide
//   Personen, je Person +10 Ecke und +30 Rollenbereich; Seite a und b gehören denselben Personen wie auf der
//   Grundinsel;
// - die Entdeckung: ein gemeinsames Ereignis mit dem Anlassschlüssel `gebiet:‹insel›:‹gebiet›`, das nicht zum
//   Ereignisdeckel zählt. Mit ihm sind die Entdeckungs-Baupläne für die Insel freigeschaltet; die
//   Entdeckungs-Deko holt jede Person über `claimEventReward` ab. Ein Ereignisstand je Person;
// - ein `gebiet`-Intent an beide, auch über mehrere Gebiete in einem Befehl nur einer je Empfänger, für das
//   neueste Gebiet (wie beim Levelaufstieg; Festlegung in #204, nicht belegt).
//
// Dasselbe Ereignis erscheint auf „Wir“ als „neues Gebiet“ (`shared_event` vom Typ `gebiet`); ein zweites
// Ereignis je Gebiet gibt es nicht. Idempotent über den Anlassschlüssel: Besteht die Entdeckung schon, entsteht
// für dieses Gebiet nichts mehr. Jeder Spielbefehl, der den Inselfortschritt neu berechnet, prüft alle Gebiete bis
// zum aktuellen Level, nicht nur die neu erreichten Level (`progress-change.ts`).

export type AreaUnlocks = Readonly<{
  islandId: EntityId;
  couplingId: EntityId;
  /** Level der Projektion; jedes Gebiet bis zu ihm muss freigeschaltet sein. */
  level: number;
  at: Date;
  catalog: GameCatalog;
}>;

/**
 * Schreibt Gebiete, Felder, Entdeckungen und Intents aller Gebiete bis zum Level, die der Insel noch fehlen; liefert
 * die kanonischen Änderungen. Auch Gebiete früherer Level zieht es nach, etwa wenn ein Katalog-Update ein Gebiet für
 * ein Formlevel bringt, das die Insel schon hinter sich hat (Spezifikation 4, Abschnitt 4: „damit bestehende Inseln
 * gültig bleiben“).
 */
export async function areaUnlockChanges(tx: DbExecutor, { islandId, couplingId, level, at, catalog }: AreaUnlocks): Promise<CanonicalChange[]> {
  const levels = Array.from({ length: Math.max(level - 1, 0) }, (_, index) => index + 2).filter((candidate) => unlocksAt(catalog, candidate).area !== null);
  if (levels.length === 0) return [];
  const occasionOf = (candidate: number) => areaOccasionKey(islandId, unlocksAt(catalog, candidate).area!.key);
  const known = new Set(
    (
      await tx
        .select({ occasionKey: islandEvent.occasionKey })
        .from(islandEvent)
        .where(and(eq(islandEvent.islandId, islandId), inArray(islandEvent.occasionKey, levels.map(occasionOf))))
    ).map((row) => row.occasionKey),
  );
  const missing = levels.filter((candidate) => !known.has(occasionOf(candidate)));
  if (missing.length === 0) return [];

  const fields = await tx.select({ key: islandField.fieldKey, ownerPersonId: islandField.ownerPersonId }).from(islandField).where(eq(islandField.islandId, islandId));
  const sides = sidesOf(catalog, fields);
  if (sides === null) throw new Error('Gebietsfreischaltung ohne materialisierte Grundinsel');
  const unlocks = missing.flatMap((candidate) => areaUnlockAt(catalog, { level: candidate, sides }) ?? []);
  if (unlocks.length === 0) return [];

  // Nach Person geordnet, damit Ereignisstände und Intents in fester Reihenfolge entstehen (wie in den Seeds).
  const members = (
    await tx.select({ personId: couplingMember.personId }).from(couplingMember).where(eq(couplingMember.couplingId, couplingId)).orderBy(asc(couplingMember.personId))
  ).map((row) => EntityId.parse(row.personId));
  const changes: CanonicalChange[] = [];
  for (const unlock of unlocks) changes.push(...(await unlockArea(tx, { islandId, couplingId, members, at, unlock })));

  const newest = unlocks.at(-1)!;
  const sourceEventId = islandEventId(islandId, areaOccasionKey(islandId, newest.area.key));
  for (const recipientPersonId of members) {
    await insertNotificationIntent(tx, {
      intentId: notificationIntentId({ sourceEventId, recipientPersonId, type: 'gebiet' }),
      sourceEventId,
      recipientPersonId,
      type: 'gebiet',
      messageKey: 'gebiet',
      createdAt: Instant.parse(at.toISOString()),
      payload: { gebietKey: newest.area.key },
    });
  }
  return changes;
}

async function unlockArea(
  tx: DbExecutor,
  { islandId, couplingId, members, at, unlock }: Readonly<{ islandId: EntityId; couplingId: EntityId; members: readonly EntityId[]; at: Date; unlock: AreaUnlock }>,
): Promise<CanonicalChange[]> {
  const write = changeWriter(tx, at);
  const writeAll = batchChangeWriter(tx, at);
  const owned = { islandId, couplingId };

  // IDs aus Insel und Schlüssel, wie in den Seeds (`islandContentId`).
  const areaId = islandContentId('area_unlock', islandId, unlock.area.key);
  await write({ entityType: 'area_unlock', couplingId }, async (stamp) => {
    await tx.insert(areaUnlock).values({ id: areaId, ...owned, areaKey: unlock.area.key, level: unlock.level, unlockedAt: at, createdAt: stamp.createdAt, serverVersion: stamp.serverVersion });
    return areaId;
  });

  const fields = unlock.fields.map((field) => ({ id: islandContentId('island_field', islandId, field.key), ...field }));
  await writeAll({ entityType: 'island_field', couplingId }, fields.map(({ id }) => id), async (stamped) => {
    await tx.insert(islandField).values(
      stamped.map(({ id, createdAt, serverVersion }, index) => ({
        id, ...owned, fieldKey: fields[index]!.key, ownerPersonId: fields[index]!.ownerPersonId, createdAt, serverVersion,
      })),
    );
  });

  // Ein wiederverwendeter Entdeckungs-Bauplan endloser Gebiete gehört der Insel meist schon.
  const ownedBlueprints = new Set(
    (await tx.select({ key: blueprintUnlock.catalogKey }).from(blueprintUnlock).where(eq(blueprintUnlock.islandId, islandId))).map((row) => row.key),
  );
  const blueprints = unlock.discovery.blueprints
    .filter((key) => !ownedBlueprints.has(key))
    .map((key) => ({ id: islandContentId('blueprint_unlock', islandId, key), key }));
  await writeAll({ entityType: 'blueprint_unlock', couplingId }, blueprints.map(({ id }) => id), async (stamped) => {
    await tx.insert(blueprintUnlock).values(
      stamped.map(({ id, createdAt, serverVersion }, index) => ({
        id, ...owned, catalogKey: blueprints[index]!.key, reason: 'entdeckung', unlockedAt: at, createdAt, serverVersion,
      })),
    );
  });

  const occasionKey = areaOccasionKey(islandId, unlock.area.key);
  const eventId = islandEventId(islandId, occasionKey);
  const details = DiscoveryEventDetails.parse(unlock.discovery);
  await write({ entityType: 'island_event', couplingId }, async (stamp) => {
    await tx.insert(islandEvent).values({
      id: eventId,
      ...owned,
      type: 'entdeckung',
      templateKey: null,
      responsiblePersonId: null,
      occasionKey,
      // Ohne Deko gibt es nichts abzuholen; die Entdeckung ist dann mit dem Freischalten abgeschlossen.
      status: details.deko.length > 0 ? 'erfuellbar' : 'abgeschlossen',
      reward: details,
      occurredAt: at,
      ...stamp,
    });
    return eventId;
  });
  const stateIds = members.map((personId) => islandEventStateId(eventId, personId));
  for (const [index, personId] of members.entries()) {
    await write({ entityType: 'island_event_state', ownerPersonId: personId }, async (stamp) => {
      await tx.insert(islandEventState).values({ id: stateIds[index]!, islandEventId: eventId, personId, seenAt: null, claimedAt: null, ...stamp });
      return stateIds[index]!;
    });
  }

  // Die Ereignisstände gehören je einer Person; eine Befehlsantwort darf nur enthalten, was die ausführende
  // Person lesen darf. Beide kommen deshalb mit dem nächsten Pull.
  // Nacheinander: Eine Transaktion hat genau eine Verbindung.
  const changes = [await canonicalAfterWrite(tx, areaUnlockEntity, areaId)];
  for (const { id } of fields) changes.push(await canonicalAfterWrite(tx, islandFieldEntity, id));
  for (const { id } of blueprints) changes.push(await canonicalAfterWrite(tx, blueprintUnlockEntity, id));
  changes.push(await canonicalAfterWrite(tx, islandEventEntity, eventId));
  return changes;
}
