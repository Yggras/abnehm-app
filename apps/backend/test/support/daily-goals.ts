import { randomUUID } from 'node:crypto';

import { EntityId, Instant, LocalDate, type BausteinKey } from '@abnehm/contracts/base';
import { dailyGoalKey, type DailyGoalSlot, type DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import { dailyBonusKey } from '@abnehm/contracts/energy';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { dailyGoal } from '../../src/db/schema/index.ts';
import { nextServerVersion } from '../../src/sync/change-log.ts';
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, type AuthorizationScenario } from './authorization.ts';
import { pushOutcome, pushRaw } from './sync.ts';

// Tagesziele und ihre Fachbefehle für Integrationstests (#105). Die Tagesziele materialisiert im
// Betrieb Spezifikation 1 (`materializeDailyGoals`); bis dahin legen Tests sie direkt in Postgres an.

export type ServerDailyGoal = Readonly<{ id: EntityId; personId: EntityId; localDate: LocalDate; slot: DailyGoalSlot; baustein: BausteinKey }>;

const defaultBausteine: readonly BausteinKey[] = ['gewogen', 'wasserziel', 'sporteinheit'];

/** Drei Tagesziele einer Person an einem Tag, in Berlin; `ids` setzt sie fest, etwa gleich zu einem Gerät. */
export async function insertDailyGoals(
  backend: TestBackend,
  personId: string,
  localDate: string,
  { bausteine = defaultBausteine, ids }: { bausteine?: readonly BausteinKey[]; ids?: readonly string[] } = {},
): Promise<ServerDailyGoal[]> {
  const dayEndsAt = new Date(Date.parse(`${localDate}T00:00:00.000Z`) + 22 * 3_600_000);
  const goals = bausteine.map((baustein, index) => ({
    id: EntityId.parse(ids?.[index] ?? randomUUID()),
    personId: EntityId.parse(personId),
    localDate: LocalDate.parse(localDate),
    slot: (index + 1) as DailyGoalSlot,
    baustein,
  }));
  await backend.database.db.transaction(async (tx) => {
    for (const goal of goals) {
      await tx.insert(dailyGoal).values({
        ...goal,
        timeZone: 'Europe/Berlin',
        utcOffsetMinutes: 120,
        snapshot: snapshotOf(goal, dayEndsAt),
        dayEndsAt,
        createdAt: dayEndsAt,
        serverVersion: await nextServerVersion(tx),
      });
    }
  });
  return goals;
}

export function snapshotOf(goal: ServerDailyGoal, dayEndsAt: Date): DailyGoalSnapshot {
  const base = { personId: goal.personId, localDate: goal.localDate, slot: goal.slot, timeZone: 'Europe/Berlin', dayEndsAt: dayEndsAt.toISOString() };
  switch (goal.baustein) {
    case 'wasserziel':
      return { type: goal.baustein, ...base, targetMl: 1500 } as DailyGoalSnapshot;
    case 'sporteinheit':
      return { type: goal.baustein, ...base, minimumSingleSessionMinutes: 20 } as DailyGoalSnapshot;
    case 'ernaehrung_erfasst':
      return { type: goal.baustein, ...base, minimumMealCategories: 2 } as DailyGoalSnapshot;
    case 'im_kalorienbudget':
      return { type: goal.baustein, ...base, budgetKcal: 1800, lowerBoundKcal: 1200 } as DailyGoalSnapshot;
    case 'gewogen':
      return { type: goal.baustein, ...base } as DailyGoalSnapshot;
  }
}

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

/** `completeDailyGoal`, wie ihn der Persistenzdienst eines Geräts erzeugt. */
export function completeOp(goal: ServerDailyGoal, overrides: { completedAt?: string; operationId?: string; businessKey?: string; payload?: object } = {}): CommandOperation {
  const completedAt = overrides.completedAt ?? '2026-10-14T10:00:00.000Z';
  return {
    type: 'completeDailyGoal',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? dailyGoalKey(goal.personId, goal.localDate, goal.slot),
    payload: { dailyGoalId: goal.id, localDate: goal.localDate, slot: goal.slot, baustein: goal.baustein, completedAt, ...overrides.payload },
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse(completedAt),
  };
}

