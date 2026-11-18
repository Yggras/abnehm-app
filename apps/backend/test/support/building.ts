import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { buildObjectKey, placeObjectKey, upgradeObjectKey, type BuildObject, type PlaceObject, type PlacementTarget, type UpgradeObject } from '@abnehm/contracts/island';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { blueprintUnlock, islandField } from '../../src/db/schema/index.ts';
import { createTestBackend, type TestBackend } from './app.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, personWithSession, resourceProbe, type AuthorizationScenario, type Outcome } from './authorization.ts';
import { coupleByInvitation, worldStart, worldToday, type WorldPerson } from './coupled-world.ts';
import { bonusOp, completeOp, insertDailyGoals, type ServerDailyGoal } from './daily-goals.ts';
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
  return commandOp('buildObject', overrides.businessKey ?? buildObjectKey(payload.commandId), payload, overrides);
}

/** Umschlag einer Push-Operation für einen Spielbefehl, wie ihn der Sync-Writer der App schreibt. */
function commandOp<T extends 'buildObject' | 'upgradeObject' | 'placeObject', P extends BuildObject | UpgradeObject | PlaceObject>(
  type: T,
  businessKey: string,
  payload: P,
  { operationId }: { operationId?: string } = {},
): CommandOperation & { payload: P } {
  return {
    type,
    operationId: EntityId.parse(operationId ?? randomUUID()),
    businessKey,
    payload,
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse('2026-10-14T12:00:00.000Z'),
  } as CommandOperation & { payload: P };
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
  await earnEnergy(backend, philipp, [worldToday]);
  return { backend, anna, philipp, actor: philipp.device, ...island };
}

