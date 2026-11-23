import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import { contributeToProjectKey, type ContributeToProject } from '@abnehm/contracts/island';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

import { policies } from '../../src/authorization/authorization.ts';
import { communityProject, couplingMember, islandEvent, notificationIntent, projectContribution } from '../../src/db/schema/index.ts';
import type { Device } from './auth-client.ts';
import { httpOutcome, resourceProbe, type AuthorizationScenario } from './authorization.ts';
import { builtWorld, earnEnergy, otherHatchedPair, type BuildWorld } from './building.ts';
import { worldToday } from './coupled-world.ts';
import { uncoupleAs } from './shared-actions.ts';
import { push, pushOutcome } from './sync.ts';

// Gemeinschaftsprojekte in Server-Tests (#208): die Push-Operation `contributeToProject`, eine Welt mit genug
// Energie für beide Anteile von Projekt 1 (je 20) und das Negativtest-Szenario für `registeredCommandCases`.

type CommandOperation = Extract<OutboxOperation, { businessKey: string }>;

export function contributeOp(
  contribution: Partial<ContributeToProject> & Pick<ContributeToProject, 'projectId'>,
  { operationId }: { operationId?: string } = {},
): CommandOperation & { payload: ContributeToProject } {
  const payload: ContributeToProject = {
    commandId: EntityId.parse(randomUUID()),
    contributionId: EntityId.parse(randomUUID()),
    amount: 4,
    localDate: LocalDate.parse(worldToday),
    ...contribution,
  };
  return {
    type: 'contributeToProject',
    operationId: EntityId.parse(operationId ?? randomUUID()),
    businessKey: contributeToProjectKey(payload.commandId),
    payload,
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse('2026-10-14T12:00:00.000Z'),
  } as CommandOperation & { payload: ContributeToProject };
}

/** Die Projekte der Insel nach Nummer. */
export async function projectsOf(world: Pick<BuildWorld, 'backend' | 'islandId'>) {
  return world.backend.database.db.select().from(communityProject).where(eq(communityProject.islandId, world.islandId)).orderBy(asc(communityProject.sequenceNumber));
}

/** Das aktive Projekt der Insel. */
export async function activeProjectOf(world: Pick<BuildWorld, 'backend' | 'islandId'>) {
  const [project] = await world.backend.database.db
    .select()
    .from(communityProject)
    .where(and(eq(communityProject.islandId, world.islandId), eq(communityProject.status, 'aktiv')));
  if (project === undefined) throw new Error('Kein aktives Projekt');
  return { ...project, id: EntityId.parse(project.id) };
}

/** Alle Projekteinzahlungen, älteste zuerst. */
export async function contributionsOf(world: Pick<BuildWorld, 'backend'>) {
  return world.backend.database.db.select().from(projectContribution).orderBy(asc(projectContribution.serverVersion));
}

/** Projektabschluss-Ereignisse und ihre Intents. */
export async function completionsOf(world: Pick<BuildWorld, 'backend' | 'islandId'>) {
  const db = world.backend.database.db;
  return {
    events: await db.select().from(islandEvent).where(and(eq(islandEvent.islandId, world.islandId), eq(islandEvent.type, 'projektabschluss'))),
    intents: await db.select().from(notificationIntent).where(eq(notificationIntent.type, 'projektabschluss')),
  };
}

/** Zahlt über einen Push ein, der gelingen muss; liefert das Ergebnis. */
export async function contributeAs(world: Pick<BuildWorld, 'backend'>, device: Device, contribution: Parameters<typeof contributeOp>[0]) {
  const [result] = await push(world.backend, device, [contributeOp(contribution)]);
  if (result?.type !== 'applied') throw new Error(`Einzahlung fehlgeschlagen: ${JSON.stringify(result)}`);
  return result;
}

/**
 * Tauscht die Rollen direkt in der Datenbank. Den Rollentausch als gemeinsame Aktion liefert ein eigenes Ticket;
 * für die Einzahlung zählt nur, welche Rolle die Person danach hat.
 */
export async function swapRoles(world: Pick<BuildWorld, 'backend' | 'couplingId' | 'anna' | 'philipp'>) {
  const db = world.backend.database.db;
  await db.transaction(async (tx) => {
    const members = await tx.select().from(couplingMember).where(eq(couplingMember.couplingId, world.couplingId));
    // Je Kopplung ist eine Rolle eindeutig; deshalb erst beide Rollen leeren.
    await tx.update(couplingMember).set({ role: null }).where(eq(couplingMember.couplingId, world.couplingId));
    for (const member of members) {
      await tx
        .update(couplingMember)
        .set({ role: member.role === 'bauen' ? 'natur' : 'bauen' })
        .where(and(eq(couplingMember.couplingId, world.couplingId), eq(couplingMember.personId, member.personId)));
    }
  });
}

/**
 * `builtWorld` mit Energie für beide Anteile von Projekt 1: Philipp (Bauen) hat 4 + 20 = 24, Anna (Natur) 24
 * aus sechs Tagen mit drei Tageszielen samt Bonus.
 */
export async function projectWorld() {
  const world = await builtWorld();
  await earnEnergy(world.backend, world.philipp, ['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09']);
  await earnEnergy(world.backend, world.anna, [worldToday, '2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09']);
  const project = await activeProjectOf(world);
  return { ...world, projectId: project.id };
}

export type ProjectWorld = Awaited<ReturnType<typeof projectWorld>>;

/** Negativtest-Szenario für `contributeToProject`: das eigene aktive Projekt als Gegenprobe; das Projekt eines anderen Paars. */
export const contributeToProjectCommandScenario = {
  policy: policies.resource('community_project', 'befehl'),
  arrange: projectWorld,
  attempt: (world: ProjectWorld, device: Device) => pushOutcome(world.backend, device, contributeOp({ projectId: world.projectId })),
  manipulierte_id: async (world: ProjectWorld) => {
    const other = await otherHatchedPair(world);
    return pushOutcome(world.backend, world.actor, contributeOp({ projectId: await activeProjectOf({ backend: world.backend, islandId: other.islandId }).then((p) => p.id) }));
  },
  entkopplung: async (world: ProjectWorld) => void (await uncoupleAs(world.backend, { couplingId: world.couplingId, requesterPersonId: world.anna.personId })),
  verbotene_operation: (world: ProjectWorld) =>
    resourceProbe(world.backend, policies.resource('community_project', 'upsert'))(world.actor, { id: world.projectId }).then(httpOutcome),
} satisfies AuthorizationScenario<ProjectWorld, 'ohne_sitzung' | 'fremde_person' | 'manipulierte_id' | 'entkopplung' | 'verbotene_operation'>;
