import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, weekdayOf, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import {
  decideChallengeProposalKey,
  proposeChallengeKey,
  withdrawChallengeProposalKey,
  type ChallengeProposalDecision,
} from '@abnehm/contracts/island';
import { EffectivePlan, type PlanReader } from '@abnehm/contracts/ports';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import type { ReaderPort } from '../../src/partner-projections/projector.ts';
import { createTestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, resourceProbe, type AuthorizationScenario } from './authorization.ts';
import { coupleByInvitation, worldStart } from './coupled-world.ts';
import { uncoupleAs } from './shared-actions.ts';
import { pushOutcome } from './sync.ts';

// Gemeinsame Challenges in Tests (#210): ein `PlanReader`-Fake mit hinterlegten Wochenplänen je Person, die
// Push-Operationen der drei Fachbefehle, ein über die echte Einladung gekoppeltes Paar und die
// Negativtest-Szenarien für `registeredCommandCases`.

type Bausteine = readonly [BausteinKey, BausteinKey, BausteinKey];
export type TestWeeklyPlan = Readonly<Record<Weekday, Bausteine>>;

/** Jeden Tag Wasserziel, Sporteinheit und Ernährung erfasst: Alle vier Vorlagen passen. */
export const everyDay: TestWeeklyPlan = {
  montag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  dienstag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  mittwoch: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  donnerstag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  freitag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  samstag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
  sonntag: ['wasserziel', 'sporteinheit', 'ernaehrung_erfasst'],
};

/** Sport nur am Montag, Mittwoch und Freitag, nie Ernährung erfasst: „Ernährung im Blick“ passt nicht. */
export const threeSportDays: TestWeeklyPlan = {
  montag: ['wasserziel', 'sporteinheit', 'gewogen'],
  dienstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  mittwoch: ['wasserziel', 'sporteinheit', 'im_kalorienbudget'],
  donnerstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  freitag: ['wasserziel', 'sporteinheit', 'gewogen'],
  samstag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
  sonntag: ['wasserziel', 'im_kalorienbudget', 'gewogen'],
};

const goal = {
  validFrom: '2026-10-01',
  calorieBudgetMilliKcal: 1_800_000,
  lowerBoundMilliKcal: 1_200_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 70_000,
  waterTargetMl: 2_000,
  weeklySportTargetMinutes: 150,
} as const;

/**
 * `PlanReader` im Speicher, wie ihn Spezifikation 1 auf Postgres liefert, für die Challenge-Anteile: je
 * Person ein Wochenplan ab `validFrom`; davor und ohne Plan ausdrücklich `leer`. Er zählt seine Lesungen,
 * damit Tests sehen, dass der Server die sieben Tage beider Personen liest.
 */
export function testWeeklyPlans() {
  const plans = new Map<string, { validFrom: string; days: TestWeeklyPlan }>();
  const reads: { personId: string; localDate: string }[] = [];
  const reader: PlanReader = {
    async effectivePlan(personId, localDate) {
      reads.push({ personId, localDate });
      const plan = plans.get(personId);
      if (plan === undefined || plan.validFrom > localDate) return EffectivePlan.parse({ type: 'leer', localDate });
      return EffectivePlan.parse({
        type: 'gueltig',
        localDate,
        goal: { id: `6a1f0c2e-3b4d-4e5f-8a9b-${personId.slice(-12)}`, ...goal },
        weeklyPlanDay: { weeklyPlanVersionId: personId, validFrom: plan.validFrom, bausteine: plan.days[weekdayOf(localDate)] },
      });
    },
  };
  return {
    set(personId: string, days: TestWeeklyPlan, validFrom = '2026-10-01') {
      plans.set(personId, { validFrom, days });
    },
    reads,
    planReader: (() => reader) satisfies ReaderPort<PlanReader>,
  };
}

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

const createdAt = Instant.parse('2026-10-14T12:00:00.000Z');

const command = (type: CommandOperation['type'], businessKey: string, payload: Record<string, unknown>, operationId = randomUUID()): CommandOperation => ({
  type,
  operationId: EntityId.parse(operationId),
  businessKey,
  payload,
  knownServerVersion: null,
  schemaVersion: currentSyncSchemaVersion,
  createdAt,
});

export function proposeOp(templateKey: string, challengeId = EntityId.parse(randomUUID()), overrides: { businessKey?: string } = {}) {
  return command('proposeChallenge', overrides.businessKey ?? proposeChallengeKey(challengeId), { challengeId, templateKey });
}

export function decideOp(challengeId: string, decision: ChallengeProposalDecision) {
  const id = EntityId.parse(challengeId);
  return command('decideChallengeProposal', decideChallengeProposalKey(id), { challengeId: id, decision });
}

export function withdrawOp(challengeId: string) {
  const id = EntityId.parse(challengeId);
  return command('withdrawChallengeProposal', withdrawChallengeProposalKey(id), { challengeId: id });
}

/** Die ID der Challenge eines Vorschlags aus `proposeOp`. */
export const challengeIdOf = (operation: CommandOperation) => EntityId.parse(operation.payload.challengeId);

