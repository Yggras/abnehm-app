import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { createTestClock } from '@abnehm/clock/testing';
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
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, resourceProbe, type AuthorizationScenario } from './authorization.ts';
import { coupleByInvitation, coupledWorld, otherCouple, worldStart, type CoupledWorld, type WorldPerson } from './coupled-world.ts';
import { pullAll, pushOutcome } from './sync.ts';

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

/** Entkoppeln über den Kern in eigener Transaktion, wie es `requestUncoupling` (Spezifikation 5) tun wird. */
export function uncoupleAs(
  backend: TestBackend,
  { couplingId, requesterPersonId, actionId = randomUUID(), at = new Date(worldStart.instant) }: { couplingId: string; requesterPersonId: string; actionId?: string; at?: Date },
) {
  return backend.database.db.transaction((tx) =>
    backend.uncoupling.uncouple(tx, {
      actionId: EntityId.parse(actionId),
      couplingId: EntityId.parse(couplingId),
      requesterPersonId: EntityId.parse(requesterPersonId),
      at,
    }),
  );
}

/** Anna entkoppelt; danach hat keine Person mehr Zugriff auf die Inhalte der Kopplung. */
export const uncoupleWorld = (world: CoupledWorld) => uncoupleAs(world.backend, { couplingId: world.couplingId, requesterPersonId: world.anna.personId });

/**
 * Anna und Philipp, gekoppelt über die echte Einladung, mit beiden Test-Arten (oder den genannten) und dem
 * Cursor nach dem ersten Pull; der materialisiert auch den Partner-Tageszielstatus beider Personen. Die
 * Rollenwahl meldet `createBackend` selbst an (#180).
 */
export async function invitedCouple({ kinds = [testRoleKind, testGiftKind] }: { kinds?: readonly (typeof testRoleKind | typeof testGiftKind)[] } = {}) {
  const backend = await createTestBackend({ clock: createTestClock(worldStart) });
  for (const kind of kinds) backend.sharedActions.registerKind(kind);
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const { couplingId } = await coupleByInvitation(backend, anna.device, philipp.device);
  const cursors = { anna: (await pullAll(backend, anna.device)).cursor, philipp: (await pullAll(backend, philipp.device)).cursor };
  return { backend, anna, philipp, couplingId: EntityId.parse(couplingId), cursors };
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
