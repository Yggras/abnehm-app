import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PullResponse, PushResponse, type OutboxOperation, type PushResult } from '@abnehm/contracts/sync';

import { policies } from '../src/authorization/authorization.ts';
import { createTestBackend } from './support/app.ts';
import { signUp, type Device } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, personWithSession, type AuthorizationWorld, type Outcome } from './support/authorization.ts';
import { deleteOp, installationB, pullRaw, push, pushRaw, testWaterEntity, upsertOp, water } from './support/sync.ts';

// Push und Pull über das Negativtest-Gerüst der Autorisierung (#98, #99). Die Endpunkte verlangen eine
// Sitzung; jede einzelne Operation läuft durch die Regel ihrer Ressource. Installationskennung und
// Seitentoken begründen nie Zugriff.

type SyncWorld = AuthorizationWorld & {
  annaPersonId: string;
  entry: string;
  foreignEntry: string;
  foreignPersonId: string;
};

async function arrange(): Promise<SyncWorld> {
  const backend = await createTestBackend();
  backend.sync.registerEntity(testWaterEntity);
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const [entry, foreignEntry] = [randomUUID(), randomUUID()];
  await push(backend, anna.device, [upsertOp(entry, water(250))]);
  await push(backend, philipp.device, [upsertOp(foreignEntry, water(100))]);
  return { backend, actor: anna.device, annaPersonId: anna.personId, entry, foreignEntry, foreignPersonId: philipp.personId, alsoForeign: [philipp.device] };
}

/** Ergebnis einer einzelnen Operation: übernommen, generisch verweigert oder etwas anderes. */
async function operationOutcome(world: SyncWorld, device: Device, operation: OutboxOperation): Promise<Outcome> {
  const reply = await pushRaw(world.backend, device, [operation]);
  if (reply.status !== 200) return httpOutcome(reply);
  const [result] = PushResponse.parse(reply.body).results as [PushResult];
  if (result.type === 'applied' || result.type === 'already_applied') return 'erlaubt';
  if (result.error.code === 'forbidden' && result.canonical.type === 'absent') return 'verweigert';
  return `unerwartet: ${JSON.stringify(result)}`;
}

/** Ob ein vollständiger Pull die Entität liefert. */
async function pullOutcome(world: SyncWorld, device: Device, entityId: string, options: Parameters<typeof pullRaw>[2] = {}): Promise<Outcome> {
  const reply = await pullRaw(world.backend, device, options);
  if (reply.status !== 200) return httpOutcome(reply);
  return PullResponse.parse(reply.body).changes.some((change) => change.entityId === entityId) ? 'erlaubt' : 'verweigert';
}

const cases = {
  'POST /v1/sync/push': authorizationCases({
    policy: policies.authenticated(),
    route: { method: 'POST', path: '/v1/sync/push' },
    arrange,
    attempt: async (world, device) => httpOutcome(await pushRaw(world.backend, device, [upsertOp(randomUUID(), water(250))])),
  }),
  'POST /v1/sync/pull': authorizationCases({
    policy: policies.authenticated(),
    route: { method: 'POST', path: '/v1/sync/pull' },
    arrange,
    attempt: async (world, device) => httpOutcome(await pullRaw(world.backend, device)),
  }),
  'Push: eigenen Eintrag ändern': authorizationCases({
    policy: policies.resource('water_entry', 'upsert'),
    arrange,
    attempt: (world, device) => operationOutcome(world, device, upsertOp(world.entry, water(300))),
    // Fremde ID, und eigene ID mit fremdem Eigentumsfeld.
    manipulierte_id: async (world) => {
      const foreignId = await operationOutcome(world, world.actor, upsertOp(world.foreignEntry, water(300)));
      const foreignOwner = await operationOutcome(world, world.actor, upsertOp(world.entry, { ...water(300), personId: world.foreignPersonId }));
      return foreignId === foreignOwner ? foreignId : `unerwartet: ${foreignId} / ${foreignOwner}`;
    },
  }),
  'Push: eigenen Eintrag löschen': authorizationCases({
    policy: policies.resource('water_entry', 'loeschen'),
    arrange,
    attempt: (world, device) => operationOutcome(world, device, deleteOp(world.entry)),
    manipulierte_id: (world) => operationOutcome(world, world.actor, deleteOp(world.foreignEntry)),
  }),
  'Push: eigene Person ändern': authorizationCases({
    policy: policies.resource('person', 'upsert'),
    arrange,
    attempt: (world, device) => operationOutcome(world, device, upsertOp(world.annaPersonId, personUpsert(world.annaPersonId), { entityType: 'person' })),
    manipulierte_id: (world) =>
      operationOutcome(world, world.actor, upsertOp(world.foreignPersonId, personUpsert(world.foreignPersonId), { entityType: 'person' })),
  }),
  'Pull: eigenen Eintrag lesen': authorizationCases({
    policy: policies.resource('water_entry', 'lesen'),
    arrange,
    attempt: (world, device) => pullOutcome(world, device, world.entry),
    // Fremde Installationskennung und geschmiedetes Seitentoken ab Position 0 liefern nichts Fremdes.
    manipulierte_id: async (world) => {
      const viaInstallation = await pullOutcome(world, world.actor, world.foreignEntry, { installationId: installationB });
      const token = `v1.${world.annaPersonId}.999999.0`;
      const viaToken = await pullRaw(world.backend, world.actor, { pageToken: token });
      return viaInstallation === 'verweigert' && !JSON.stringify(viaToken.body).includes(world.foreignEntry) ? 'verweigert' : 'erlaubt';
    },
  }),
};

function personUpsert(id: string) {
  return {
    id,
    displayName: 'Neu',
    calculationSex: null,
    birthDate: null,
    heightCm: null,
    activityLevel: null,
    pregnantOrBreastfeeding: null,
    knownEatingDisorder: null,
    disclaimerAcceptedAt: null,
    onboardingStatus: 'begonnen',
    onboardingCompletedAt: null,
    goalWeightReachedG: null,
    goalWeightReachedAt: null,
  };
}

for (const [name, list] of Object.entries(cases)) {
  describe(name, () => {
    for (const { name: caseName, run } of list) it(caseName, run);
  });
}

describe('Sync ohne Person', () => {
  it('verweigert Push und Pull eines Kontos vor dem Bootstrap generisch', async () => {
    const backend = await createTestBackend();
    const { device } = await signUp(backend, 'anna@example.test');
    expect(await pushRaw(backend, device, [upsertOp(randomUUID(), water(250))])).toMatchObject({ status: 403, body: { code: 'forbidden' } });
    expect(await pullRaw(backend, device)).toMatchObject({ status: 403, body: { code: 'forbidden' } });
  });
});