/** `grantDailyBonus` eines Tags. */
export function bonusOp(personId: string, localDate: string, overrides: { operationId?: string; businessKey?: string } = {}): CommandOperation {
  return {
    type: 'grantDailyBonus',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? dailyBonusKey(EntityId.parse(personId), LocalDate.parse(localDate)),
    payload: { localDate },
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse('2026-10-14T10:00:00.000Z'),
  };
}

type World = { backend: TestBackend; actor: Device; personId: string; goals: ServerDailyGoal[] };

async function arrange(): Promise<World> {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  return { backend, actor: anna.device, personId: anna.personId, goals: await insertDailyGoals(backend, anna.personId, '2026-10-14') };
}

/** Eine andere Person mit erfüllten Tageszielen, deren Erfüllungen die manipulierten Anfragen nennen. */
async function foreignWithCompletions(world: World) {
  const philipp = await personWithSession(world.backend, 'philipp@example.test', 'Philipp');
  const goals = await insertDailyGoals(world.backend, philipp.personId, '2026-10-14');
  for (const goal of goals) await pushRaw(world.backend, philipp.device, [completeOp(goal)]);
  await pushRaw(world.backend, philipp.device, [bonusOp(philipp.personId, '2026-10-14')]);
  return { philipp, goals };
}

/** Negativtest-Szenarien beider Fachbefehle für `registeredCommandCases`. */
export const dailyGoalCommandScenarios = {
  completeDailyGoal: {
    policy: policies.resource('daily_goal_completion', 'befehl'),
    arrange,
    attempt: (world: World, device: Device) => pushOutcome(world.backend, device, completeOp(world.goals[0]!)),
    manipulierte_id: async (world: World) => {
      const { goals } = await foreignWithCompletions(world);
      // Die Anfrage nennt Schlüssel und Tagesziel der anderen Person.
      return pushOutcome(world.backend, world.actor, completeOp(goals[0]!));
    },
    verbotene_operation: async (world: World) => {
      const reply = await pushRaw(world.backend, world.actor, [{ type: 'upsert_entity', operationId: randomUUID(), entityType: 'daily_goal_completion',
        entityId: randomUUID(), payload: {}, knownServerVersion: null, schemaVersion: currentSyncSchemaVersion, createdAt: '2026-10-14T10:00:00.000Z' }]);
      if (reply.status !== 200) return httpOutcome(reply);
      const [result] = (reply.body as { results: { type: string; error?: { code: string } }[] }).results;
      return result?.error?.code === 'forbidden' ? 'verweigert' : `unerwartet: ${JSON.stringify(result)}`;
    },
  },
  grantDailyBonus: {
    policy: policies.resource('energy_booking', 'befehl'),
    async arrange() {
      const world = await arrange();
      for (const goal of world.goals) await pushRaw(world.backend, world.actor, [completeOp(goal)]);
      return world;
    },
    attempt: (world: World, device: Device) => pushOutcome(world.backend, device, bonusOp(world.personId, '2026-10-14')),
    manipulierte_id: async (world: World) => {
      const { philipp } = await foreignWithCompletions(world);
      return pushOutcome(world.backend, world.actor, bonusOp(philipp.personId, '2026-10-14'));
    },
    verbotene_operation: async (world: World) => {
      const reply = await pushRaw(world.backend, world.actor, [{ type: 'delete_entity', operationId: randomUUID(), entityType: 'energy_booking',
        entityId: randomUUID(), knownServerVersion: null, schemaVersion: currentSyncSchemaVersion, createdAt: '2026-10-14T10:00:00.000Z' }]);
      if (reply.status !== 200) return httpOutcome(reply);
      const [result] = (reply.body as { results: { type: string; error?: { code: string } }[] }).results;
      return result?.error?.code === 'forbidden' ? 'verweigert' : `unerwartet: ${JSON.stringify(result)}`;
    },
  },
} satisfies Record<string, AuthorizationScenario<World, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'verbotene_operation'>>;
