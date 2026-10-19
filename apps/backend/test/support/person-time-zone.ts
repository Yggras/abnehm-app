import { randomUUID } from 'node:crypto';

import { EntityId } from '@abnehm/contracts/base';
import { personTimeZoneKey } from '@abnehm/contracts/person';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, type AuthorizationScenario } from './authorization.ts';
import { pushRaw } from './sync.ts';

// `updatePersonTimeZone` im Push (#110): Operation und Negativtest-Szenario für das Gerüst aus
// `registeredCommandCases`, das jeden registrierten Fachbefehl verlangt.

export function timeZoneOp(personId: string, timeZone: string, changeId: string = randomUUID()): Extract<OutboxOperation, { businessKey: string }> {
  return {
    type: 'updatePersonTimeZone',
    operationId: EntityId.parse(randomUUID()),
    businessKey: personTimeZoneKey(EntityId.parse(personId), EntityId.parse(changeId)),
    payload: { timeZone },
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: '2026-10-14T12:00:00.000Z' as never,
  };
}

type World = { backend: TestBackend; actor: Device; personId: string };

/** Ergebnis eines Pushs als Ausgang der Autorisierung; `forbidden` ist die einzige Verweigerung. */
async function outcomeOf(backend: TestBackend, device: Device, operation: OutboxOperation) {
  const reply = await pushRaw(backend, device, [operation]);
  if (reply.status !== 200) return httpOutcome(reply);
  const [result] = (reply.body as { results: { type: string; error?: { code: string } }[] }).results;
  if (result?.type === 'applied') return 'erlaubt' as const;
  return result?.error?.code === 'forbidden' ? 'verweigert' as const : `unerwartet: ${JSON.stringify(result)}` as const;
}

export const personTimeZoneScenario = {
  policy: policies.resource('person', 'befehl'),
  arrange: async () => {
    const backend = await createTestBackend();
    const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
    return { backend, actor: anna.device, personId: anna.personId };
  },
  attempt: (world, device) => outcomeOf(world.backend, device, timeZoneOp(world.personId, 'America/New_York')),
  manipulierte_id: async (world) => {
    const philipp = await personWithSession(world.backend, 'philipp@example.test', 'Philipp');
    return outcomeOf(world.backend, world.actor, timeZoneOp(philipp.personId, 'America/New_York'));
  },
} satisfies AuthorizationScenario<World, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id'>;
