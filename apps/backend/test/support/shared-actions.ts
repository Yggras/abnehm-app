import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import {
  sharedActionDecisionKey,
  sharedActionRequestKey,
  type IslandRole,
  type RequestSharedAction,
  type SharedActionDecision,
} from '@abnehm/contracts/island';
import { currentSyncSchemaVersion, type CanonicalChange, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { changeWriter, updated } from '../../src/coupling/change-writer.ts';
import type { SharedActionKind } from '../../src/coupling/shared-actions.ts';
import type { DbExecutor } from '../../src/database.ts';
import { couplingMember, island } from '../../src/db/schema/index.ts';
import { CommandRejection } from '../../src/sync/commands.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, resourceProbe, type AuthorizationScenario } from './authorization.ts';
import { coupledWorld, otherCouple, worldStart, type CoupledWorld, type WorldPerson } from './coupled-world.ts';
import { pushOutcome } from './sync.ts';

// Gemeinsame Aktionen in Tests (#107): Push-Operationen der beiden Fachbefehle, Test-Arten für die
// Art-Registry und die Negativtest-Szenarien für `registeredCommandCases`. Die echten Arten
// (Rollenwahl, Rollentausch, Deko schenken) meldet Spezifikation 4 an.

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

const createdAt = Instant.parse('2026-10-14T12:00:00.000Z');

export function requestOp(request: RequestSharedAction, overrides: { operationId?: string; businessKey?: string } = {}): CommandOperation {
  return {
    type: 'requestSharedAction',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? sharedActionRequestKey(request.actionId),
    payload: request,
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt,
  };
}

/** Antrag der Test-Art `rollentausch` mit neuer ID. */
export const roleSwapRequest = () => requestOp({ actionId: EntityId.parse(randomUUID()), type: 'rollentausch', payload: {} });

/** Die ID der Aktion eines Antrags aus `requestOp`. */
export const actionIdOf = (operation: CommandOperation) => EntityId.parse(operation.payload.actionId);

export function decideOp(
  actionId: string,
  decision: SharedActionDecision,
  overrides: { operationId?: string; businessKey?: string; timeZone?: string } = {},
): CommandOperation {
  const id = EntityId.parse(actionId);
  return {
    type: 'decideSharedAction',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? sharedActionDecisionKey(id),
    payload: { actionId: id, decision, timeZone: TimeZone.parse(overrides.timeZone ?? worldStart.timeZone) },
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt,
  };
}

/** Setzt die Rolle eines Mitglieds samt Serverversion, damit sie im Pull ankommt. */
async function assignRole(tx: DbExecutor, couplingId: string, personId: string, role: IslandRole, at: Date) {
  const [member] = await tx
    .select({ id: couplingMember.id })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, couplingId), eq(couplingMember.personId, personId)));
  await changeWriter(tx, at)({ entityType: 'coupling_member', couplingId }, async (stamp) => {
    await tx.update(couplingMember).set({ role, ...updated(stamp) }).where(eq(couplingMember.id, member!.id));
    return member!.id;
  });
}

/**
 * Test-Art auf `rollentausch`: Bei Annahme erhält der Antragsteller Bauen, der Partner Natur, und die Insel
 * schlüpft in der Zone des annehmenden Geräts, wie es Spezifikation 4 für die Rollenwahl vorsieht.
 */
export const testRoleKind: SharedActionKind<'rollentausch'> = {
  type: 'rollentausch',
  async accept(tx, { action, partnerPersonId, at, timeZone }) {
    await assignRole(tx, action.couplingId, action.requesterPersonId, 'bauen', at);
    await assignRole(tx, action.couplingId, partnerPersonId, 'natur', at);
    const [hatching] = await tx.select({ id: island.id }).from(island).where(eq(island.couplingId, action.couplingId));
    await changeWriter(tx, at)({ entityType: 'island', couplingId: action.couplingId }, async (stamp) => {
      await tx.update(island).set({ state: 'aktiv', hatchedAt: at, timeZone, ...updated(stamp) }).where(eq(island.id, hatching!.id));
      return hatching!.id;
    });
  },
};

/** Deko, die die Test-Art `deko_schenken` schon beim Beantragen ablehnt. */
export const unverschenkbar = 'unverschenkbar';

