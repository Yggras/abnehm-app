import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { Instant } from '@abnehm/contracts/base';

import { policies } from '../src/authorization/authorization.ts';
import { mealPhoto } from '../src/db/schema/index.ts';
import { securityLogEntries } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, resourceProbe } from './support/authorization.ts';
import {
  coupledWorld,
  insert,
  otherCouple,
  probeScenario,
  setPhotoSharing,
  setSharing,
  uncouple,
  withOperation,
  withTarget,
  type CoupledWorld,
} from './support/coupled-world.ts';

// Partnerprojektionen und Partnerfotos (Spezifikation 0, Abschnitte 5 und 11): nur die bezeichnete
// empfangende Person bei aktiver Kopplung und passender Freigabe; Fotos nach den Sichtbarkeitsregeln,
// und jeder verweigerte Fotozugriff landet im Sicherheitslog.

const classes = {
  'Partner-Zusammenfassung': authorizationCases({
    ...probeScenario(policies.resource('partner_summary', 'lesen'), async (world) => ({
      actor: world.philipp,
      target: { id: await insert.partnerSummary(world, world.anna, world.philipp, 'wasser') },
    })),
    // An Anna adressiert, also nicht für Philipp, obwohl es seine eigenen Daten sind.
    manipulierte_id: withTarget(async (world) => ({ id: await insert.partnerSummary(world, world.philipp, world.anna, 'wasser') })),
    entkopplung: uncouple,
    freigabeentzug: (world) => setSharing(world, world.anna, 'wasser', 'privat'),
    verbotene_operation: withOperation('partner_summary', 'upsert'),
  }),
  'Partner-Tageszielstatus': authorizationCases({
    ...probeScenario(policies.resource('partner_daily_goal_status', 'lesen'), async (world) => ({
      actor: world.philipp,
      target: { id: await insert.partnerDailyGoalStatus(world, world.anna, world.philipp) },
    })),
    manipulierte_id: withTarget(async (world) => ({ id: await insert.partnerDailyGoalStatus(world, world.philipp, world.anna) })),
    entkopplung: uncouple,
    verbotene_operation: withOperation('partner_daily_goal_status', 'upsert'),
  }),
  'Partnerfoto (Bildabruf)': authorizationCases({
    // Das andere Mitglied ist hier die Eigentümerin und sieht ihr Foto selbst.
    ...probeScenario(
      policies.resource('meal_photo', 'lesen'),
      async (world) => ({ actor: world.philipp, target: { id: await insert.mealPhoto(world, world.anna) } }),
      { bothMembers: true },
    ),
    manipulierte_id: withTarget(async (world) => {
      const other = await otherCouple(world);
      return { id: await insert.mealPhoto(other, other.anna) };
    }),
    entkopplung: uncouple,
    freigabeentzug: (world) => setPhotoSharing(world, world.anna, 'privat'),
    verbotene_operation: withOperation('meal_photo', 'befehl'),
  }),
  'Partnerfoto (Fotoliste)': authorizationCases({
    // Beide Mitglieder sehen die Fotoliste des jeweils anderen.
    ...probeScenario(policies.resource('partner_photo_list', 'lesen'), async (world) => ({ actor: world.philipp, target: {} }), {
      bothMembers: true,
    }),
    entkopplung: uncouple,
    freigabeentzug: (world) => setPhotoSharing(world, world.anna, 'privat'),
    verbotene_operation: withOperation('partner_photo_list', 'upsert'),
  }),
};

for (const [resourceClass, cases] of Object.entries(classes)) {
  describe(resourceClass, () => {
    for (const { name, run } of cases) it(name, run);
  });
}

describe('Partner-Zusammenfassung', () => {
  it('hängt an der Freigabe genau ihres Bereichs', async () => {
    const world = await coupledWorld();
    const water = await insert.partnerSummary(world, world.anna, world.philipp, 'wasser');
    const weight = await insert.partnerSummary(world, world.anna, world.philipp, 'gewicht');
    await setSharing(world, world.anna, 'gewicht', 'privat');
    const read = resourceProbe(world.backend, policies.resource('partner_summary', 'lesen'));

    expect(httpOutcome(await read(world.philipp.device, { id: water }))).toBe('erlaubt');
    expect(httpOutcome(await read(world.philipp.device, { id: weight }))).toBe('verweigert');
  });
});

