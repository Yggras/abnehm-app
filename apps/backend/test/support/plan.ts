import { randomUUID } from 'node:crypto';

import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { referenceGoalVersion, standardWeekDays } from '@abnehm/contracts/fixtures';
import {
  acceptBudgetSuggestionKey,
  budgetSuggestionId,
  CreateGoalVersion,
  planVersionKey,
  WeeklyPlanDays,
  type BudgetSuggestionUpsert,
} from '@abnehm/contracts/plan';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, type AuthorizationScenario } from './authorization.ts';
import { insertDailyGoals } from './daily-goals.ts';
import { deleteOp, pushOutcome, pushRaw, upsertOp } from './sync.ts';

// Ziel- und Wochenplanversionen im Push (#128): Operationen, wie sie das Plan-Modul der App erzeugt,
// und die Negativtest-Szenarien für `registeredCommandCases`, das jeden registrierten Fachbefehl verlangt.

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

/** Referenzfall der Recherche und Standard-Wochenplan aus den Vertrags-Fixtures, mit den Typen der Nutzlast. */
export const referenceGoal: CreateGoalVersion = CreateGoalVersion.parse(referenceGoalVersion);
export const standardDays: WeeklyPlanDays = WeeklyPlanDays.parse(standardWeekDays);

const commandFields = { knownServerVersion: null, schemaVersion: currentSyncSchemaVersion, createdAt: Instant.parse('2026-10-14T12:00:00.000Z') };

/** `createGoalVersion` der Person; `payload` ersetzt Felder, `businessKey` den Schlüssel. */
export function goalVersionOp(personId: string, overrides: { payload?: object; businessKey?: string; operationId?: string } = {}): CommandOperation {
  const payload = { ...referenceGoal, ...overrides.payload } as CreateGoalVersion;
  return {
    type: 'createGoalVersion',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? planVersionKey('zielversion', EntityId.parse(personId), payload.validFrom, EntityId.parse(randomUUID())),
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
    businessKey: overrides.businessKey ?? planVersionKey('wochenplan', EntityId.parse(personId), validFrom, EntityId.parse(randomUUID())),
    payload: { validFrom, days: overrides.days ?? standardDays },
    ...commandFields,
  };
}

/** Offener Budgetvorschlag zum Referenzfall: anheben von 1.620 auf 1.770 kcal, Zeitraum bis zum 13.10.2026. */
export const openSuggestion: BudgetSuggestionUpsert = {
  periodFrom: LocalDate.parse('2026-09-23'),
  periodTo: LocalDate.parse('2026-10-13'),
  previousBudgetMilliKcal: 1_620_000,
  suggestedBudgetMilliKcal: 1_770_000,
  direction: 'anheben',
  status: 'offen',
};

/** ID des offenen Vorschlags der Person. */
export const suggestionIdOf = (personId: string) => budgetSuggestionId(EntityId.parse(personId), openSuggestion.periodTo);

/** Upsert des Budgetvorschlags der Person; `payload` ersetzt Felder. */
export const suggestionOp = (personId: string, payload: Partial<BudgetSuggestionUpsert> = {}) =>
  upsertOp(suggestionIdOf(personId), { ...openSuggestion, ...payload }, { entityType: 'budget_suggestion' });

/** Die Zielversion, die das Annehmen des offenen Vorschlags ab dem 15.10.2026 anlegt: Referenzfall mit dessen Budget. */
export const acceptedGoal: CreateGoalVersion = CreateGoalVersion.parse({
  ...referenceGoal,
  validFrom: '2026-10-15',
  calorieBudgetMilliKcal: openSuggestion.suggestedBudgetMilliKcal,
  budgetSource: 'budgetvorschlag',
});

/** `acceptBudgetSuggestion` des offenen Vorschlags der Person; `goalVersion` ersetzt Felder der Zielversion. */
export function acceptOp(
  personId: string,
  overrides: { suggestionId?: string; goalVersion?: object; businessKey?: string; operationId?: string } = {},
): CommandOperation {
  const suggestionId = EntityId.parse(overrides.suggestionId ?? suggestionIdOf(personId));
  return {
    type: 'acceptBudgetSuggestion',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? acceptBudgetSuggestionKey(suggestionId),
    payload: { suggestionId, goalVersion: { ...acceptedGoal, ...overrides.goalVersion } },
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
      // Der Schlüssel nennt Person und Fassung einer anderen Person, die es schon gibt. Sie ist wirksam,
      // sodass ein Ersetzen ihren kanonischen Datensatz nennen würde; die fremde Person bekommt ihn nie.
      const philipp = await personWithSession(world.backend, 'philipp@example.test', 'Philipp');
      await pushRaw(world.backend, philipp.device, [goalVersionOp(philipp.personId)]);
      await insertDailyGoals(world.backend, philipp.personId, '2026-10-14');
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
      await insertDailyGoals(world.backend, philipp.personId, '2026-10-14');
      return pushOutcome(world.backend, world.actor, weeklyPlanOp(philipp.personId));
    },
    verbotene_operation: (world: World) => genericUpsert(world, 'weekly_plan_version', { validFrom: '2026-10-14', days: standardDays }),
  },
  acceptBudgetSuggestion: {
    policy: policies.resource('budget_suggestion', 'befehl'),
    async arrange() {
      const world = await arrange();
      await pushRaw(world.backend, world.actor, [suggestionOp(world.personId)]);
      return world;
    },
    attempt: (world: World, device: Device) => pushOutcome(world.backend, device, acceptOp(world.personId)),
    manipulierte_id: async (world: World) => {
      // Schlüssel und Nutzlast nennen den offenen Vorschlag einer anderen Person, die es gibt.
      const philipp = await personWithSession(world.backend, 'philipp@example.test', 'Philipp');
      await pushRaw(world.backend, philipp.device, [suggestionOp(philipp.personId)]);
      return pushOutcome(world.backend, world.actor, acceptOp(world.personId, { suggestionId: suggestionIdOf(philipp.personId) }));
    },
    // Den eigenen Vorschlag löschen verbietet die Matrix; der Server verweigert es vor jeder Fachprüfung.
    verbotene_operation: (world: World) => pushOutcome(world.backend, world.actor, deleteOp(suggestionIdOf(world.personId), { entityType: 'budget_suggestion' })),
  },
} satisfies Record<string, AuthorizationScenario<World, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'verbotene_operation'>>;