/**
 * Philipp und Anna, gekoppelt über die echte Einladung, mit Testuhr und hinterlegten Wochenplänen: beide
 * standardmäßig jeden Tag mit allen gezählten Bausteinen.
 */
export async function challengeCouple({ philippPlan = everyDay, annaPlan = everyDay }: { philippPlan?: TestWeeklyPlan; annaPlan?: TestWeeklyPlan } = {}) {
  const clock = createTestClock(worldStart);
  const plans = testWeeklyPlans();
  const backend = await createTestBackend({ clock, planReader: plans.planReader });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  plans.set(philipp.personId, philippPlan);
  plans.set(anna.personId, annaPlan);
  const { couplingId } = await coupleByInvitation(backend, philipp.device, anna.device);
  return { backend, clock, plans, philipp, anna, couplingId: EntityId.parse(couplingId) };
}

export type ChallengeWorld = Awaited<ReturnType<typeof challengeCouple>> & { actor: Device; challengeId: EntityId };

/** Gekoppelte Welt mit einem offenen Vorschlag „Gut getrunken“ von Philipp. */
export async function proposedWorld(): Promise<ChallengeWorld> {
  const world = await challengeCouple();
  const operation = proposeOp('gut_getrunken');
  if ((await pushOutcome(world.backend, world.philipp.device, operation)) !== 'erlaubt') throw new Error('Vorschlag fehlgeschlagen');
  return { ...world, actor: world.philipp.device, challengeId: challengeIdOf(operation) };
}

/** Ein zweites, fremdes Paar im selben Backend mit offenem Vorschlag; Ziel manipulierter IDs. */
async function foreignProposal(world: ChallengeWorld) {
  const other = await personWithSession(world.backend, `andere-${randomUUID()}@example.test`, 'Andere');
  const otherPartner = await personWithSession(world.backend, `anderer-${randomUUID()}@example.test`, 'Anderer');
  world.plans.set(other.personId, everyDay);
  world.plans.set(otherPartner.personId, everyDay);
  await coupleByInvitation(world.backend, other.device, otherPartner.device);
  const operation = proposeOp('aktive_woche');
  if ((await pushOutcome(world.backend, other.device, operation)) !== 'erlaubt') throw new Error('Fremder Vorschlag fehlgeschlagen');
  return challengeIdOf(operation);
}

const uncoupleChallengeWorld = (world: ChallengeWorld) => uncoupleAs(world.backend, { couplingId: world.couplingId, requesterPersonId: world.anna.personId });

const probe = (world: ChallengeWorld, entity: 'challenge_proposal' | 'challenge_decision') =>
  resourceProbe(world.backend, policies.resource(entity, 'lesen'))(world.actor, { id: world.challengeId }).then(httpOutcome);

type Dimensions = 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation';

/** Negativtest-Szenarien der drei Fachbefehle für `registeredCommandCases` und die eigenen Autorisierungstests. */
export const challengeCommandScenarios = {
  proposeChallenge: {
    policy: policies.resource('challenge_proposal', 'befehl'),
    arrange: async (): Promise<ChallengeWorld> => {
      const world = await challengeCouple();
      return { ...world, actor: world.philipp.device, challengeId: EntityId.parse(randomUUID()) };
    },
    attempt: (world: ChallengeWorld, device: Device) => pushOutcome(world.backend, device, proposeOp('gut_getrunken')),
    // Die ID eines Vorschlags des anderen Paars.
    manipulierte_id: async (world: ChallengeWorld) => pushOutcome(world.backend, world.actor, proposeOp('gut_getrunken', await foreignProposal(world))),
    entkopplung: async (world: ChallengeWorld) => void (await uncoupleChallengeWorld(world)),
    verbotene_operation: (world: ChallengeWorld) => probe(world, 'challenge_proposal'),
  },
  decideChallengeProposal: {
    policy: policies.resource('challenge_decision', 'befehl'),
    arrange: async (): Promise<ChallengeWorld> => {
      const world = await proposedWorld();
      return { ...world, actor: world.anna.device };
    },
    attempt: (world: ChallengeWorld, device: Device) => pushOutcome(world.backend, device, decideOp(world.challengeId, 'ablehnen')),
    manipulierte_id: async (world: ChallengeWorld) => pushOutcome(world.backend, world.actor, decideOp(await foreignProposal(world), 'annehmen')),
    entkopplung: async (world: ChallengeWorld) => void (await uncoupleChallengeWorld(world)),
    verbotene_operation: (world: ChallengeWorld) => probe(world, 'challenge_decision'),
  },
  withdrawChallengeProposal: {
    policy: policies.resource('challenge_decision', 'befehl'),
    arrange: proposedWorld,
    attempt: (world: ChallengeWorld, device: Device) => pushOutcome(world.backend, device, withdrawOp(world.challengeId)),
    manipulierte_id: async (world: ChallengeWorld) => pushOutcome(world.backend, world.actor, withdrawOp(await foreignProposal(world))),
    entkopplung: async (world: ChallengeWorld) => void (await uncoupleChallengeWorld(world)),
    verbotene_operation: (world: ChallengeWorld) => probe(world, 'challenge_decision'),
  },
} satisfies Record<string, AuthorizationScenario<ChallengeWorld, Dimensions>>;
