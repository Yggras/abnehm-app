import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { policies } from '../src/authorization/authorization.ts';
import { signUp } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, resourceProbe } from './support/authorization.ts';
import { coupledWorld, insert, probeScenario, sharingId, withOperation, withTarget } from './support/coupled-world.ts';

// Ressourcenklassen mit einem Eigentümer (Spezifikation 0, Abschnitt 11): nur der Eigentümer liest
// und ändert, Eigentumsfelder der Nutzlast begründen nichts, verbotene Operationen scheitern.

const classes = {
  'eigene veränderliche Einträge (Wassereintrag, Upsert)': authorizationCases({
    ...probeScenario(policies.resource('water_entry', 'upsert'), async (world) => ({
      actor: world.anna,
      target: { id: await insert.waterEntry(world, world.anna), claimedOwnerPersonId: world.anna.personId },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: world.target.id, claimedOwnerPersonId: world.philipp.personId })),
  }),
  'eigene veränderliche Einträge (Wassereintrag, Lesen)': authorizationCases({
    ...probeScenario(policies.resource('water_entry', 'lesen'), async (world) => ({
      actor: world.anna,
      target: { id: await insert.waterEntry(world, world.anna) },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: await insert.waterEntry(world, world.philipp) })),
  }),
  'Ziel-/Wochenplanversion (Erzeugungsbefehl)': authorizationCases({
    ...probeScenario(policies.resource('weekly_plan_version', 'befehl'), async (world) => ({
      actor: world.anna,
      target: { id: await insert.weeklyPlanVersion(world, world.anna) },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: await insert.weeklyPlanVersion(world, world.philipp) })),
    verbotene_operation: withOperation('weekly_plan_version', 'upsert'),
  }),
  'Energiebuchung (Lesen)': authorizationCases({
    ...probeScenario(policies.resource('energy_booking', 'lesen'), async (world) => ({
      actor: world.anna,
      target: { id: await insert.energyBooking(world, world.anna) },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: await insert.energyBooking(world, world.philipp) })),
    verbotene_operation: withOperation('energy_booking', 'loeschen'),
  }),
  'Partnerfreigabe (Ändern)': authorizationCases({
    ...probeScenario(policies.resource('partner_sharing', 'upsert'), async (world) => ({
      actor: world.anna,
      target: { id: await sharingId(world, world.anna, 'gewicht') },
    })),
    // Der Partner kann die Freigabe weder lesen noch ändern.
    manipulierte_id: withTarget(async (world) => ({ id: await sharingId(world, world.philipp, 'gewicht') })),
    verbotene_operation: withOperation('partner_sharing', 'loeschen'),
  }),
  'Fotofreigabe (Lesen)': authorizationCases({
    ...probeScenario(policies.resource('photo_sharing', 'lesen'), async (world) => ({
      actor: world.anna,
      target: { id: await sharingId(world, world.anna, 'fotos') },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: await sharingId(world, world.philipp, 'fotos') })),
    verbotene_operation: withOperation('photo_sharing', 'befehl'),
  }),
  'Push-Installation (eigene Installation)': authorizationCases({
    ...probeScenario(policies.resource('push_installation', 'upsert'), async (world) => ({
      actor: world.anna,
      target: { id: await insert.pushInstallation(world, world.anna) },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: await insert.pushInstallation(world, world.philipp) })),
    verbotene_operation: withOperation('push_installation', 'loeschen'),
  }),
};

for (const [resourceClass, cases] of Object.entries(classes)) {
  describe(resourceClass, () => {
    for (const { name, run } of cases) it(name, run);
  });
}

describe('Eigentum aus Postgres', () => {
  it('verweigert eine fremde und eine unbekannte ID mit derselben Antwort', async () => {
    const world = await coupledWorld();
    const probe = resourceProbe(world.backend, policies.resource('water_entry', 'lesen'));

    const foreign = await probe(world.anna.device, { id: await insert.waterEntry(world, world.philipp) });
    const unknown = await probe(world.anna.device, { id: randomUUID() });
    const malformed = await probe(world.anna.device, { id: 'kein-uuid' });

    for (const reply of [foreign, unknown, malformed]) {
      expect({ status: reply.status, body: reply.body }).toEqual({ status: 403, body: { code: 'forbidden', retryable: false } });
    }
  });

  it('legt eine neue Ressource nur für die Person der Sitzung an', async () => {
    const world = await coupledWorld();
    const probe = resourceProbe(world.backend, policies.resource('water_entry', 'upsert'));

    const reply = await probe(world.anna.device, { id: randomUUID() });

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ exists: false, ownerPersonId: world.anna.personId, couplingId: null, partnerPersonId: null });
  });

  it('lässt den Client keine Ressourcen anlegen, die der Server erzeugt', async () => {
    const world = await coupledWorld();

    for (const entity of ['person', 'partner_sharing', 'photo_sharing', 'photo_draft', 'island_event_state'] as const) {
      const policy = entity === 'island_event_state' ? policies.resource(entity, 'befehl') : policies.resource(entity, 'upsert');
      expect(httpOutcome(await resourceProbe(world.backend, policy)(world.anna.device, { id: randomUUID() })), entity).toBe('verweigert');
    }
  });

  it('liest die eigene Person, nie die des Partners', async () => {
    const world = await coupledWorld();
    const probe = resourceProbe(world.backend, policies.resource('person', 'lesen'));

    expect(httpOutcome(await probe(world.anna.device, { id: world.anna.personId }))).toBe('erlaubt');
    expect(httpOutcome(await probe(world.anna.device, { id: world.philipp.personId }))).toBe('verweigert');
  });

  it('verweigert Ressourcenoperationen vor dem Bootstrap, weil die Sitzung noch keine Person hat', async () => {
    const world = await coupledWorld();
    const { device } = await signUp(world.backend, 'ohne-person@example.test');

    const outcome = httpOutcome(await resourceProbe(world.backend, policies.resource('water_entry', 'upsert'))(device, { id: randomUUID() }));

    expect(outcome).toBe('verweigert');
  });
});
