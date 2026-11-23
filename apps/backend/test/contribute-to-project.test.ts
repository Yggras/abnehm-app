import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { energyBookingId, summarizeEnergy } from '@abnehm/contracts/energy';
import type { IslandProgress } from '@abnehm/contracts/island';
import { islandEventId } from '@abnehm/contracts/island-records';
import { projectOccasionKey } from '@abnehm/game-rules/projects';

import { islandProgress } from '../src/db/schema/index.ts';
import { readBookings } from '../src/energy/bookings.ts';
import { islandProgressRecord } from '../src/island/progress-projector.ts';
import { authorizationCases } from './support/authorization.ts';
import {
  activeProjectOf,
  completionsOf,
  contributeAs,
  contributeOp,
  contributeToProjectCommandScenario,
  contributionsOf,
  projectsOf,
  projectWorld,
  swapRoles,
  type ProjectWorld,
} from './support/projects.ts';
import { installationB, pullAll, push } from './support/sync.ts';

// Nachweis für #208 am Server: `contributeToProject` mit echter Hono-App, isoliertem Postgres und Testuhr
// (Spezifikation 4, Testnaht 2). Philipp hat Bauen, Anna Natur; Projekt 1 ist das Gartenhäuschen mit je 20 Bedarf,
// danach folgt im ausgelieferten Katalog der Gartenhäuschen-Ausbau mit 30. Beide haben 24 Energie.

async function progressOf(world: ProjectWorld): Promise<IslandProgress> {
  const [row] = await world.backend.database.db.select().from(islandProgress).where(eq(islandProgress.islandId, world.islandId));
  return islandProgressRecord(row!);
}

async function balanceOf(world: ProjectWorld, personId: string) {
  return summarizeEnergy((await readBookings(world.backend.database.db, [EntityId.parse(personId)])).get(EntityId.parse(personId))!).balance;
}

const rejectionOf = (result: unknown) => result as { type: string; error?: { code: string }; canonical?: { type: string; entityType?: string; data?: unknown } };

