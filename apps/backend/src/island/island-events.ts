import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';

import { readingOf } from '@abnehm/clock';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { ClaimEventReward, claimEventRewardKey, type IslandEventKind, IslandRole, MarkEventsSeen, markEventsSeenKey } from '@abnehm/contracts/island';
import { DiscoveryEventDetails, eventRewardId, islandEventId, islandEventStateId, IslandObjectOrigin, VisitorEventDetails } from '@abnehm/contracts/island-records';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import {
  cappedEventKinds,
  isWishFulfilled,
  openVisitFacts,
  personalEventKinds,
  planVisitors,
  resolveClaimedReward,
  visitorSlotOf,
  type VisitorPerson,
} from '@abnehm/game-rules/events';
import { gameCatalog } from '@abnehm/game-rules/content';

import { policies } from '../authorization/authorization.ts';
import { changeWriter, updated } from '../coupling/change-writer.ts';
import type { DbExecutor } from '../database.ts';
import { blueprintUnlock, couplingMember, island, islandEvent, islandEventState, islandObject } from '../db/schema/index.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import type { PrePullStep } from '../sync/sync.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { blueprintUnlockEntity, islandEventEntity, islandEventStateEntity, islandObjectEntity } from './island-entities.ts';
import { playingRole } from './playing-role.ts';

// Insel-Ereignisse auf dem Server (Spezifikation 4, Abschnitt 9; #202).
//
// Erzeugung: Vor jeder Pull-Antwort materialisiert der Vor-Pull-Schritt die fehlenden Ereignisse der Insel
// für den aktuellen Inseltag in der Zeitzone der Insel. Er ist idempotent: Der Anlassschlüssel ist je Insel
// eindeutig, die ID leitet sich aus Insel und Anlass ab, und eine Sperre je Insel ordnet gleichzeitige Pulls
// beider Personen hintereinander. Vergangene Tage holt er nicht nach; in Pausen wächst so kein Stapel.
//
// Zustände: Ein Ereignis ist für die zuständige Person zuerst neu, nach `markEventsSeen` gesehen. Ein
// Besucherwunsch ist offen, bis die Person den gewünschten Bauplan baut; das setzt `buildObject` im selben
// Befehl auf erfüllbar. `claimEventReward` prüft die Bedingung selbst und bestimmt die Belohnung kanonisch.
// Ereignisse verfallen nie.

const catalog = gameCatalog;

/** Wie weit die Erzeugung zurückliest, um den aktuellen Inseltag in jeder Zeitzone abzudecken. */
const recentWindowMs = 48 * 60 * 60 * 1000;

type ActiveIsland = Readonly<{ islandId: EntityId; couplingId: EntityId; timeZone: TimeZone }>;

/** Die geschlüpfte, aktive Insel der Person; ohne aktive Kopplung oder vor dem Schlüpfen `null`. */
async function activeIslandOf(tx: DbExecutor, personId: EntityId): Promise<ActiveIsland | null> {
  const [row] = await tx
    .select({ islandId: island.id, couplingId: island.couplingId, state: island.state, timeZone: island.timeZone })
    .from(couplingMember)
    .innerJoin(island, eq(island.couplingId, couplingMember.couplingId))
    .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')));
  if (row === undefined || row.state !== 'aktiv' || row.timeZone === null) return null;
  return { islandId: EntityId.parse(row.islandId), couplingId: EntityId.parse(row.couplingId), timeZone: TimeZone.parse(row.timeZone) };
}

