import { randomUUID } from 'node:crypto';

import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { sendEncouragementKey, type SendEncouragement } from '@abnehm/contracts/partner';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, resourceProbe, type AuthorizationScenario } from './authorization.ts';
import { coupledWorld, otherCouple, uncouple, worldStart, worldToday, type CoupledWorld } from './coupled-world.ts';
import { pushOutcome } from './sync.ts';

// Anfeuern in Server-Tests (#123): die Push-Operation `sendEncouragement` und das Negativtest-Szenario
// für `registeredCommandCases`.

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

/** `sendEncouragement` mit neuer ID; `payload` ergänzt oder überschreibt Felder, auch unzulässige. */
export function sendOp(
  payload: Partial<SendEncouragement> & Record<string, unknown> = {},
  overrides: { operationId?: string; businessKey?: string } = {},
): CommandOperation & { payload: SendEncouragement } {
  const full = {
    encouragementId: EntityId.parse(randomUUID()),
    messageKey: 'du_schaffst_das',
    createdAt: Instant.parse(worldStart.instant),
    localDate: LocalDate.parse(worldToday),
    timeZone: TimeZone.parse(worldStart.timeZone),
    utcOffsetMinutes: 120,
    ...payload,
  } as SendEncouragement;
  return {
    type: 'sendEncouragement',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? sendEncouragementKey(full.encouragementId),
    payload: full,
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse(worldStart.instant),
  };
}

export type EncouragementWorld = CoupledWorld & { actor: Device };

/** Negativtest-Szenario für `registeredCommandCases`: Anna feuert Philipp an. */
export const sendEncouragementScenario = {
  policy: policies.resource('encouragement_send', 'befehl'),
  command: 'sendEncouragement',
  arrange: async (): Promise<EncouragementWorld> => {
    const world = await coupledWorld();
    return { ...world, actor: world.anna.device };
  },
  attempt: (world: EncouragementWorld, device: Device) => pushOutcome(world.backend, device, sendOp()),
  // Die ID einer Anfeuerung des anderen Paars: Sie gehört einem fremden Absender.
  manipulierte_id: async (world: EncouragementWorld) => {
    const other = await otherCouple(world);
    const theirs = sendOp();
    if ((await pushOutcome(world.backend, other.anna.device, theirs)) !== 'erlaubt') throw new Error('Anfeuerung des anderen Paars fehlgeschlagen');
    return pushOutcome(world.backend, world.actor, sendOp({ encouragementId: theirs.payload.encouragementId }));
  },
  entkopplung: uncouple,
  verbotene_operation: async (world: EncouragementWorld) =>
    httpOutcome(await resourceProbe(world.backend, policies.resource('encouragement_send', 'lesen'))(world.actor, { id: randomUUID() })),
} satisfies AuthorizationScenario<EncouragementWorld, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation'>;
