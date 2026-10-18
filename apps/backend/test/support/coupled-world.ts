import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone, type AreaKey } from '@abnehm/contracts/base';

import {
  coupling,
  couplingMember,
  encouragement,
  energyBooking,
  island,
  islandEvent,
  islandEventState,
  islandProgress,
  mealPhoto,
  nutritionEntry,
  partnerDailyGoalStatus,
  partnerSharing,
  partnerSummary,
  photoSharing,
  pushInstallation,
  revocationNotice,
  waterEntry,
  weeklyPlanVersion,
} from '../../src/db/schema/index.ts';
import {
  policies,
  type Operation,
  type ProtectionDimension,
  type ResourceEntity,
  type ResourcePolicy,
  type ResourceTarget,
} from '../../src/authorization/authorization.ts';
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, resourceProbe } from './authorization.ts';

// Gekoppelte Testwelt für Autorisierungstests: Anna und Philipp mit Sitzung, Person und aktiver
// Kopplung samt Startfreigaben (vier Bereiche `zusammengefasst`, Fotos `geteilt`). Bis die
// Kopplungsannahme und die Seeds (#112) bereitstehen, schreibt sie die Zeilen direkt in Postgres.

/** Feste Uhr der Fixtures (Spezifikation 0, Abschnitt 12); lokaler Tag in Berlin ist der 14.10. */
export const worldStart = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
export const worldToday = '2026-10-14';
const now = new Date(worldStart.instant);
const version = 1n;
const sync = { createdAt: now, updatedAt: now, serverVersion: version };
const day = { localDate: worldToday, timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 };

export type WorldPerson = Awaited<ReturnType<typeof personWithSession>>;

export type CoupledWorld = {
  backend: TestBackend;
  clock: TestClock;
  anna: WorldPerson;
  philipp: WorldPerson;
  couplingId: string;
  islandId: string;
};

export async function coupledWorld(): Promise<CoupledWorld> {
  const clock = createTestClock(worldStart);
  const backend = await createTestBackend({ clock });
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  return { backend, clock, anna, philipp, ...(await couple(backend, anna, philipp)) };
}

/** Ein zweites, fremdes Paar im selben Backend, etwa als Ziel manipulierter IDs. */
export async function otherCouple(world: CoupledWorld): Promise<CoupledWorld> {
  const anna = await personWithSession(world.backend, `andere-${randomUUID()}@example.test`, 'Andere');
  const philipp = await personWithSession(world.backend, `anderer-${randomUUID()}@example.test`, 'Anderer');
  return { ...world, anna, philipp, ...(await couple(world.backend, anna, philipp)) };
}

async function couple(backend: TestBackend, a: WorldPerson, b: WorldPerson) {
  const couplingId = randomUUID();
  const islandId = randomUUID();
  const [low, high] = [a.personId, b.personId].sort();
  await backend.database.db.transaction(async (tx) => {
    await tx.insert(coupling).values({ id: couplingId, personLowId: low!, personHighId: high!, status: 'aktiv', startedAt: now, ...sync });
    for (const member of [a, b]) {
      await tx
        .insert(couplingMember)
        .values({ id: randomUUID(), couplingId, couplingStatus: 'aktiv', personId: member.personId, displayName: 'Partner', ...sync });
      for (const area of ['ernaehrung', 'wasser', 'sport', 'gewicht'] as const) {
        await tx
          .insert(partnerSharing)
          .values({ id: randomUUID(), ownerPersonId: member.personId, couplingId, area, level: 'zusammengefasst', ...sync });
      }
      await tx.insert(photoSharing).values({ id: randomUUID(), ownerPersonId: member.personId, couplingId, level: 'geteilt', ...sync });
    }
    await tx.insert(island).values({ id: islandId, couplingId, state: 'wartet_auf_rollen', ...sync });
  });
  return { couplingId, islandId };
}

/** Entkoppeln: archiviert die Kopplung; die Mitglieder folgen per `ON UPDATE CASCADE`. */
export async function uncouple(world: CoupledWorld) {
  await world.backend.database.db
    .update(coupling)
    .set({ status: 'archiviert', endedAt: now, updatedAt: now })
    .where(eq(coupling.id, world.couplingId));
}