/** Vor-Pull-Schritt: erzeugt die fehlenden Ereignisse des aktuellen Inseltags. */
export const generateIslandEvents: PrePullStep = async (tx, { personId, now }) => {
  const current = await activeIslandOf(tx, personId);
  if (current === null) return;
  // Der zweite Pull derselben Insel wartet und sieht danach die Ereignisse des ersten.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`island_events:${current.islandId}`}, 0))`);
  const date = readingOf(now, current.timeZone).localDate;
  const at = new Date(now);

  const members = await tx
    .select({ personId: couplingMember.personId, role: couplingMember.role })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, current.couplingId), eq(couplingMember.couplingStatus, 'aktiv')));
  if (members.length !== 2 || members.some((member) => member.role === null)) return;

  const recent = await tx
    .select({ type: islandEvent.type, responsiblePersonId: islandEvent.responsiblePersonId, occasionKey: islandEvent.occasionKey, occurredAt: islandEvent.occurredAt })
    .from(islandEvent)
    .where(and(eq(islandEvent.islandId, current.islandId), gte(islandEvent.occurredAt, new Date(at.getTime() - recentWindowMs))));
  const today = recent.filter(
    (event) => cappedEventKinds.includes(event.type as IslandEventKind) && readingOf(Instant.parse(event.occurredAt.toISOString()), current.timeZone).localDate === date,
  );
  const open = await tx
    .select({ type: islandEvent.type, templateKey: islandEvent.templateKey, responsiblePersonId: islandEvent.responsiblePersonId, reward: islandEvent.reward })
    .from(islandEvent)
    .where(and(eq(islandEvent.islandId, current.islandId), inArray(islandEvent.type, [...personalEventKinds]), inArray(islandEvent.status, ['offen', 'erfuellbar'])));
  const unlocked = await tx.select({ key: blueprintUnlock.catalogKey }).from(blueprintUnlock).where(eq(blueprintUnlock.islandId, current.islandId));
  const built = await tx
    .select({ owner: islandObject.ownerPersonId, key: islandObject.catalogKey })
    .from(islandObject)
    .where(and(eq(islandObject.islandId, current.islandId), eq(islandObject.origin, 'gebaut'), isNull(islandObject.deletedAt)));
  const openVisits = open.flatMap((event) => {
    const details = VisitorEventDetails.safeParse(event.reward);
    return event.type === 'besuch' && event.templateKey !== null && details.success ? [{ templateKey: event.templateKey, details: details.data }] : [];
  });

  const persons: VisitorPerson[] = members.map((member) => ({
    personId: member.personId,
    role: IslandRole.parse(member.role),
    personalToday: today.filter((event) => event.responsiblePersonId === member.personId && personalEventKinds.includes(event.type as IslandEventKind)).length,
    openPersonal: open.filter((event) => event.responsiblePersonId === member.personId).length,
    builtBlueprints: new Set(built.filter((object) => object.owner === member.personId).map((object) => object.key)),
  }));
  const visitors = planVisitors(catalog, {
    islandId: current.islandId,
    date,
    cappedToday: today.length,
    visitorSlotsUsed: new Set(today.flatMap((event) => visitorSlotOf(event.occasionKey, date) ?? [])),
    unlockedBlueprints: new Set(unlocked.map((row) => row.key)),
    ...openVisitFacts(openVisits),
    persons,
  });

  const write = changeWriter(tx, at);
  for (const visitor of visitors) {
    const eventId = islandEventId(current.islandId, visitor.occasionKey);
    const responsible = EntityId.parse(visitor.responsiblePersonId);
    await write({ entityType: 'island_event', couplingId: current.couplingId }, async (stamp) => {
      await tx.insert(islandEvent).values({
        id: eventId,
        islandId: current.islandId,
        couplingId: current.couplingId,
        type: 'besuch',
        templateKey: visitor.templateKey,
        responsiblePersonId: responsible,
        occasionKey: visitor.occasionKey,
        status: 'offen',
        reward: visitor.details,
        occurredAt: at,
        ...stamp,
      });
      return eventId;
    });
    await write({ entityType: 'island_event_state', ownerPersonId: responsible }, async (stamp) => {
      const id = islandEventStateId(eventId, responsible);
      await tx.insert(islandEventState).values({ id, islandEventId: eventId, personId: responsible, seenAt: null, claimedAt: null, ...stamp });
      return id;
    });
  }
};

/**
 * Setzt offene Besucherwünsche der Person auf erfüllbar, die ihr neuer Bau erfüllt; im Befehl `buildObject`.
 * Liefert die geänderten Ereignisse als kanonische Änderungen.
 */
export async function fulfillWishes(
  tx: DbExecutor,
  built: Readonly<{ islandId: EntityId; couplingId: EntityId; personId: EntityId; catalogKey: string; at: Date }>,
): Promise<CanonicalChange[]> {
  const open = await tx
    .select()
    .from(islandEvent)
    .where(
      and(eq(islandEvent.islandId, built.islandId), eq(islandEvent.type, 'besuch'), eq(islandEvent.responsiblePersonId, built.personId), eq(islandEvent.status, 'offen')),
    );
  const object = { ownerPersonId: built.personId, catalogKey: built.catalogKey, origin: 'gebaut' as const, createdAt: built.at.toISOString() };
  const changes: CanonicalChange[] = [];
  for (const event of open) {
    const details = VisitorEventDetails.parse(event.reward);
    if (!isWishFulfilled({ wish: details.wish, responsiblePersonId: built.personId, occurredAt: event.occurredAt.toISOString() }, [object])) continue;
    await changeWriter(tx, built.at)({ entityType: 'island_event', couplingId: built.couplingId }, async (stamp) => {
      await tx.update(islandEvent).set({ status: 'erfuellbar', ...updated(stamp) }).where(eq(islandEvent.id, event.id));
      return event.id;
    });
    changes.push(await canonicalAfterWrite(tx, islandEventEntity, EntityId.parse(event.id)));
  }
  return changes;
}

