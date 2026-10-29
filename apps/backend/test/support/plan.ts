import { randomUUID } from 'node:crypto';

import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { goalVersionKey, weeklyPlanVersionKey, type CreateGoalVersion, type WeeklyPlanDays } from '@abnehm/contracts/plan';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, type AuthorizationScenario } from './authorization.ts';
import { pushOutcome, pushRaw } from './sync.ts';

// Ziel- und Wochenplanversionen im Push (#128): Operationen, wie sie das Plan-Modul der App erzeugt,
// und die Negativtest-Szenarien für `registeredCommandCases`, das jeden registrierten Fachbefehl verlangt.

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

/** Referenzfall der Recherche (research/calorie-needs.md): Frau, 35 Jahre, 168 cm, 80 kg, wenig aktiv, entspannt. */
export const referenceGoal: CreateGoalVersion = {
  validFrom: LocalDate.parse('2026-10-14'),
  calorieBudgetMilliKcal: 1_620_000,
  basalMetabolicRateMilliKcal: 1_514_000,
  totalEnergyExpenditureMilliKcal: 2_120_000,
  lowerBoundMilliKcal: 1_514_000,
  deficitMilliKcal: 500_000,
  budgetSource: 'berechnet',
  calculationSex: 'weiblich',
  ageYears: 35,
  heightCm: 168,
  weightG: 80_000,
  activityLevel: 'wenig_aktiv',
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 76_000,
  waterTargetMl: 1_500,
  weeklySportTargetMinutes: 150,
};

/** Standard-Wochenplan: Sport Di/Do/Sa, Wiegen montags. */
export const standardDays: WeeklyPlanDays = {
  montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
  dienstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  donnerstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  freitag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  samstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  sonntag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
};

const commandFields = { knownServerVersion: null, schemaVersion: currentSyncSchemaVersion, createdAt: Instant.parse('2026-10-14T12:00:00.000Z') };

/** `createGoalVersion` der Person; `payload` ersetzt Felder, `businessKey` den Schlüssel. */
export function goalVersionOp(personId: string, overrides: { payload?: object; businessKey?: string; operationId?: string } = {}): CommandOperation {
  const payload = { ...referenceGoal, ...overrides.payload } as CreateGoalVersion;
  return {
    type: 'createGoalVersion',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? goalVersionKey(EntityId.parse(personId), payload.validFrom, EntityId.parse(randomUUID())),
    payload,
    ...commandFields,
  };
}

/** `createWeeklyPlanVersion` der Person, standardmäßig ab dem 14.10.2026. */
export function weeklyPlanOp(personId: string, overrides: { validFrom?: string; days?: object; businessKey?: string } = {}): CommandOperation {
  const validFrom = LocalDate.parse(overrides.validFrom ?? '2026-10-14');
  return {
    type: 'createWeeklyPlanVersion',
    operationId: EntityId.parse(randomUUID()),
    businessKey: overrides.businessKey ?? weeklyPlanVersionKey(EntityId.parse(personId), validFrom, EntityId.parse(randomUUID())),
    payload: { validFrom, days: overrides.days ?? standardDays },
    ...commandFields,
  };
}

type World = { backend: TestBackend; actor: Device; personId: string };

async function arrange(): Promise<World> {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  return { backend, actor: anna.device, personId: anna.personId };
}

/** Eine generische Operation auf der Fassung, die die Matrix nicht kennt: Fassungen entstehen nur per Fachbefehl. */
async function genericUpsert(world: World, entityType: string, payload: object) {
  const reply = await pushRaw(world.backend, world.actor, [{ type: 'upsert_entity', operationId: randomUUID(), entityType,
    entityId: randomUUID(), payload, knownServerVersion: null, schemaVersion: currentSyncSchemaVersion, createdAt: '2026-10-14T12:00:00.000Z' }]);
  if (reply.status !== 200) return httpOutcome(reply);
  const [result] = (reply.body as { results: { type: string; error?: { code: string } }[] }).results;
  return result?.error?.code === 'forbidden' ? 'verweigert' : (`unerwartet: ${JSON.stringify(result)}` as const);
}

/** Negativtest-Szenarien beider Fachbefehle für `registeredCommandCases`. */
export const planCommandScenarios = {
  createGoalVersion: {
    policy: policies.resource('goal_version', 'befehl'),
    arrange,
    attempt: (world: World, device: Device) => pushOutcome(world.backend, device, goalVersionOp(world.personId)),
    manipulierte_id: async (world: World) => {
      // Der Schlüssel nennt Person und Fassung einer anderen Person, die es schon gibt.
      const philipp = await personWithSession(world.backend, 'philipp@example.test', 'Philipp');
      await pushRaw(world.backend, philipp.device, [goalVersionOp(philipp.personId)]);
      return pushOutcome(world.backend, world.actor, goalVersionOp(philipp.personId));
    },
    verbotene_operation: (world: World) => genericUpsert(world, 'goal_version', referenceGoal),
  },
  createWeeklyPlanVersion: {
    policy: policies.resource('weekly_plan_version', 'befehl'),
    arrange,
    attempt: (world: World, device: Device) => pushOutcome(world.backend, device, weeklyPlanOp(world.personId)),
    manipulierte_id: async (world: World) => {
      const philipp = await personWithSession(world.backend, 'philipp@example.test', 'Philipp');
      await pushRaw(world.backend, philipp.device, [weeklyPlanOp(philipp.personId)]);
      return pushOutcome(world.backend, world.actor, weeklyPlanOp(philipp.personId));
    },
    verbotene_operation: (world: World) => genericUpsert(world, 'weekly_plan_version', { validFrom: '2026-10-14', days: standardDays }),
  },
} satisfies Record<string, AuthorizationScenario<World, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'verbotene_operation'>>;
