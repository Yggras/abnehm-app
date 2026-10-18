import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { policies } from '../src/authorization/authorization.ts';
import { authorizationCases, httpOutcome, resourceProbe } from './support/authorization.ts';
import { coupledWorld, insert, otherCouple, probeScenario, uncouple, withOperation, withTarget } from './support/coupled-world.ts';

// Ressourcenklassen der Kopplung (Spezifikation 0, Abschnitt 11): nur aktive Mitglieder, Schreiben
// nur über Fachbefehle; nach der Entkopplung bleiben nur inhaltsfreie Widerrufsdaten lesbar.

const classes = {
  'Kopplungsinhalte (Insel lesen)': authorizationCases({
    ...probeScenario(policies.resource('island', 'lesen'), async (world) => ({ actor: world.philipp, target: { id: world.islandId } }), {
      bothMembers: true,
    }),
    manipulierte_id: withTarget(async (world) => ({ id: (await otherCouple(world)).islandId })),
    entkopplung: uncouple,
    verbotene_operation: withOperation('island', 'upsert'),
  }),
  'Kopplungsinhalte (Fachbefehl auf der Kopplung)': authorizationCases({
    ...probeScenario(policies.resource('coupling', 'befehl'), async (world) => ({ actor: world.anna, target: { id: world.couplingId } }), {
      bothMembers: true,
    }),
    manipulierte_id: withTarget(async (world) => ({ id: (await otherCouple(world)).couplingId })),
    entkopplung: uncouple,
    verbotene_operation: withOperation('coupling', 'loeschen'),
  }),
  'Inselfortschritt': authorizationCases({
    ...probeScenario(
      policies.resource('island_progress', 'lesen'),
      async (world) => ({ actor: world.anna, target: { id: await insert.islandProgress(world) } }),
      { bothMembers: true },
    ),
    manipulierte_id: withTarget(async (world) => ({ id: await insert.islandProgress(await otherCouple(world)) })),
    entkopplung: uncouple,
    verbotene_operation: withOperation('island_progress', 'upsert'),
  }),
  'Anfeuern (Lesen durch den Empfänger)': authorizationCases({
    ...probeScenario(
      policies.resource('encouragement', 'lesen'),
      async (world) => ({ actor: world.philipp, target: { id: await insert.encouragement(world, world.anna, world.philipp) } }),
      { bothMembers: true },
    ),
    manipulierte_id: withTarget(async (world) => {
      const other = await otherCouple(world);
      return { id: await insert.encouragement(other, other.anna, other.philipp) };
    }),
    entkopplung: uncouple,
    verbotene_operation: withOperation('encouragement', 'upsert'),
  }),
  'Anfeuern (Senden)': authorizationCases({
    ...probeScenario(policies.resource('encouragement_send', 'befehl'), async (world) => ({
      actor: world.anna,
      target: { id: await insert.encouragement(world, world.anna, world.philipp) },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: randomUUID(), claimedOwnerPersonId: world.philipp.personId })),
    entkopplung: uncouple,
    verbotene_operation: withOperation('encouragement_send', 'lesen'),
  }),
  'Revocation-Notice': authorizationCases({
    ...probeScenario(policies.resource('revocation_notice', 'lesen'), async (world) => ({
      actor: world.philipp,
      target: { id: await insert.revocationNotice(world, world.philipp) },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: await insert.revocationNotice(world, world.anna) })),
    verbotene_operation: withOperation('revocation_notice', 'upsert'),
  }),
  'Archivstatus der Kopplung': authorizationCases({
    ...probeScenario(
      policies.resource('coupling_archive_status', 'lesen'),
      async (world) => ({ actor: world.anna, target: { id: world.couplingId } }),
      { bothMembers: true },
    ),
    manipulierte_id: withTarget(async (world) => ({ id: (await otherCouple(world)).couplingId })),
    verbotene_operation: withOperation('coupling_archive_status', 'befehl'),
  }),
};

for (const [resourceClass, cases] of Object.entries(classes)) {
  describe(resourceClass, () => {
    for (const { name, run } of cases) it(name, run);
  });
}

describe('Anfeuern', () => {
  it('sendet nur an den Partner aus der Kopplung, nie an eine mitgeschickte Empfänger-ID', async () => {
    const world = await coupledWorld();
    const send = resourceProbe(world.backend, policies.resource('encouragement_send', 'befehl'));

    const reply = await send(world.anna.device, { id: randomUUID(), claimedOwnerPersonId: world.anna.personId });

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({
      exists: false,
      ownerPersonId: world.anna.personId,
      couplingId: world.couplingId,
      partnerPersonId: world.philipp.personId,
    });
    expect(httpOutcome(await send(world.anna.device, { id: randomUUID(), claimedOwnerPersonId: world.philipp.personId }))).toBe('verweigert');
  });

  it('sendet ohne aktive Kopplung nicht', async () => {
    const world = await coupledWorld();
    await uncouple(world);

    const reply = await resourceProbe(world.backend, policies.resource('encouragement_send', 'befehl'))(world.anna.device, { id: randomUUID() });

    expect(httpOutcome(reply)).toBe('verweigert');
  });

  it('lässt den Absender dasselbe Senden wiederholen, damit der Fachbefehl idempotent bleibt', async () => {
    const world = await coupledWorld();
    const id = await insert.encouragement(world, world.anna, world.philipp);
    const send = resourceProbe(world.backend, policies.resource('encouragement_send', 'befehl'));

    const retry = await send(world.anna.device, { id });

    expect(retry.body).toMatchObject({ exists: true, partnerPersonId: world.philipp.personId });
    expect(httpOutcome(await send(world.philipp.device, { id }))).toBe('verweigert');
  });

  it('lässt nur den Empfänger danken, nicht den Absender', async () => {
    const world = await coupledWorld();
    const id = await insert.encouragement(world, world.anna, world.philipp);
    const thank = resourceProbe(world.backend, policies.resource('encouragement', 'befehl'));

    expect(httpOutcome(await thank(world.philipp.device, { id }))).toBe('erlaubt');
    expect(httpOutcome(await thank(world.anna.device, { id }))).toBe('verweigert');
  });
});

describe('Nach der Entkopplung', () => {
  it('bleiben Revocation-Notice und Archivstatus lesbar, alle Inhalte gesperrt', async () => {
    const world = await coupledWorld();
    const notice = await insert.revocationNotice(world, world.philipp);
    await uncouple(world);
    const read = (entity: Parameters<typeof policies.resource>[0], id: string) =>
      resourceProbe(world.backend, policies.resource(entity, 'lesen'))(world.philipp.device, { id }).then(httpOutcome);

    expect(await read('revocation_notice', notice)).toBe('erlaubt');
    expect(await read('coupling_archive_status', world.couplingId)).toBe('erlaubt');
    expect(await read('coupling', world.couplingId)).toBe('verweigert');
    expect(await read('island', world.islandId)).toBe('verweigert');
  });
});