/** Ereignisstand samt Ereignis, gelesen nach erfolgreicher Autorisierung. */
async function stateWithEvent(tx: DbExecutor, islandEventStateIdValue: EntityId) {
  const [row] = await tx
    .select({ state: islandEventState, event: islandEvent })
    .from(islandEventState)
    .innerJoin(islandEvent, eq(islandEvent.id, islandEventState.islandEventId))
    .where(eq(islandEventState.id, islandEventStateIdValue))
    .for('update');
  if (row === undefined) throw new Error('Ereignisstand fehlt trotz Autorisierung');
  return row;
}

/** Lehnt ab und nennt den kanonischen Ereignisstand; das Gerät übernimmt ihn. */
async function refuse(tx: DbExecutor, stateId: EntityId): Promise<never> {
  throw new CommandRejection('conflict', await canonicalAfterWrite(tx, islandEventStateEntity, stateId));
}

export const markEventsSeenCommand: ServerCommand<MarkEventsSeen> = {
  type: 'markEventsSeen',
  identity: 'none',
  policy: policies.resource('island_event_state', 'befehl'),
  payload: MarkEventsSeen,
  target: (operation) => ({ id: MarkEventsSeen.parse(operation.payload).islandEventStateId }),
  canonicalRequest: (operation) => MarkEventsSeen.parse(operation.payload),
  duplicate: () => [],
  async execute(tx, { payload, businessKey, at }) {
    if (businessKey !== markEventsSeenKey(payload.islandEventStateId)) throw new CommandRejection('invalid_payload');
    const { state } = await stateWithEvent(tx, payload.islandEventStateId);
    if (state.seenAt === null) {
      await changeWriter(tx, at)({ entityType: 'island_event_state', ownerPersonId: state.personId }, async (stamp) => {
        await tx.update(islandEventState).set({ seenAt: at, ...updated(stamp) }).where(eq(islandEventState.id, state.id));
        return state.id;
      });
    }
    return { changes: [await canonicalAfterWrite(tx, islandEventStateEntity, payload.islandEventStateId)], idMappings: [] };
  },
};