/** Energie aus Tageszielen: je Tag drei Erfüllungen samt Bonus, also 4 Energie je Tag. Liefert die Tagesziele. */
export async function earnEnergy(backend: TestBackend, person: WorldPerson, localDates: readonly string[]): Promise<ServerDailyGoal[]> {
  const all: ServerDailyGoal[] = [];
  for (const localDate of localDates) {
    const goals = await insertDailyGoals(backend, person.personId, localDate);
    await push(backend, person.device, [...goals.map((goal) => completeOp(goal)), bonusOp(person.personId, localDate)]);
    all.push(...goals);
  }
  return all;
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
export async function lockBlueprint(world: Readonly<{ backend: TestBackend; islandId: string }>, catalogKey: string) {
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

// Aufwerten und Platzieren in Server-Tests (#194): die Push-Operationen `upgradeObject` und `placeObject`,
// eine Welt mit Philipps Laterne und genug Energie zum Aufwerten bis Stufe 3 und die Negativtest-Szenarien.

export function upgradeOp(upgrade: Partial<UpgradeObject> & Pick<UpgradeObject, 'islandObjectId'>, overrides: { operationId?: string } = {}): CommandOperation & { payload: UpgradeObject } {
  const payload: UpgradeObject = { commandId: EntityId.parse(randomUUID()), toLevel: 2, localDate: LocalDate.parse(worldToday), ...upgrade };
  return commandOp('upgradeObject', upgradeObjectKey(payload.commandId), payload, overrides);
}

/** `fromFieldId` nutzt nur die lokale Bereinigung der App; der Server entscheidet nicht danach. */
export function placeOp(
  islandObjectId: EntityId,
  target: PlacementTarget,
  { fromFieldId = null, ...overrides }: { operationId?: string; fromFieldId?: EntityId | null } = {},
): CommandOperation & { payload: PlaceObject } {
  const payload: PlaceObject = { commandId: EntityId.parse(randomUUID()), islandObjectId, fromFieldId, target };
  return commandOp('placeObject', placeObjectKey(payload.commandId), payload, overrides);
}

/** Ziel einer Platzierung auf ein Feld. */
export const onField = (fieldId: EntityId): PlacementTarget => ({ type: 'feld', fieldId });

/** Baut über einen Push, der gelingen muss; liefert die ID des neuen Objekts. */
export async function buildAs(world: Pick<BuildWorld, 'backend'>, device: Device, build: Parameters<typeof buildOp>[0]): Promise<EntityId> {
  const operation = buildOp(build);
  const [result] = await push(world.backend, device, [operation]);
  if (result?.type !== 'applied') throw new Error(`Bau fehlgeschlagen: ${JSON.stringify(result)}`);
  return operation.payload.islandObjectId;
}

/**
 * `builtWorld` mit Philipps Laterne in seiner Ecke (`grundinsel:0:0`) und Energie aus vier weiteren Tagen:
 * 4 + 16 − 3 = 17, genug für Stufe 2 (6) und Stufe 3 (9).
 */
export async function objectWorld() {
  const world = await builtWorld();
  await earnEnergy(world.backend, world.philipp, ['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10']);
  const objectId = await buildAs(world, world.actor, { fieldId: world.fieldId(fieldKeys.philippsEcke) });
  return { ...world, objectId };
}

export type ObjectWorld = Awaited<ReturnType<typeof objectWorld>>;

/** Fremde Objekte: Annas Blumenwiese in ihrer Ecke und eine Laterne des anderen Paars. */
async function foreignObjects(world: ObjectWorld) {
  await earnEnergy(world.backend, world.anna, [worldToday]);
  const annas = await buildAs(world, world.anna.device, { fieldId: world.fieldId(fieldKeys.annasEcke), blueprintKey: 'blumenwiese' });
  const other = await otherHatchedPair(world);
  await earnEnergy(world.backend, other.philipp, [worldToday]);
  const others = await buildAs(world, other.philipp.device, { fieldId: other.fieldId(fieldKeys.philippsEcke) });
  return { annas, others, otherField: other.fieldId(fieldKeys.philippsEcke2) };
}

async function allDenied(attempts: readonly (() => Promise<Outcome>)[]): Promise<Outcome> {
  for (const attempt of attempts) {
    const outcome = await attempt();
    if (outcome !== 'verweigert') return outcome;
  }
  return 'verweigert';
}

const objectCommandDenials = {
  entkopplung: async (world: ObjectWorld) => void (await uncoupleAs(world.backend, { couplingId: world.couplingId, requesterPersonId: world.anna.personId })),
  verbotene_operation: (world: ObjectWorld) =>
    resourceProbe(world.backend, policies.resource('island_object_own', 'lesen'))(world.actor, { id: world.objectId }).then(httpOutcome),
};

/** Negativtest-Szenario für `upgradeObject`: die eigene Laterne als Gegenprobe; fremde Objekte. */
export const upgradeObjectCommandScenario = {
  policy: policies.resource('island_object_own', 'befehl'),
  arrange: objectWorld,
  attempt: (world: ObjectWorld, device: Device) => pushOutcome(world.backend, device, upgradeOp({ islandObjectId: world.objectId })),
  manipulierte_id: async (world: ObjectWorld) => {
    const { annas, others } = await foreignObjects(world);
    return allDenied([annas, others].map((islandObjectId) => () => pushOutcome(world.backend, world.actor, upgradeOp({ islandObjectId }))));
  },
  ...objectCommandDenials,
} satisfies AuthorizationScenario<ObjectWorld, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation'>;

/** Negativtest-Szenario für `placeObject`: die eigene Laterne auf ein eigenes Feld als Gegenprobe; fremde Objekte und Felder. */
export const placeObjectCommandScenario = {
  policy: policies.resource('island_object_own', 'befehl'),
  arrange: objectWorld,
  attempt: (world: ObjectWorld, device: Device) =>
    pushOutcome(world.backend, device, placeOp(world.objectId, onField(world.fieldId(fieldKeys.philippsEcke2)))),
  manipulierte_id: async (world: ObjectWorld) => {
    const { annas, others, otherField } = await foreignObjects(world);
    const attempt = (islandObjectId: EntityId, target: PlacementTarget) => () => pushOutcome(world.backend, world.actor, placeOp(islandObjectId, target));
    return allDenied([
      // Fremdes Objekt, auch ins Lager oder auf ein eigenes Feld.
      attempt(annas, { type: 'lager' }),
      attempt(annas, onField(world.fieldId(fieldKeys.philippsEcke2))),
      attempt(others, { type: 'lager' }),
      // Eigenes Objekt auf ein fremdes Feld: Partner, gemeinsamer Bereich, fremde Insel, keine UUID.
      attempt(world.objectId, onField(world.fieldId(fieldKeys.annasEcke))),
      attempt(world.objectId, onField(world.fieldId(fieldKeys.platz))),
      attempt(world.objectId, onField(otherField)),
    ]);
  },
  ...objectCommandDenials,
} satisfies AuthorizationScenario<ObjectWorld, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation'>;
