import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { sendEncouragementKey, type SendEncouragement } from '@abnehm/contracts/partner';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { encouragement } from '../../src/db/schema/index.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, type AuthorizationScenario } from './authorization.ts';
import { coupledWorld, otherCouple, uncouple, worldStart, worldToday, type CoupledWorld } from './coupled-world.ts';
import { pushOutcome, pushRaw } from './sync.ts';

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
  // Kein generisches Update (Spezifikation 5, Abschnitt 10): Ein Upsert der eigenen, gesendeten Anfeuerung,
  // etwa mit Danke-Zeitpunkt oder anderem Empfänger, lehnt der Sync ab; sie bleibt unverändert.
  verbotene_operation: async (world: EncouragementWorld) => {
    const sent = sendOp();
    if ((await pushOutcome(world.backend, world.actor, sent)) !== 'erlaubt') throw new Error('Anfeuerung fehlgeschlagen');
    const { encouragementId, ...payload } = sent.payload;
    const reply = await pushRaw(world.backend, world.actor, [{
      type: 'upsert_entity', operationId: EntityId.parse(randomUUID()), entityType: 'encouragement', entityId: encouragementId,
      payload: { ...payload, recipientPersonId: world.anna.personId, thankedAt: worldStart.instant }, knownServerVersion: null,
      schemaVersion: currentSyncSchemaVersion, createdAt: Instant.parse(worldStart.instant),
    }]);
    if (reply.status !== 200) return httpOutcome(reply);
    const [result] = (reply.body as { results: { type: string; error?: { code: string } }[] }).results;
    const [row] = await world.backend.database.db.select().from(encouragement).where(eq(encouragement.id, encouragementId));
    if (row?.thankedAt !== null || row.recipientPersonId !== world.philipp.personId) return `unerwartet: Anfeuerung geändert` as const;
    return result?.error?.code === 'forbidden' ? 'verweigert' : (`unerwartet: ${JSON.stringify(result)}` as const);
  },
} satisfies AuthorizationScenario<EncouragementWorld, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation'>;