export const claimEventRewardCommand: ServerCommand<ClaimEventReward> = {
  type: 'claimEventReward',
  identity: 'none',
  policy: policies.resource('island_event_state', 'befehl'),
  payload: ClaimEventReward,
  target: (operation) => ({ id: ClaimEventReward.parse(operation.payload).islandEventStateId }),
  canonicalRequest: (operation) => ClaimEventReward.parse(operation.payload),
  // Die IDs der Belohnung leiten Gerät und Server aus dem Ereignisstand ab; ein Duplikat ist ein Retry.
  duplicate: () => [],
  async execute(tx, { actor, resource, payload, businessKey, at }) {
    const stateId = payload.islandEventStateId;
    if (businessKey !== claimEventRewardKey(stateId)) throw new CommandRejection('invalid_payload');
    const couplingId = EntityId.parse(resource.couplingId);
    const { state, event } = await stateWithEvent(tx, stateId);
    if (state.claimedAt !== null || state.personId !== actor.personId) return refuse(tx, stateId);
    // Besucher und Entdeckung haben eine Belohnung; Momos Wunsch (#206) und Inselwetter (#207) melden sich mit
    // ihren Tickets hier an.
    if (event.type === 'entdeckung') return claimDiscovery(tx, { personId: actor.personId, couplingId, stateId, event, seenAt: state.seenAt, at });
    const { templateKey } = event;
    if (event.type !== 'besuch' || templateKey === null || event.responsiblePersonId !== actor.personId) return refuse(tx, stateId);
    const islandId = EntityId.parse(event.islandId);
    const role = await playingRole(tx, { islandId, couplingId, personId: actor.personId });
    if (role === null) return refuse(tx, stateId);
    const details = VisitorEventDetails.parse(event.reward);
    const objects = await tx
      .select({ ownerPersonId: islandObject.ownerPersonId, catalogKey: islandObject.catalogKey, origin: islandObject.origin, createdAt: islandObject.createdAt })
      .from(islandObject)
      .where(and(eq(islandObject.islandId, islandId), eq(islandObject.ownerPersonId, actor.personId), eq(islandObject.catalogKey, details.wish.blueprintKey)));
    const fulfilled = isWishFulfilled(
      { wish: details.wish, responsiblePersonId: actor.personId, occurredAt: event.occurredAt.toISOString() },
      objects.map((object) => ({ ...object, origin: IslandObjectOrigin.parse(object.origin), createdAt: object.createdAt.toISOString() })),
    );
    if (!fulfilled) return refuse(tx, stateId);

    const unlocked = await tx.select({ key: blueprintUnlock.catalogKey }).from(blueprintUnlock).where(eq(blueprintUnlock.islandId, islandId));
    const reward = resolveClaimedReward(catalog, {
      eventId: event.id,
      templateKey,
      planned: details.reward,
      role,
      unlockedBlueprints: new Set(unlocked.map((row) => row.key)),
    });
    const rewardId = eventRewardId(stateId);
    const write = changeWriter(tx, at);
    const changes: CanonicalChange[] = [];
    if (reward.type === 'bauplan') {
      await write({ entityType: 'blueprint_unlock', couplingId }, async (stamp) => {
        await tx.insert(blueprintUnlock).values({ id: rewardId, islandId, couplingId, catalogKey: reward.key, reason: 'besucher', unlockedAt: at, ...stamp });
        return rewardId;
      });
      changes.push(await canonicalAfterWrite(tx, blueprintUnlockEntity, rewardId));
    } else {
      await write({ entityType: 'island_object', couplingId }, async (stamp) => {
        await tx.insert(islandObject).values({
          id: rewardId, islandId, couplingId, ownerPersonId: actor.personId, catalogKey: reward.key, origin: 'besucher', level: 1, fieldId: null, ...stamp,
        });
        return rewardId;
      });
      changes.push(await canonicalAfterWrite(tx, islandObjectEntity, rewardId));
    }
    await write({ entityType: 'island_event', couplingId }, async (stamp) => {
      await tx.update(islandEvent).set({ status: 'abgeschlossen', reward: { ...details, reward }, ...updated(stamp) }).where(eq(islandEvent.id, event.id));
      return event.id;
    });
    await write({ entityType: 'island_event_state', ownerPersonId: actor.personId }, async (stamp) => {
      await tx.update(islandEventState).set({ claimedAt: at, seenAt: state.seenAt ?? at, ...updated(stamp) }).where(eq(islandEventState.id, stateId));
      return stateId;
    });
    changes.unshift(await canonicalAfterWrite(tx, islandEventEntity, EntityId.parse(event.id)), await canonicalAfterWrite(tx, islandEventStateEntity, stateId));
    return { changes, idMappings: [] };
  },
};

/**
 * Entdeckung (#204): Jede Person holt die Entdeckungs-Deko des Gebiets einmal ab, eindeutig je Ereignis und
 * Person über ihren Ereignisstand. Die Stücke kommen in ihr Lager; das `index`-te Stück trägt die ID
 * `eventRewardId(stand, index)`, wie auf dem Gerät. Die Baupläne sind schon mit dem Ereignis freigeschaltet.
 * Ein Gebiet ohne Deko (endlose Gebiete) hat nichts zum Abholen.
 */
async function claimDiscovery(
  tx: DbExecutor,
  { personId, couplingId, stateId, event, seenAt, at }: Readonly<{
    personId: EntityId;
    couplingId: EntityId;
    stateId: EntityId;
    event: typeof islandEvent.$inferSelect;
    seenAt: Date | null;
    at: Date;
  }>,
) {
  const details = DiscoveryEventDetails.safeParse(event.reward);
  if (!details.success || details.data.deko.length === 0) return refuse(tx, stateId);
  const islandId = EntityId.parse(event.islandId);
  const write = changeWriter(tx, at);
  const changes: CanonicalChange[] = [];
  for (const [index, key] of details.data.deko.entries()) {
    const rewardId = eventRewardId(stateId, index);
    await write({ entityType: 'island_object', couplingId }, async (stamp) => {
      await tx.insert(islandObject).values({ id: rewardId, islandId, couplingId, ownerPersonId: personId, catalogKey: key, origin: 'entdeckung', level: 1, fieldId: null, ...stamp });
      return rewardId;
    });
    changes.push(await canonicalAfterWrite(tx, islandObjectEntity, rewardId));
  }
  await write({ entityType: 'island_event_state', ownerPersonId: personId }, async (stamp) => {
    await tx.update(islandEventState).set({ claimedAt: at, seenAt: seenAt ?? at, ...updated(stamp) }).where(eq(islandEventState.id, stateId));
    return stateId;
  });
  changes.unshift(await canonicalAfterWrite(tx, islandEventStateEntity, stateId));
  return { changes, idMappings: [] };
}

export const islandEventCommands = [markEventsSeenCommand, claimEventRewardCommand] as const;