export async function setSharing(world: CoupledWorld, owner: WorldPerson, area: AreaKey, level: 'privat' | 'zusammengefasst') {
  await world.backend.database.db
    .update(partnerSharing)
    .set({ level })
    .where(and(eq(partnerSharing.ownerPersonId, owner.personId), eq(partnerSharing.couplingId, world.couplingId), eq(partnerSharing.area, area)));
}

export async function setPhotoSharing(world: CoupledWorld, owner: WorldPerson, level: 'privat' | 'geteilt') {
  await world.backend.database.db
    .update(photoSharing)
    .set({ level })
    .where(and(eq(photoSharing.ownerPersonId, owner.personId), eq(photoSharing.couplingId, world.couplingId)));
}

/** ID der Partner- bzw. Fotofreigabe einer Person. */
export async function sharingId(world: CoupledWorld, owner: WorldPerson, area: AreaKey | 'fotos') {
  const db = world.backend.database.db;
  const [found] =
    area === 'fotos'
      ? await db.select({ id: photoSharing.id }).from(photoSharing).where(eq(photoSharing.ownerPersonId, owner.personId))
      : await db
          .select({ id: partnerSharing.id })
          .from(partnerSharing)
          .where(and(eq(partnerSharing.ownerPersonId, owner.personId), eq(partnerSharing.area, area)));
  return found!.id;
}

