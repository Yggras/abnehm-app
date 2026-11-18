import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { buildObjectKey, type BuildObject } from '@abnehm/contracts/island';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { blueprintUnlock, islandField } from '../../src/db/schema/index.ts';
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, resourceProbe, type AuthorizationScenario } from './authorization.ts';
import { coupleByInvitation, worldStart, worldToday, type WorldPerson } from './coupled-world.ts';
import { bonusOp, completeOp, insertDailyGoals } from './daily-goals.ts';
import { decideOp, requestOp, uncoupleAs } from './shared-actions.ts';
import { push, pushOutcome } from './sync.ts';

// Bauen in Server-Tests (#191): ein Paar mit echt geschlüpfter Insel (Anna schlägt Natur vor, Philipp nimmt an
// und bekommt Bauen, Seite a der Grundinsel) und Energie für Philipp aus drei Tageszielen samt Bonus. Dazu
// die Push-Operation `buildObject` und das Negativtest-Szenario für `registeredCommandCases`.

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

/** Feldschlüssel der Grundinsel aus dem Katalog: Ecke a (Philipp), Rollenbereich a, Gemeinschaftsplatz, Ecke b (Anna). */
export const fieldKeys = { philippsEcke: 'grundinsel:0:0', philippsEcke2: 'grundinsel:1:0', philippsRollenbereich: 'grundinsel:4:0', platz: 'grundinsel:6:0', annasEcke: 'grundinsel:12:0' } as const;

export function buildOp(
  build: Partial<BuildObject> & Pick<BuildObject, 'fieldId'>,
  overrides: { operationId?: string; businessKey?: string } = {},
): CommandOperation & { payload: BuildObject } {
  const payload: BuildObject = {
    commandId: EntityId.parse(randomUUID()),
    islandObjectId: EntityId.parse(randomUUID()),
    blueprintKey: 'laterne',
    localDate: LocalDate.parse(worldToday),
    ...build,
  };
  return {
    type: 'buildObject',
    operationId: EntityId.parse(overrides.operationId ?? randomUUID()),
    businessKey: overrides.businessKey ?? buildObjectKey(payload.commandId),
    payload,
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse('2026-10-14T12:00:00.000Z'),
  };
}

/** Koppelt zwei Personen über die echte Einladung und lässt Momo schlüpfen: Anna wählt Natur, Philipp nimmt an. */
async function hatch(backend: TestBackend, anna: WorldPerson, philipp: WorldPerson) {
  const { couplingId } = await coupleByInvitation(backend, anna.device, philipp.device);
  const request = requestOp({ type: 'rollenwahl', actionId: EntityId.parse(randomUUID()), payload: { proposerRole: 'natur' } });
  if ((await pushOutcome(backend, anna.device, request)) !== 'erlaubt') throw new Error('Rollenwahl fehlgeschlagen');
  if ((await pushOutcome(backend, philipp.device, decideOp(request.payload.actionId as string, 'annehmen'))) !== 'erlaubt') {
    throw new Error('Schlüpfen fehlgeschlagen');
  }
  const fields = await backend.database.db.select().from(islandField).where(eq(islandField.couplingId, couplingId));
  const fieldId = (key: string) => EntityId.parse(fields.find((field) => field.fieldKey === key)!.id);
  return { couplingId: EntityId.parse(couplingId), islandId: EntityId.parse(fields[0]!.islandId), fieldId };
}

/** Anna und Philipp mit geschlüpfter Insel; Philipp hat 4 Energie aus drei Tageszielen samt Bonus. */
export async function builtWorld() {
  const backend = await createTestBackend({ clock: createTestClock(worldStart) });
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const island = await hatch(backend, anna, philipp);
  const goals = await insertDailyGoals(backend, philipp.personId, worldToday);
  await push(backend, philipp.device, [...goals.map((goal) => completeOp(goal)), bonusOp(philipp.personId, worldToday)]);
  return { backend, anna, philipp, actor: philipp.device, ...island };
}

/** Ein zweites Paar mit eigener geschlüpfter Insel im selben Backend, etwa als Ziel manipulierter IDs. */
export async function otherHatchedPair(world: BuildWorld) {
  const anna = await personWithSession(world.backend, `andere-${randomUUID()}@example.test`, 'Andere');
  const philipp = await personWithSession(world.backend, `anderer-${randomUUID()}@example.test`, 'Anderer');
  return { anna, philipp, ...(await hatch(world.backend, anna, philipp)) };
}

export type BuildWorld = Awaited<ReturnType<typeof builtWorld>>;

/**
 * Nimmt der Insel einen Bauplan wieder weg. Freischaltungen sind unveränderlich (Trigger aus
 * `0001_immutable_entities`); nur dieser Test umgeht die Trigger, um einen bekannten, aber nicht
 * freigeschalteten Bauplan herzustellen. Der ausgelieferte Katalog kennt bisher nur Start-Baupläne.
 */
export async function lockBlueprint(world: BuildWorld, catalogKey: string) {
  await world.backend.database.db.transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.delete(blueprintUnlock).where(and(eq(blueprintUnlock.islandId, world.islandId), eq(blueprintUnlock.catalogKey, catalogKey)));
  });
}

/** Negativtest-Szenario für `buildObject`: eigenes Feld als Gegenprobe. */
export const buildObjectCommandScenario = {
  policy: policies.resource('island_field_build', 'befehl'),
  arrange: builtWorld,
  attempt: (world: BuildWorld, device: Device) => pushOutcome(world.backend, device, buildOp({ fieldId: world.fieldId(fieldKeys.philippsEcke2) })),
  // Fremde Felder: das des Partners, ein gemeinsamer Bereich und ein Feld des anderen Paars.
  manipulierte_id: async (world: BuildWorld) => {
    const other = await otherHatchedPair(world);
    for (const fieldId of [world.fieldId(fieldKeys.annasEcke), world.fieldId(fieldKeys.platz), other.fieldId(fieldKeys.philippsEcke)]) {
      const outcome = await pushOutcome(world.backend, world.actor, buildOp({ fieldId }));
      if (outcome !== 'verweigert') return outcome;
    }
    return 'verweigert';
  },
  entkopplung: async (world: BuildWorld) => void (await uncoupleAs(world.backend, { couplingId: world.couplingId, requesterPersonId: world.anna.personId })),
  verbotene_operation: (world: BuildWorld) =>
    resourceProbe(world.backend, policies.resource('island_field_build', 'lesen'))(world.actor, { id: world.fieldId(fieldKeys.philippsEcke) }).then(httpOutcome),
} satisfies AuthorizationScenario<BuildWorld, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation'>;