describe('contributeToProject', { timeout: 30_000 }, () => {
  it('Tracer: schreibt Einzahlung und project_contribution_debit atomar und berechnet den Inselfortschritt neu', async () => {
    const world = await projectWorld();
    const operation = contributeOp({ projectId: world.projectId, amount: 5 });

    const [result] = await push(world.backend, world.actor, [operation]);

    expect(result).toMatchObject({ type: 'applied' });
    if (result?.type !== 'applied') return;
    // Die Buchung vor der Einzahlung, die auf sie verweist; danach der Inselfortschritt.
    expect(result.changes?.map((change) => change.entityType)).toEqual(['energy_booking', 'project_contribution', 'island_progress']);
    expect(result.changes?.[0]).toMatchObject({
      entityId: energyBookingId(operation.payload.commandId),
      data: { type: 'project_contribution_debit', amount: -5, bookingKey: operation.payload.commandId, trigger: { commandId: operation.payload.commandId, projectId: world.projectId } },
    });
    expect(result.changes?.[1]).toMatchObject({
      entityId: operation.payload.contributionId,
      data: { communityProjectId: world.projectId, personId: world.philipp.personId, role: 'bauen', amount: 5, energyBookingId: energyBookingId(operation.payload.commandId) },
    });
    expect(await balanceOf(world, world.philipp.personId)).toBe(19);
    // Die Einzahlung füllt zugleich die eigene Levelhälfte: 5 von 11.
    const progress = await progressOf(world);
    expect(progress.members.find((member) => member.personId === world.philipp.personId)).toMatchObject({ halfPercent: 45 });
    expect(progress.activeProject).toMatchObject({ projectId: world.projectId, sequenceNumber: 1, stage: 'gestartet' });
  });

  it('zahlt höchstens bis zum Restbedarf des eigenen Anteils ein und lehnt einen vollen Anteil ohne Buchung ab', async () => {
    const world = await projectWorld();
    const result = await contributeAs(world, world.actor, { projectId: world.projectId, amount: 24 });

    expect(result.changes?.find((change) => change.entityType === 'project_contribution')).toMatchObject({ data: { amount: 20 } });
    expect(await balanceOf(world, world.philipp.personId)).toBe(4);

    const [full] = await push(world.backend, world.actor, [contributeOp({ projectId: world.projectId, amount: 1 })]);
    expect(rejectionOf(full)).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
    expect(await balanceOf(world, world.philipp.personId)).toBe(4);
    expect(await contributionsOf(world)).toHaveLength(1);
    // Der Bau-Anteil ist voll, der Natur-Anteil leer: 50 %.
    expect((await progressOf(world)).activeProject.stage).toBe('gut_unterwegs');
  });

  it('kürzt die Einzahlung eines zweiten eigenen Geräts, das offline denselben Rest einzahlt', async () => {
    const world = await projectWorld();
    const first = contributeOp({ projectId: world.projectId, amount: 15 });
    const second = contributeOp({ projectId: world.projectId, amount: 15 });
    await push(world.backend, world.actor, [first]);

    const [result] = await push(world.backend, world.actor, [second], installationB);

    // Kanonisch nur 5, die Buchung mit demselben Betrag; das zweite Gerät übernimmt beides.
    if (result?.type !== 'applied') throw new Error(JSON.stringify(result));
    expect(result.changes?.slice(0, 2)).toMatchObject([{ data: { amount: -5 } }, { data: { amount: 5 } }]);
    expect((await contributionsOf(world)).map((row) => row.amount)).toEqual([15, 5]);
  });

  it('ist beim Retry idempotent', async () => {
    const world = await projectWorld();
    const operation = contributeOp({ projectId: world.projectId, amount: 5 });
    const [first] = await push(world.backend, world.actor, [operation]);
    const [again] = await push(world.backend, world.actor, [operation]);
    expect(again).toMatchObject({ type: 'already_applied', changes: first?.type === 'applied' ? first.changes : [] });
    expect(await contributionsOf(world)).toHaveLength(1);
    expect(await balanceOf(world, world.philipp.personId)).toBe(19);
  });

  it('Projektabschluss: Sind beide Anteile voll, ist das Projekt im selben Befehl fertig, und das nächste beginnt', async () => {
    const world = await projectWorld();
    await contributeAs(world, world.anna.device, { projectId: world.projectId, amount: 20 });

    const result = await contributeAs(world, world.actor, { projectId: world.projectId, amount: 20 });

    const projects = await projectsOf(world);
    expect(projects.map(({ sequenceNumber, templateKey, status, buildNeed, natureNeed }) => ({ sequenceNumber, templateKey, status, buildNeed, natureNeed }))).toEqual([
      { sequenceNumber: 1, templateKey: 'gartenhaeuschen', status: 'fertig', buildNeed: 20, natureNeed: 20 },
      { sequenceNumber: 2, templateKey: 'gartenhaeuschen_ausbau', status: 'aktiv', buildNeed: 30, natureNeed: 30 },
    ]);
    expect(projects[0]!.completedAt).not.toBeNull();
    const next = await activeProjectOf(world);

    // Gemeinsames Ereignis mit dem Anlassschlüssel und je ein Intent an beide.
    const occasionKey = projectOccasionKey(world.islandId, 1);
    const { events, intents } = await completionsOf(world);
    expect(events).toMatchObject([{ id: islandEventId(world.islandId, occasionKey), occasionKey, templateKey: 'gartenhaeuschen', status: 'abgeschlossen' }]);
    expect(intents.map((intent) => intent.recipientPersonId).sort()).toEqual([world.anna.personId, world.philipp.personId].sort());
    for (const intent of intents) expect(intent).toMatchObject({ sourceEventId: events[0]!.id, messageKey: 'projektabschluss', payload: { templateKey: 'gartenhaeuschen' } });

    // Die Antwort bringt beide Projekte, das Ereignis und den Fortschritt mit dem neuen Projekt.
    const types = result.changes?.map((change) => change.entityType);
    expect(types).toEqual(expect.arrayContaining(['community_project', 'island_event', 'island_progress']));
    expect(result.changes?.filter((change) => change.entityType === 'community_project').map((change) => change.entityId)).toEqual([world.projectId, next.id]);
    expect((await progressOf(world)).activeProject).toMatchObject({ projectId: next.id, templateKey: 'gartenhaeuschen_ausbau', sequenceNumber: 2, stage: 'gestartet' });

    // In das fertige Projekt zahlt niemand mehr ein; das nächste nimmt Einzahlungen an.
    const [late] = await push(world.backend, world.anna.device, [contributeOp({ projectId: world.projectId, amount: 1 })]);
    expect(rejectionOf(late)).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' }, canonical: { type: 'record', entityType: 'community_project' } });
    await contributeAs(world, world.anna.device, { projectId: next.id, amount: 4 });
  });

  it('zahlt nach einem Rollentausch in den Anteil der neuen Rolle ein; frühere Einzahlungen bleiben ihrem Anteil', async () => {
    const world = await projectWorld();
    await contributeAs(world, world.actor, { projectId: world.projectId, amount: 20 });
    await swapRoles(world);

    await contributeAs(world, world.actor, { projectId: world.projectId, amount: 4 });

    expect((await contributionsOf(world)).map(({ role, amount }) => [role, amount])).toEqual([['bauen', 20], ['natur', 4]]);
    // Bauen 20/20, Natur 4/20: 60 %.
    expect((await progressOf(world)).activeProject.stage).toBe('gut_unterwegs');
    // Anna hat jetzt Bauen; dieser Anteil ist schon voll.
    const [full] = await push(world.backend, world.anna.device, [contributeOp({ projectId: world.projectId, amount: 1 })]);
    expect(rejectionOf(full)).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
  });

  it('gibt dem Partner weder Einzahlungen noch Buchungen noch exakte Anteile', async () => {
    const world = await projectWorld();
    await contributeAs(world, world.actor, { projectId: world.projectId, amount: 7 });

    const { changes } = await pullAll(world.backend, world.anna.device);

    expect(changes.filter((change) => change.entityType === 'project_contribution')).toEqual([]);
    expect(changes.filter((change) => change.entityType === 'energy_booking' && change.type === 'record' && change.data.personId === world.philipp.personId)).toEqual([]);
    const progress = changes.filter((change) => change.entityType === 'island_progress').at(-1);
    expect(progress).toBeDefined();
    const serialized = JSON.stringify(progress);
    expect(serialized).not.toMatch(/amount|paid|ownCount|"7"|:7[,}]/);
    expect(Object.keys((progress as { data: Record<string, unknown> }).data.activeProject as object).sort()).toEqual(['projectId', 'sequenceNumber', 'stage', 'templateKey']);
    // Philipp bekommt seine eigene Einzahlung.
    const own = await pullAll(world.backend, world.actor);
    expect(own.changes.filter((change) => change.entityType === 'project_contribution')).toHaveLength(1);
  });
});

describe('Autorisierung von contributeToProject', () => {
  for (const testCase of authorizationCases({ ...contributeToProjectCommandScenario, command: 'contributeToProject' })) it(testCase.name, testCase.run, 30_000);

  it('lässt keinen Anteil des Partners wählen: Eine Rolle in der Nutzlast ist ungültig', async () => {
    const world = await projectWorld();
    const operation = contributeOp({ projectId: world.projectId });
    const [result] = await push(world.backend, world.actor, [{ ...operation, payload: { ...operation.payload, role: 'natur' } }]);
    expect(rejectionOf(result)).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await contributionsOf(world)).toEqual([]);
  }, 30_000);
});
