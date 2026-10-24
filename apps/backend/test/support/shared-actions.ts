import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { expect } from 'vitest';
import { z } from 'zod';

import { EntityId, Instant } from '@abnehm/contracts/base';
import {
  sharedActionDecisionKey,
  sharedActionRequestKey,
  type IslandRole,
  type RequestSharedAction,
  type SharedActionDecision,
} from '@abnehm/contracts/island';
import { currentSyncSchemaVersion, type CanonicalChange, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import type { SharedActionKind } from '../../src/coupling/shared-actions.ts';
import type { DbExecutor } from '../../src/database.ts';
import { couplingMember } from '../../src/db/schema/index.ts';
import { CommandRejection } from '../../src/sync/commands.ts';
import { nextServerVersion, recordChange } from '../../src/sync/change-log.ts';
import type { TestBackend } from './app.ts';
import { call, type Device } from './auth-client.ts';
import { httpOutcome, resourceProbe, type AuthorizationScenario, type Outcome } from './authorization.ts';
import { coupledWorld, otherCouple, worldStart, type CoupledWorld, type WorldPerson } from './coupled-world.ts';
import { pushRaw } from './sync.ts';

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

export function decideOp(actionId: string, decision: SharedActionDecision, overrides: { operationId?: string; businessKey?: string } = {}): CommandOperation {
  const id = EntityId.parse(actionId);
  return {
    type: 'decideSharedAction',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? sharedActionDecisionKey(id),
    payload: { actionId: id, decision },
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt,
  };
}

/** Setzt die Rolle eines Mitglieds samt Serverversion, damit sie im Pull ankommt. */
async function assignRole(tx: DbExecutor, couplingId: string, personId: string, role: IslandRole, at: Date) {
  const serverVersion = await nextServerVersion(tx);
  const [member] = await tx
    .update(couplingMember)
    .set({ role, updatedAt: at, serverVersion })
    .where(and(eq(couplingMember.couplingId, couplingId), eq(couplingMember.personId, personId)))
    .returning({ id: couplingMember.id });
  await recordChange(tx, { position: serverVersion, entityType: 'coupling_member', entityId: member!.id, operation: 'upsert', couplingId, createdAt: at });
}

/** Test-Art auf `rollentausch`: Bei Annahme erhält der Antragsteller Bauen, der Partner Natur. */
export const testRoleKind: SharedActionKind<'rollentausch'> = {
  type: 'rollentausch',
  payload: z.strictObject({}),
  async accept(tx, { action, partnerPersonId, at }) {
    await assignRole(tx, action.couplingId, action.requesterPersonId, 'bauen', at);
    await assignRole(tx, action.couplingId, partnerPersonId, 'natur', at);
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
  payload: z.strictObject({ islandObjectId: EntityId, decoKey: z.string() }),
  async request(_tx, { action }) {
    if (action.payload.decoKey === unverschenkbar) throw new CommandRejection('conflict');
  },
  async accept(tx, { action, partnerPersonId, at }) {
    await assignRole(tx, action.couplingId, partnerPersonId, 'natur', at);
    throw new CommandRejection('conflict');
  },
};

/** Kopplung über die echten Einladungsabläufe, damit Kopplung und Mitglieder per Pull ankommen. */
export async function coupleByInvitation(backend: TestBackend, inviter: Device, invitee: Device) {
  const created = await call(backend, 'POST', '/v1/invitations', inviter, { requestId: randomUUID() });
  const { code } = created.body as { code: string };
  const accepted = await call(backend, 'POST', '/v1/invitations/accept', invitee, { requestId: randomUUID(), code });
  expect(accepted.status).toBe(200);
  return accepted.body as { couplingId: string; reactivated: boolean };
}

/** Ergebnis eines Pushs als Ausgang der Autorisierung; `forbidden` ist die einzige Verweigerung. */
export async function commandOutcome(backend: TestBackend, device: Device, operation: CommandOperation): Promise<Outcome> {
  const reply = await pushRaw(backend, device, [operation]);
  if (reply.status !== 200) return httpOutcome(reply);
  const [result] = (reply.body as { results: { type: string; error?: { code: string } }[] }).results;
  if (result?.type === 'applied') return 'erlaubt';
  return result?.error?.code === 'forbidden' ? 'verweigert' : `unerwartet: ${JSON.stringify(result)}`;
}

export type SharedActionWorld = CoupledWorld & { actor: Device; actionId: EntityId };

/** Gekoppelte Welt mit angemeldeter Test-Art und einer offenen Aktion, die Anna beantragt hat. */
export async function sharedActionWorld(): Promise<SharedActionWorld> {
  const world = await coupledWorld();
  world.backend.sharedActions.registerKind(testRoleKind);
  return { ...world, actor: world.anna.device, actionId: await requested(world, world.anna) };
}

async function requested(world: CoupledWorld, requester: WorldPerson) {
  const actionId = EntityId.parse(randomUUID());
  expect(await commandOutcome(world.backend, requester.device, requestOp({ actionId, type: 'rollentausch', payload: {} }))).toBe('erlaubt');
  return actionId;
}

/** Entkoppeln über den Kern; danach hat keine Person mehr Zugriff auf die Inhalte der Kopplung. */
export async function uncoupleWorld(world: CoupledWorld) {
  await world.backend.database.db.transaction((tx) =>
    world.backend.uncoupling.uncouple(tx, {
      actionId: EntityId.parse(randomUUID()),
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
    attempt: (world: SharedActionWorld, device: Device) =>
      commandOutcome(world.backend, device, requestOp({ actionId: EntityId.parse(randomUUID()), type: 'rollentausch', payload: {} })),
    // Die ID einer Aktion des anderen Paars.
    manipulierte_id: async (world: SharedActionWorld) => {
      const other = await otherCouple(world);
      const actionId = await requested(other, other.anna);
      return commandOutcome(world.backend, world.actor, requestOp({ actionId, type: 'rollentausch', payload: {} }));
    },
    entkopplung: uncoupleWorld,
    verbotene_operation: (world: SharedActionWorld) => probe(world, 'shared_action_request'),
  },
  decideSharedAction: {
    policy: policies.resource('shared_action_decision', 'befehl'),
    arrange: async () => {
      const world = await sharedActionWorld();
      return { ...world, actor: world.philipp.device };
    },
    attempt: (world: SharedActionWorld, device: Device) => commandOutcome(world.backend, device, decideOp(world.actionId, 'annehmen')),
    manipulierte_id: async (world: SharedActionWorld) => {
      const other = await otherCouple(world);
      return commandOutcome(world.backend, world.actor, decideOp(await requested(other, other.anna), 'annehmen'));
    },
    entkopplung: uncoupleWorld,
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
