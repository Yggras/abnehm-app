import { randomUUID } from 'node:crypto';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { personTimeZoneKey } from '@abnehm/contracts/person';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { personWithSession, type AuthorizationScenario } from './authorization.ts';
import { pushOutcome } from './sync.ts';

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
    createdAt: Instant.parse('2026-10-14T12:00:00.000Z'),
  };
}

type World = { backend: TestBackend; actor: Device; personId: string };

export const personTimeZoneScenario = {
  policy: policies.resource('person', 'befehl'),
  arrange: async () => {
    const backend = await createTestBackend();
    const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
    return { backend, actor: anna.device, personId: anna.personId };
  },
  attempt: (world, device) => pushOutcome(world.backend, device, timeZoneOp(world.personId, 'America/New_York')),
  manipulierte_id: async (world) => {
    const philipp = await personWithSession(world.backend, 'philipp@example.test', 'Philipp');
    return pushOutcome(world.backend, world.actor, timeZoneOp(philipp.personId, 'America/New_York'));
  },
} satisfies AuthorizationScenario<World, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id'>;
