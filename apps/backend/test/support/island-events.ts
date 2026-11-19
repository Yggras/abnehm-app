import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { claimEventRewardKey, markEventsSeenKey, type ClaimEventReward, type MarkEventsSeen } from '@abnehm/contracts/island';
import { VisitorEventDetails } from '@abnehm/contracts/island-records';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { islandEvent, islandEventState } from '../../src/db/schema/index.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, resourceProbe, type AuthorizationScenario } from './authorization.ts';
import { buildOp, builtWorld, fieldKeys, otherHatchedPair, type BuildWorld } from './building.ts';
import type { WorldPerson } from './coupled-world.ts';
import { uncoupleAs } from './shared-actions.ts';
import { pullAll, pushOutcome } from './sync.ts';

// Insel-Ereignisse in Server-Tests (#202): Push-Operationen `markEventsSeen` und `claimEventReward`, das
// Lesen der Besucher einer Person und die Negativtest-Szenarien beider Befehle.

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

function commandOp(type: 'markEventsSeen' | 'claimEventReward', businessKey: string, payload: MarkEventsSeen | ClaimEventReward, operationId?: string): CommandOperation {
  return {
    type,
    operationId: EntityId.parse(operationId ?? randomUUID()),
    businessKey,
    payload,
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse('2026-10-14T12:00:00.000Z'),
  };
}

export function seenOp(islandEventStateId: EntityId, { operationId, businessKey }: { operationId?: string; businessKey?: string } = {}): CommandOperation {
  return commandOp('markEventsSeen', businessKey ?? markEventsSeenKey(islandEventStateId), { islandEventStateId }, operationId);
}

export function claimOp(islandEventStateId: EntityId, { operationId, businessKey }: { operationId?: string; businessKey?: string } = {}): CommandOperation {
  return commandOp('claimEventReward', businessKey ?? claimEventRewardKey(islandEventStateId), { islandEventStateId }, operationId);
}

/** Ein Besucher, wie der Server ihn gespeichert hat, samt Stand der zuständigen Person. */
export type Visit = Readonly<{
  eventId: EntityId;
  stateId: EntityId;
  occasionKey: string;
  templateKey: string;
  status: string;
  responsiblePersonId: string;
  details: VisitorEventDetails;
  occurredAt: Date;
}>;

/** Alle Besucher der Insel in Anlassreihenfolge. */
export async function visitsOf(world: Pick<BuildWorld, 'backend' | 'islandId'>): Promise<Visit[]> {
  const rows = await world.backend.database.db
    .select({ event: islandEvent, stateId: islandEventState.id })
    .from(islandEvent)
    .innerJoin(islandEventState, eq(islandEventState.islandEventId, islandEvent.id))
    .where(and(eq(islandEvent.islandId, world.islandId), eq(islandEvent.type, 'besuch')));
  return rows
    .map(({ event, stateId }) => ({
      eventId: EntityId.parse(event.id),
      stateId: EntityId.parse(stateId),
      occasionKey: event.occasionKey,
      templateKey: event.templateKey!,
      status: event.status,
      responsiblePersonId: event.responsiblePersonId!,
      details: VisitorEventDetails.parse(event.reward),
      occurredAt: event.occurredAt,
    }))
    .sort((a, b) => (a.occasionKey < b.occasionKey ? -1 : a.occasionKey > b.occasionKey ? 1 : 0));
}

/** Der offene Besuch einer Person; die Insel muss ihn haben. */
export async function visitOf(world: Pick<BuildWorld, 'backend' | 'islandId'>, person: WorldPerson): Promise<Visit> {
  const visit = (await visitsOf(world)).find((candidate) => candidate.responsiblePersonId === person.personId && candidate.status !== 'abgeschlossen');
  if (visit === undefined) throw new Error(`Kein offener Besuch für ${person.personId}`);
  return visit;
}

/** `builtWorld` nach dem ersten Pull: Philipp und Anna haben je einen Besucher; die Uhr steht eine Minute später. */
export async function visitedWorld() {
  const world = await builtWorld();
  await pullAll(world.backend, world.actor);
  // Für einen Wunsch zählen nur Handlungen danach; die Testuhr steht sonst still.
  world.clock.advanceBy(60_000);
  return { ...world, visit: await visitOf(world, world.philipp), annasVisit: await visitOf(world, world.anna) };
}

export type VisitedWorld = Awaited<ReturnType<typeof visitedWorld>>;

const denials = {
  // Der Stand der Partnerin und ein Stand des anderen Paars.
  manipulierte_id: async (world: VisitedWorld, attempt: (stateId: EntityId) => CommandOperation) => {
    const other = await otherHatchedPair(world);
    await pullAll(world.backend, other.philipp.device);
    const foreign = await visitOf({ backend: world.backend, islandId: other.islandId }, other.philipp);
    for (const stateId of [world.annasVisit.stateId, foreign.stateId]) {
      const outcome = await pushOutcome(world.backend, world.actor, attempt(stateId));
      if (outcome !== 'verweigert') return outcome;
    }
    return 'verweigert' as const;
  },
  entkopplung: async (world: VisitedWorld) => void (await uncoupleAs(world.backend, { couplingId: world.couplingId, requesterPersonId: world.anna.personId })),
  verbotene_operation: (world: VisitedWorld) =>
    resourceProbe(world.backend, policies.resource('island_event_state', 'upsert'))(world.actor, { id: world.visit.stateId }).then(httpOutcome),
};

type Dimensions = 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation';

/** Negativtest-Szenario für `markEventsSeen`: den eigenen Besuch ansehen als Gegenprobe. */
export const markEventsSeenScenario = {
  policy: policies.resource('island_event_state', 'befehl'),
  arrange: visitedWorld,
  attempt: (world: VisitedWorld, device: Device) => pushOutcome(world.backend, device, seenOp(world.visit.stateId)),
  manipulierte_id: (world: VisitedWorld) => denials.manipulierte_id(world, (stateId) => seenOp(stateId)),
  entkopplung: denials.entkopplung,
  verbotene_operation: denials.verbotene_operation,
} satisfies AuthorizationScenario<VisitedWorld, Dimensions>;

/**
 * Negativtest-Szenario für `claimEventReward`. Die Gegenprobe holt einen erfüllten Wunsch ab: Philipp baut
 * den gewünschten Bauplan, bevor er abholt.
 */
export const claimEventRewardScenario = {
  policy: policies.resource('island_event_state', 'befehl'),
  arrange: async () => {
    const world = await visitedWorld();
    const outcome = await pushOutcome(world.backend, world.actor, buildOp({
      fieldId: world.fieldId(fieldKeys.philippsEcke),
      blueprintKey: world.visit.details.wish.blueprintKey,
    }));
    if (outcome !== 'erlaubt') throw new Error('Bau des Wunschs fehlgeschlagen');
    return world;
  },
  attempt: (world: VisitedWorld, device: Device) => pushOutcome(world.backend, device, claimOp(world.visit.stateId)),
  manipulierte_id: (world: VisitedWorld) => denials.manipulierte_id(world, (stateId) => claimOp(stateId)),
  entkopplung: denials.entkopplung,
  verbotene_operation: denials.verbotene_operation,
} satisfies AuthorizationScenario<VisitedWorld, Dimensions>;