describe('Sichtbarkeit von Partnerfotos', () => {
  const view = (world: CoupledWorld, id: string) =>
    resourceProbe(world.backend, policies.resource('meal_photo', 'lesen'))(world.philipp.device, { id }).then(httpOutcome);

  it('zeigt der Eigentümerin ihr Foto auch ohne Teilen und ohne Eintrag von heute', async () => {
    const world = await coupledWorld();
    const id = await insert.mealPhoto(world, world.anna, { shared: false, localDate: '2026-10-13' });

    const reply = await resourceProbe(world.backend, policies.resource('meal_photo', 'lesen'))(world.anna.device, { id });

    expect(httpOutcome(reply)).toBe('erlaubt');
  });

  it.each([
    ['vom Teilen ausgenommen', { shared: false }],
    ['nur mit einem Eintrag von gestern', { localDate: '2026-10-13' }],
  ])('verweigert dem Partner ein Foto %s', async (_name, options) => {
    const world = await coupledWorld();

    expect(await view(world, await insert.mealPhoto(world, world.anna, options))).toBe('verweigert');
  });

  it('verweigert dem Partner ein gelöschtes Foto', async () => {
    const world = await coupledWorld();
    const id = await insert.mealPhoto(world, world.anna);
    await world.backend.database.db.update(mealPhoto).set({ deletedAt: new Date('2026-10-14T12:30:00.000Z') }).where(eq(mealPhoto.id, id));

    expect(await view(world, id)).toBe('verweigert');
  });

  it('rechnet den Tag in der Zeitzone der Eigentümerin: nach Mitternacht in Berlin ist das Foto von gestern', async () => {
    const world = await coupledWorld();
    const id = await insert.mealPhoto(world, world.anna);
    expect(await view(world, id)).toBe('erlaubt');

    world.clock.set(Instant.parse('2026-10-14T22:30:00.000Z'));

    expect(await view(world, id)).toBe('verweigert');
  });

  it('protokolliert jeden verweigerten Fotozugriff ohne Foto- oder Ressourcendaten', async () => {
    const world = await coupledWorld();
    const hidden = await insert.mealPhoto(world, world.anna, { shared: false });
    await view(world, hidden);
    await setPhotoSharing(world, world.anna, 'privat');
    await resourceProbe(world.backend, policies.resource('partner_photo_list', 'lesen'))(world.philipp.device);

    const denials = (await securityLogEntries(world.backend)).filter((entry) => entry.eventType === 'fotozugriff_verweigert');

    const denial = (operation: string) => ({
      eventType: 'fotozugriff_verweigert',
      accountId: world.philipp.accountId,
      details: { accountId: world.philipp.accountId, operation },
    });
    expect(denials).toEqual([denial('bildabruf'), denial('fotoliste')]);
  });

  it('protokolliert auch Fotozugriffe, die vor der Regel scheitern, etwa mit fremdem Eigentumsfeld', async () => {
    const world = await coupledWorld();
    const id = await insert.mealPhoto(world, world.anna);

    const reply = await resourceProbe(world.backend, policies.resource('meal_photo', 'lesen'))(world.philipp.device, {
      id,
      claimedOwnerPersonId: world.anna.personId,
    });

    expect(httpOutcome(reply)).toBe('verweigert');
    expect((await securityLogEntries(world.backend)).map((entry) => entry.eventType)).toContain('fotozugriff_verweigert');
  });

  it('löscht kein unbekanntes Foto, legt aber ein neues der Eigentümerin an', async () => {
    const world = await coupledWorld();
    const unknown = { id: randomUUID() };

    expect(httpOutcome(await resourceProbe(world.backend, policies.resource('meal_photo', 'loeschen'))(world.anna.device, unknown))).toBe('verweigert');
    expect(httpOutcome(await resourceProbe(world.backend, policies.resource('meal_photo', 'upsert'))(world.anna.device, unknown))).toBe('erlaubt');
  });

  it('liefert für die Fotoliste die Partnerin als Eigentümerin, ohne ID aus dem Client', async () => {
    const world = await coupledWorld();

    const reply = await resourceProbe(world.backend, policies.resource('partner_photo_list', 'lesen'))(world.philipp.device, {
      id: world.philipp.personId,
    });

    expect(reply.body).toEqual({
      exists: true,
      ownerPersonId: world.anna.personId,
      couplingId: world.couplingId,
      partnerPersonId: world.anna.personId,
    });
  });
});
