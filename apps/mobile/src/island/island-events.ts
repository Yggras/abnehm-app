import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { ClaimEventReward, claimEventRewardKey, IslandEventKind, MarkEventsSeen, markEventsSeenKey } from '@abnehm/contracts/island';
import { DiscoveryEventDetails, eventRewardId, IslandObjectOrigin, VisitorEventDetails, type VisitorReward } from '@abnehm/contracts/island-records';
import { indexCatalog, parseEndlessAreaKey, type ArtKey } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import { isWishFulfilled, resolveClaimedReward, type WishObject } from '@abnehm/game-rules/events';

import type { ReadContext, TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { blueprintUnlock, islandEvent, islandEventState, islandObject } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { LocalCommand } from '../sync';
import { onlyTheGameService, playingRole, type IslandCommandDependencies } from './island-access';

// Insel-Ereignisse in der App (Spezifikation 4, Abschnitt 9; #202). Ereignisse entstehen nur auf dem
// Server und kommen per Pull. Das Gerät zeigt sie, merkt sie als gesehen vor und holt Belohnungen offline
// vorläufig ab: Ereignisstand und Belohnung stehen lokal sofort mit ihrer Outbox-Operation in einer
// Transaktion. Ob ein Wunsch erfüllt ist und welche Belohnung es gibt, rechnet das Gerät mit denselben
// Spielregeln wie der Server; der Server bestätigt kanonisch. Lehnt er ab oder gewährt er etwas anderes,
// verschwindet die vorläufige Belohnung in derselben Transaktion wie die Operation.
//
// Entdeckung (#204): Mit einem neuen Gebiet kommt für beide Personen eine Entdeckung. Ihre Baupläne sind mit
// dem Ereignis für die Insel freigeschaltet; die Entdeckungs-Deko holt jede Person selbst ab. Eine Entdeckung
// ohne Deko (endlose Gebiete) wartet nur, bis die Person sie gesehen hat.

const catalog = indexCatalog(gameCatalog);

const nameOf = (kind: 'bauplan' | 'deko' | 'besuchervorlage' | 'gebiet' | 'landschaftsvorlage', key: string): string => {
  const found = catalog.find(kind, key);
  return found.type === 'found' ? found.entry.name : key;
};

/** Belohnung eines Besuchers mit sichtbarem Namen und Grafik. */
export type ShownReward = VisitorReward & Readonly<{ name: string; art: ArtKey }>;

function shownReward(reward: VisitorReward): ShownReward {
  if (reward.type === 'deko') {
    const deko = catalog.find('deko', reward.key);
    return { ...reward, name: nameOf('deko', reward.key), art: deko.type === 'found' ? deko.entry.art : reward.key };
  }
  const blueprint = catalog.find('bauplan', reward.key);
  return { ...reward, name: nameOf('bauplan', reward.key), art: blueprint.type === 'found' ? blueprint.entry.art[0] : reward.key };
}

/** Ein Besucher mit Wunsch, wie die zuständige Person ihn sieht. */
export type VisitorWish = Readonly<{
  kind: 'besuch';
  eventId: EntityId;
  stateId: EntityId;
  occurredAt: Instant;
  visitor: Readonly<{ key: string; name: string; animal: ArtKey }>;
  wish: Readonly<{ blueprintKey: string; name: string }>;
  /** Geplante Belohnung; beim Abholen kann der Server eine andere bestimmen. */
  reward: ShownReward;
  /** Ob die Person das Ereignis schon angesehen hat. */
  seen: boolean;
  /** Ob die Bedingung erfüllt ist und die Belohnung abgeholt werden kann. */
  claimable: boolean;
}>;

/** Eine Entdeckung, wie jede Person sie sieht: das neue Gebiet, seine Baupläne für die Insel und die Deko zum Abholen. */
export type Discovery = Readonly<{
  kind: 'entdeckung';
  eventId: EntityId;
  stateId: EntityId;
  occurredAt: Instant;
  /** Name des Gebiets; bei einem endlosen Gebiet der Name seiner Landschaftsvorlage. */
  area: Readonly<{ key: string; name: string }>;
  blueprints: readonly Readonly<{ key: string; name: string }>[];
  /** Grafik der ersten Stufe des ersten neuen Bauplans, als Bild einer Entdeckung ohne Deko. */
  blueprintArt: ArtKey | null;
  /** Entdeckungs-Deko für das eigene Lager; leer bei endlosen Gebieten. */
  deko: readonly ShownReward[];
  seen: boolean;
  /** Ob es Deko gibt, die die Person noch abholen kann. */
  claimable: boolean;
}>;

/** Ein Insel-Ereignis der Person. */
export type IslandEvent = VisitorWish | Discovery;

/**
 * Was für die Person auf der Insel wartet: alle noch nicht abgeholten Ereignisse, neueste zuerst. Neu ist,
 * was sie noch nicht gesehen hat; abgeholt hat sie keines davon. Eine Entdeckung ohne Deko bleibt, bis die
 * Person sie gesehen hat. Ereignisse verfallen nie.
 */
export type IslandEvents = Readonly<{ open: readonly IslandEvent[] }>;

/** Die offenen Ereignisse der Person auf der Insel. */
export function readIslandEvents(tx: ReadContext, { islandId, personId }: Readonly<{ islandId: EntityId; personId: EntityId }>): IslandEvents {
  const db = sqliteOf(tx);
  const rows = db
    .select({ event: islandEvent, state: islandEventState })
    .from(islandEvent)
    .innerJoin(islandEventState, and(eq(islandEventState.islandEventId, islandEvent.id), eq(islandEventState.personId, personId)))
    .where(and(eq(islandEvent.islandId, islandId), inArray(islandEvent.type, IslandEventKind.options), isNull(islandEventState.claimedAt)))
    .orderBy(desc(islandEvent.occurredAt), desc(islandEvent.occasionKey))
    .all();
  const built = ownBuilt(tx, islandId, personId);
  return {
    open: rows.flatMap(({ event, state }): IslandEvent[] => {
      if (event.type === 'entdeckung') {
        const discovery = discoveryOf(event, state);
        return discovery === null || (!discovery.claimable && discovery.seen) ? [] : [discovery];
      }
      // Momos Wunsch und Inselwetter kommen mit ihren Tickets (#206, #207).
      const details = VisitorEventDetails.safeParse(event.reward);
      if (event.type !== 'besuch' || event.templateKey === null || !details.success) return [];
      const template = catalog.find('besuchervorlage', event.templateKey);
      const claimable = claimableOf(event, details.data, personId, built);
      return [{
        kind: 'besuch' as const,
        eventId: EntityId.parse(event.id),
        stateId: EntityId.parse(state.id),
        occurredAt: Instant.parse(event.occurredAt),
        visitor: { key: event.templateKey, name: nameOf('besuchervorlage', event.templateKey), animal: template.type === 'found' ? template.entry.animal : event.templateKey },
        wish: { blueprintKey: details.data.wish.blueprintKey, name: nameOf('bauplan', details.data.wish.blueprintKey) },
        reward: shownReward(details.data.reward),
        seen: state.seenAt !== null,
        claimable,
      }];
    }),
  };
}

/** Eine Entdeckung aus Ereignis und eigenem Stand; `null` bei unlesbarem Inhalt. */
function discoveryOf(
  event: Readonly<{ id: string; reward: unknown; occurredAt: string }>,
  state: Readonly<{ id: string; seenAt: string | null; claimedAt: string | null }>,
): Discovery | null {
  const details = DiscoveryEventDetails.safeParse(event.reward);
  if (!details.success) return null;
  const { areaKey, blueprints, deko } = details.data;
  const endless = parseEndlessAreaKey(areaKey);
  return {
    kind: 'entdeckung',
    eventId: EntityId.parse(event.id),
    stateId: EntityId.parse(state.id),
    occurredAt: Instant.parse(event.occurredAt),
    area: { key: areaKey, name: endless === undefined ? nameOf('gebiet', areaKey) : nameOf('landschaftsvorlage', endless.template) },
    blueprints: blueprints.map((key) => ({ key, name: nameOf('bauplan', key) })),
    blueprintArt: blueprints[0] === undefined ? null : shownReward({ type: 'bauplan', key: blueprints[0] }).art,
    deko: deko.map((key) => shownReward({ type: 'deko', key })),
    seen: state.seenAt !== null,
    claimable: deko.length > 0 && state.claimedAt === null,
  };
}

/**
 * Ob ein Wunsch erfüllbar ist: Der Server hat ihn erfüllbar gesetzt, oder ein eigener Bau nach dem Erzeugen
 * erfüllt ihn lokal, etwa offline (Spezifikation 4, Abschnitt 9).
 */
function claimableOf(
  event: Readonly<{ status: string; occurredAt: string }>,
  details: VisitorEventDetails,
  personId: EntityId,
  built: readonly WishObject[],
): boolean {
  if (event.status === 'erfuellbar') return true;
  return event.status === 'offen' && isWishFulfilled({ wish: details.wish, responsiblePersonId: personId, occurredAt: event.occurredAt }, built);
}

/** Eigene, mit Energie gebaute Objekte der Insel, wie die Bedingung eines Wunschs sie sieht. */
function ownBuilt(tx: ReadContext, islandId: EntityId, personId: EntityId) {
  return sqliteOf(tx)
    .select({ ownerPersonId: islandObject.ownerPersonId, catalogKey: islandObject.catalogKey, origin: islandObject.origin, createdAt: islandObject.createdAt })
    .from(islandObject)
    .where(and(eq(islandObject.islandId, islandId), eq(islandObject.ownerPersonId, personId), eq(islandObject.origin, 'gebaut')))
    .all()
    .map((object) => ({ ...object, origin: IslandObjectOrigin.parse(object.origin) }));
}

/** Ereignisstand der eigenen Person samt Ereignis; `null`, wenn es ihn lokal nicht gibt. */
function ownState(tx: TransactionContext, stateId: EntityId) {
  const own = readOwnPerson(tx);
  if (own === undefined) return null;
  const row = sqliteOf(tx)
    .select({ event: islandEvent, state: islandEventState })
    .from(islandEventState)
    .innerJoin(islandEvent, eq(islandEvent.id, islandEventState.islandEventId))
    .where(and(eq(islandEventState.id, stateId), eq(islandEventState.personId, own.id)))
    .get();
  return row === undefined ? null : { ...row, personId: EntityId.parse(own.id) };
}

/**
 * Merkt die Ereignisse als gesehen vor, in der Transaktion des Aufrufers: je noch nicht gesehenem
 * eigenen Ereignisstand eine Operation. Liefert, wie viele neu gesehen sind.
 */
export function markEventsSeen(tx: TransactionContext, { writer, clock }: Pick<IslandCommandDependencies, 'writer' | 'clock'>, stateIds: readonly EntityId[]): number {
  const { instant } = clock.read();
  let marked = 0;
  for (const islandEventStateId of stateIds) {
    const found = ownState(tx, islandEventStateId);
    if (found === null || found.state.seenAt !== null) continue;
    sqliteOf(tx).update(islandEventState).set({ seenAt: instant, updatedAt: instant }).where(eq(islandEventState.id, islandEventStateId)).run();
    writer.command(tx, {
      type: 'markEventsSeen',
      businessKey: markEventsSeenKey(islandEventStateId),
      payload: MarkEventsSeen.parse({ islandEventStateId }),
      knownServerVersion: null,
      affectedRefs: [{ entityType: 'island_event_state', entityId: islandEventStateId }],
      referencePaths: [],
    });
    marked += 1;
  }
  return marked;
}

export type ClaimOutcome =
  | Readonly<{ type: 'abgeholt'; rewards: readonly ShownReward[] }>
  | Readonly<{ type: 'verboten'; reason: 'kein_eigenes_ereignis' | 'schon_abgeholt' | 'nicht_erfuellt' }>;

/**
 * Holt die Belohnung eines erfüllten Wunschs vorläufig ab, in der Transaktion des Aufrufers: Ereignisstand
 * abgeholt, dazu ein Besucher-Bauplan für die Insel oder Deko ins eigene Lager. Die ID der Belohnung leitet
 * sich aus dem Ereignisstand ab, wie auf dem Server.
 */
export function claimEventReward(tx: TransactionContext, { writer, clock }: Pick<IslandCommandDependencies, 'writer' | 'clock'>, islandEventStateId: EntityId): ClaimOutcome {
  const found = ownState(tx, islandEventStateId);
  if (found === null) return { type: 'verboten', reason: 'kein_eigenes_ereignis' };
  const { event, state, personId } = found;
  if (state.claimedAt !== null) return { type: 'verboten', reason: 'schon_abgeholt' };
  if (event.type === 'entdeckung') return claimDiscovery(tx, { writer, clock }, { event, seenAt: state.seenAt, personId, islandEventStateId });
  const { templateKey } = event;
  if (event.type !== 'besuch' || event.responsiblePersonId !== personId || templateKey === null) return { type: 'verboten', reason: 'kein_eigenes_ereignis' };
  const role = playingRole(tx, { islandId: event.islandId, couplingId: event.couplingId, personId });
  const details = VisitorEventDetails.safeParse(event.reward);
  if (role === null || !details.success) return { type: 'verboten', reason: 'kein_eigenes_ereignis' };
  const islandId = EntityId.parse(event.islandId);
  if (!claimableOf(event, details.data, personId, ownBuilt(tx, islandId, personId))) return { type: 'verboten', reason: 'nicht_erfuellt' };

  const db = sqliteOf(tx);
  const unlocked = db.select({ key: blueprintUnlock.catalogKey }).from(blueprintUnlock).where(eq(blueprintUnlock.islandId, islandId)).all();
  const reward = resolveClaimedReward(gameCatalog, {
    eventId: event.id,
    templateKey,
    planned: details.data.reward,
    role,
    unlockedBlueprints: new Set(unlocked.map((row) => row.key)),
  });
  const { instant } = clock.read();
  const rewardId = eventRewardId(islandEventStateId);
  if (reward.type === 'bauplan') {
    db.insert(blueprintUnlock).values({ id: rewardId, islandId, couplingId: event.couplingId, catalogKey: reward.key, reason: 'besucher', unlockedAt: instant, createdAt: instant, serverVersion: null }).run();
  } else {
    db.insert(islandObject).values({
      id: rewardId, islandId, couplingId: event.couplingId, ownerPersonId: personId, catalogKey: reward.key, origin: 'besucher', level: 1, fieldId: null,
      createdAt: instant, updatedAt: instant, deletedAt: null, serverVersion: null,
    }).run();
  }
  db.update(islandEventState).set({ claimedAt: instant, seenAt: state.seenAt ?? instant, updatedAt: instant }).where(eq(islandEventState.id, islandEventStateId)).run();
  writer.command(tx, {
    type: 'claimEventReward',
    businessKey: claimEventRewardKey(islandEventStateId),
    payload: ClaimEventReward.parse({ islandEventStateId }),
    knownServerVersion: null,
    affectedRefs: [
      { entityType: 'island_event_state', entityId: islandEventStateId },
      { entityType: reward.type === 'bauplan' ? 'blueprint_unlock' : 'island_object', entityId: rewardId },
    ],
    referencePaths: [],
  });
  return { type: 'abgeholt', rewards: [shownReward(reward)] };
}

/**
 * Holt die Entdeckungs-Deko vorläufig ab: jedes Stück ins eigene Lager, mit der ID aus Ereignisstand und Index
 * wie auf dem Server (#204). Eine Entdeckung ohne Deko hat nichts zum Abholen.
 */
function claimDiscovery(
  tx: TransactionContext,
  { writer, clock }: Pick<IslandCommandDependencies, 'writer' | 'clock'>,
  { event, seenAt, personId, islandEventStateId }: Readonly<{
    event: Readonly<{ islandId: string; couplingId: string; reward: unknown }>;
    seenAt: string | null;
    personId: EntityId;
    islandEventStateId: EntityId;
  }>,
): ClaimOutcome {
  const details = DiscoveryEventDetails.safeParse(event.reward);
  if (!details.success || details.data.deko.length === 0) return { type: 'verboten', reason: 'nicht_erfuellt' };
  const db = sqliteOf(tx);
  const { instant } = clock.read();
  const rewardIds = details.data.deko.map((_, index) => eventRewardId(islandEventStateId, index));
  details.data.deko.forEach((key, index) => {
    db.insert(islandObject).values({
      id: rewardIds[index]!, islandId: event.islandId, couplingId: event.couplingId, ownerPersonId: personId, catalogKey: key, origin: 'entdeckung', level: 1,
      fieldId: null, createdAt: instant, updatedAt: instant, deletedAt: null, serverVersion: null,
    }).run();
  });
  db.update(islandEventState).set({ claimedAt: instant, seenAt: seenAt ?? instant, updatedAt: instant }).where(eq(islandEventState.id, islandEventStateId)).run();
  writer.command(tx, {
    type: 'claimEventReward',
    businessKey: claimEventRewardKey(islandEventStateId),
    payload: ClaimEventReward.parse({ islandEventStateId }),
    knownServerVersion: null,
    affectedRefs: [
      { entityType: 'island_event_state', entityId: islandEventStateId },
      ...rewardIds.map((entityId) => ({ entityType: 'island_object' as const, entityId })),
    ],
    referencePaths: [],
  });
  return { type: 'abgeholt', rewards: details.data.deko.map((key) => shownReward({ type: 'deko', key })) };
}

/** Entfernt die vorläufige Belohnung, soweit der Server sie nicht bestätigt hat; bei einer Entdeckung jedes Stück. */
function removeUnconfirmedReward(tx: TransactionContext, islandEventStateId: EntityId) {
  const db = sqliteOf(tx);
  const event = db
    .select({ reward: islandEvent.reward })
    .from(islandEventState)
    .innerJoin(islandEvent, eq(islandEvent.id, islandEventState.islandEventId))
    .where(eq(islandEventState.id, islandEventStateId))
    .get();
  const discovery = DiscoveryEventDetails.safeParse(event?.reward);
  const count = discovery.success ? Math.max(discovery.data.deko.length, 1) : 1;
  const rewardIds = Array.from({ length: count }, (_, index) => eventRewardId(islandEventStateId, index));
  db.delete(blueprintUnlock).where(and(inArray(blueprintUnlock.id, rewardIds), isNull(blueprintUnlock.serverVersion))).run();
  db.delete(islandObject).where(and(inArray(islandObject.id, rewardIds), isNull(islandObject.serverVersion))).run();
}

const markEventsSeenCommand: LocalCommand<MarkEventsSeen> = {
  type: 'markEventsSeen',
  payload: MarkEventsSeen,
  referencePaths: [],
  apply: onlyTheGameService('markEventsSeen'),
  // Den kanonischen Ereignisstand übernimmt die Engine aus der Ablehnung.
  reconcileRejected: () => undefined,
};

const claimEventRewardCommand: LocalCommand<ClaimEventReward> = {
  type: 'claimEventReward',
  payload: ClaimEventReward,
  referencePaths: [],
  apply: onlyTheGameService('claimEventReward'),
  // Den kanonischen Ereignisstand übernimmt die Engine aus der Ablehnung; die vorläufige Belohnung geht.
  reconcileRejected(tx, operation) {
    removeUnconfirmedReward(tx, ClaimEventReward.parse(operation.payload).islandEventStateId);
  },
  // Hat der Server eine andere Art von Belohnung gewährt, bleibt die vorläufige unbestätigt zurück.
  reconcileApplied(tx, operation) {
    removeUnconfirmedReward(tx, ClaimEventReward.parse(operation.payload).islandEventStateId);
  },
};

export const islandEventCommands: readonly LocalCommand[] = [markEventsSeenCommand, claimEventRewardCommand];