/**
 * Test-Art auf `deko_schenken`: Der Antrag scheitert für `unverschenkbar`, die Annahme scheitert immer
 * erst nach einer Änderung. So zeigt sie, dass Antrag und Entscheidung samt Zustandsänderung atomar sind.
 */
export const testGiftKind: SharedActionKind<'deko_schenken'> = {
  type: 'deko_schenken',
  async request(_tx, { action }) {
    if (action.payload.decoKey === unverschenkbar) throw new CommandRejection('conflict');
  },
  async accept(tx, { action, partnerPersonId, at }) {
    await assignRole(tx, action.couplingId, partnerPersonId, 'natur', at);
    throw new CommandRejection('conflict');
  },
};

export type SharedActionWorld = CoupledWorld & { actor: Device; actionId: EntityId };

/** Gekoppelte Welt mit angemeldeter Test-Art und einer offenen Aktion, die Anna beantragt hat. */
export async function sharedActionWorld(): Promise<SharedActionWorld> {
  const world = await coupledWorld();
  world.backend.sharedActions.registerKind(testRoleKind);
  return { ...world, actor: world.anna.device, actionId: await requested(world, world.anna) };
}

async function requested(world: CoupledWorld, requester: WorldPerson) {
  const operation = roleSwapRequest();
  if ((await pushOutcome(world.backend, requester.device, operation)) !== 'erlaubt') throw new Error('Antrag fehlgeschlagen');
  return actionIdOf(operation);
}

/** Entkoppeln über den Kern; danach hat keine Person mehr Zugriff auf die Inhalte der Kopplung. */
export async function uncoupleWorld(world: CoupledWorld, actionId: EntityId = EntityId.parse(randomUUID())) {
  return world.backend.database.db.transaction((tx) =>
    world.backend.uncoupling.uncouple(tx, {
      actionId,
      couplingId: EntityId.parse(world.couplingId),
      requesterPersonId: EntityId.parse(world.anna.personId),
      at: new Date(worldStart.instant),
    }),
  );
}

const probe = (world: SharedActionWorld, entity: 'shared_action_request' | 'shared_action_decision') =>
  resourceProbe(world.backend, policies.resource(entity, 'lesen'))(world.actor, { id: world.actionId }).then(httpOutcome);

/** Negativtest-Szenarien beider Fachbefehle für `registeredCommandCases`. */
export const sharedActionCommandScenarios = {
  requestSharedAction: {
    policy: policies.resource('shared_action_request', 'befehl'),
    arrange: sharedActionWorld,
    attempt: (world: SharedActionWorld, device: Device) => pushOutcome(world.backend, device, roleSwapRequest()),
    // Die ID einer Aktion des anderen Paars.
    manipulierte_id: async (world: SharedActionWorld) => {
      const other = await otherCouple(world);
      const actionId = await requested(other, other.anna);
      return pushOutcome(world.backend, world.actor, requestOp({ actionId, type: 'rollentausch', payload: {} }));
    },
    entkopplung: async (world: SharedActionWorld) => void (await uncoupleWorld(world)),
    verbotene_operation: (world: SharedActionWorld) => probe(world, 'shared_action_request'),
  },
  decideSharedAction: {
    policy: policies.resource('shared_action_decision', 'befehl'),
    arrange: async () => {
      const world = await sharedActionWorld();
      return { ...world, actor: world.philipp.device };
    },
    attempt: (world: SharedActionWorld, device: Device) => pushOutcome(world.backend, device, decideOp(world.actionId, 'annehmen')),
    manipulierte_id: async (world: SharedActionWorld) => {
      const other = await otherCouple(world);
      return pushOutcome(world.backend, world.actor, decideOp(await requested(other, other.anna), 'annehmen'));
    },
    entkopplung: async (world: SharedActionWorld) => void (await uncoupleWorld(world)),
    verbotene_operation: (world: SharedActionWorld) => probe(world, 'shared_action_decision'),
  },
} satisfies Record<
  string,
  AuthorizationScenario<SharedActionWorld, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation'>
>;

/** Die Datensätze einer Entität aus einem Pull, je ID der Inhalt. */
export function recordsOf(changes: readonly CanonicalChange[], entityType: string): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    changes.flatMap((change) => (change.type === 'record' && change.entityType === entityType ? [[change.entityId, change.data]] : [])),
  );
}