/** Je Ressourcenklasse eine Zeile; Eigentümerin ist `owner`, Partnerdaten gehen an `recipient`. */
export const insert = {
  async waterEntry(world: CoupledWorld, owner: WorldPerson) {
    const id = randomUUID();
    await world.backend.database.db
      .insert(waterEntry)
      .values({ id, personId: owner.personId, amountMl: 250, origin: 'manuell', loggedAt: now, ...day, ...sync });
    return id;
  },
  async weeklyPlanVersion(world: CoupledWorld, owner: WorldPerson) {
    const id = randomUUID();
    await world.backend.database.db.insert(weeklyPlanVersion).values({ id, personId: owner.personId, validFrom: worldToday, ...sync });
    return id;
  },
  async energyBooking(world: CoupledWorld, owner: WorldPerson) {
    const id = randomUUID();
    await world.backend.database.db.insert(energyBooking).values({
      id,
      personId: owner.personId,
      type: 'daily_bonus_credit',
      amount: 1,
      localDate: worldToday,
      bookingKey: `bonus:${id}`,
      trigger: {},
      createdAt: now,
      serverVersion: version,
    });
    return id;
  },
  async islandProgress(world: CoupledWorld) {
    const id = randomUUID();
    await world.backend.database.db
      .insert(islandProgress)
      .values({ id, islandId: world.islandId, couplingId: world.couplingId, level: 1, levelNeed: 10, content: {}, dataAsOf: now, ...sync });
    return id;
  },
  async islandEventState(world: CoupledWorld, owner: WorldPerson) {
    const eventId = randomUUID();
    const id = randomUUID();
    const db = world.backend.database.db;
    await db.insert(islandEvent).values({
      id: eventId,
      islandId: world.islandId,
      couplingId: world.couplingId,
      type: 'besuch',
      occasionKey: `besuch:${eventId}`,
      status: 'offen',
      occurredAt: now,
      ...sync,
    });
    await db.insert(islandEventState).values({ id, islandEventId: eventId, personId: owner.personId, ...sync });
    return id;
  },
  async encouragement(world: CoupledWorld, sender: WorldPerson, recipient: WorldPerson) {
    const id = randomUUID();
    await world.backend.database.db.insert(encouragement).values({
      id,
      couplingId: world.couplingId,
      senderPersonId: sender.personId,
      recipientPersonId: recipient.personId,
      messageKey: 'du_schaffst_das',
      sentAt: now,
      ...day,
      pushStatus: 'ohne_push',
      ...sync,
    });
    return id;
  },
  async partnerSummary(world: CoupledWorld, owner: WorldPerson, recipient: WorldPerson, area: AreaKey = 'wasser') {
    const id = randomUUID();
    await world.backend.database.db.insert(partnerSummary).values({
      id,
      couplingId: world.couplingId,
      ownerPersonId: owner.personId,
      recipientPersonId: recipient.personId,
      area,
      periodFrom: worldToday,
      periodTo: worldToday,
      generation: 1,
      content: { progressPercent: 64 },
      dataAsOf: now,
      ...sync,
    });
    return id;
  },
  async partnerDailyGoalStatus(world: CoupledWorld, owner: WorldPerson, recipient: WorldPerson) {
    const id = randomUUID();
    await world.backend.database.db.insert(partnerDailyGoalStatus).values({
      id,
      couplingId: world.couplingId,
      ownerPersonId: owner.personId,
      recipientPersonId: recipient.personId,
      localDate: worldToday,
      generation: 1,
      stage: 'unterwegs',
      dataAsOf: now,
      ...sync,
    });
    return id;
  },
  async revocationNotice(world: CoupledWorld, recipient: WorldPerson) {
    const id = randomUUID();
    await world.backend.database.db.insert(revocationNotice).values({
      id,
      recipientPersonId: recipient.personId,
      couplingId: world.couplingId,
      targetType: 'kopplung',
      reason: 'entkopplung',
      createdAt: now,
      serverVersion: version,
    });
    return id;
  },
  /** Geteiltes Mahlzeitenfoto mit einem Ernährungseintrag am Tag `localDate`. */
  async mealPhoto(world: CoupledWorld, owner: WorldPerson, { shared = true, localDate = worldToday } = {}) {
    const id = randomUUID();
    const db = world.backend.database.db;
    await db.insert(mealPhoto).values({ id, personId: owner.personId, imageKey: `foto/${id}`, capturedAt: now, sharedWithPartner: shared, ...sync });
    await db.insert(nutritionEntry).values({
      id: randomUUID(),
      personId: owner.personId,
      consumedAt: now,
      ...day,
      localDate,
      meal: 'mittagessen',
      captureMethod: 'foto',
      baseAmount: 300_000,
      displayUnit: 'g',
      displayAmountMilli: 300_000,
      snapshotName: 'Linsensuppe',
      snapshotBaseUnit: 'g',
      snapshotReferenceAmount: 100_000,
      snapshotMilliKcal: 90_000,
      snapshotProteinMg: 6_000,
      snapshotCarbsMg: 12_000,
      snapshotFatMg: 2_000,
      snapshotPortions: [],
      snapshotSource: 'ki',
      totalMilliKcal: 270_000,
      totalProteinMg: 18_000,
      totalCarbsMg: 36_000,
      totalFatMg: 6_000,
      mealPhotoId: id,
      ...sync,
    });
    return id;
  },
  async pushInstallation(world: CoupledWorld, owner: WorldPerson) {
    const id = randomUUID();
    await world.backend.database.db.insert(pushInstallation).values({
      id,
      personId: owner.personId,
      sessionId: randomUUID(),
      installationKey: `geraet-${id}`,
      expoPushToken: `ExponentPushToken[${id}]`,
      platform: 'ios',
      permissionStatus: 'erlaubt',
      active: true,
      lastUsedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
};

export type ProbeWorld = CoupledWorld & { actor: Device; target: ResourceTarget; policy: ResourcePolicy };

/**
 * Szenario des Negativtest-Gerüsts über `resourceProbe`: `setup` legt in der gekoppelten Welt die
 * Ressource an und nennt die berechtigte Person samt Ziel der positiven Gegenprobe.
 */
export function probeScenario<E extends ResourceEntity, O extends Operation, D extends ProtectionDimension>(
  policy: ResourcePolicy<E, O, D>,
  setup: (world: CoupledWorld) => Promise<{ actor: WorldPerson; target: ResourceTarget }>,
) {
  return {
    policy,
    arrange: async (): Promise<ProbeWorld> => {
      const world = await coupledWorld();
      const { actor, target } = await setup(world);
      return { ...world, actor: actor.device, target, policy };
    },
    attempt: async (world: ProbeWorld, device: Device) => httpOutcome(await resourceProbe(world.backend, policy)(device, world.target)),
  };
}

/** Dieselbe Ressource mit einer anderen Operation, etwa einer, die die Matrix verbietet. */
export function withOperation(entity: ResourceEntity, operation: Operation) {
  return async (world: ProbeWorld) => httpOutcome(await resourceProbe(world.backend, policies.resource(entity, operation))(world.actor, world.target));
}

/** Die berechtigte Person nennt ein anderes Ziel. */
export function withTarget(target: (world: ProbeWorld) => Promise<ResourceTarget>) {
  return async (world: ProbeWorld) => httpOutcome(await resourceProbe(world.backend, world.policy)(world.actor, await target(world)));
}
