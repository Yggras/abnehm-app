import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { energyBookingId, summarizeEnergy, type EnergyBooking } from '@abnehm/contracts/energy';
import type { IslandProgress } from '@abnehm/contracts/island';

import { islandObject, islandProgress } from '../src/db/schema/index.ts';
import { readBookings } from '../src/energy/bookings.ts';
import { islandProgressRecord } from '../src/island/progress-projector.ts';
import { defaultPassword, newDevice, signIn } from './support/auth-client.ts';
import { authorizationCases } from './support/authorization.ts';
import {
  buildAs,
  builtWorld,
  fieldKeys,
  objectWorld,
  onField,
  placeObjectCommandScenario,
  placeOp,
  upgradeObjectCommandScenario,
  upgradeOp,
  type BuildWorld,
} from './support/building.ts';
import { installationB, push } from './support/sync.ts';

// Nachweis für #194 am Server: `upgradeObject` und `placeObject` mit echter Hono-App, isoliertem Postgres
// und Testuhr (Spezifikation 4, Testnaht 2). Philipp hat Bauen, Seite a der Grundinsel, eine Laterne in
// seiner Ecke (`grundinsel:0:0`) und danach 17 Energie.

async function stateOf(world: BuildWorld) {
  const db = world.backend.database.db;
  const bookings: EnergyBooking[] = (await readBookings(db, [world.philipp.personId as EntityId])).get(world.philipp.personId as EntityId)!;
  const [progress] = await db.select().from(islandProgress).where(eq(islandProgress.islandId, world.islandId));
  return {
    objects: await db.select().from(islandObject),
    upgrades: bookings.filter((booking) => booking.type === 'upgrade_debit'),
    balance: summarizeEnergy(bookings).balance,
    progress: islandProgressRecord(progress!),
  };
}

const halfOf = (progress: IslandProgress, personId: string) => progress.members.find((member) => member.personId === personId)!;
const objectIn = (state: Awaited<ReturnType<typeof stateOf>>, id: string) => state.objects.find((object) => object.id === id);
const rejectionOf = (result: unknown) => result as { type: string; error?: { code: string }; canonical?: { type: string; entityId?: string; data?: unknown } };

describe('upgradeObject', { timeout: 20_000 }, () => {
  it('Tracer: schreibt Stufe, upgrade_debit zum 2-Fachen des Grundpreises und den neuen Inselfortschritt atomar', async () => {
    const world = await objectWorld();
    const operation = upgradeOp({ islandObjectId: world.objectId });

    const [result] = await push(world.backend, world.actor, [operation]);

    expect(result).toMatchObject({ type: 'applied' });
    if (result?.type !== 'applied') return;
    expect(result.changes?.map((change) => change.entityType)).toEqual(['island_object', 'energy_booking', 'island_progress']);
    expect(result.changes?.[0]).toMatchObject({ entityId: world.objectId, data: { level: 2, fieldId: world.fieldId(fieldKeys.philippsEcke) } });
    // Laterne: Grundpreis 3, Stufe 2 kostet 6. Buchungsschlüssel ist die ID des Spielbefehls.
    const { commandId } = operation.payload;
    expect(result.changes?.[1]).toMatchObject({
      entityId: energyBookingId(commandId),
      data: { type: 'upgrade_debit', amount: -6, bookingKey: commandId, trigger: { commandId, islandObjectId: world.objectId, toLevel: 2 } },
    });
    const state = await stateOf(world);
    expect(state.balance).toBe(11);
    expect(objectIn(state, world.objectId)).toMatchObject({ level: 2 });
    // 3 gebaut + 6 aufgewertet = 9 von Bedarf(1) = 11 → 81 %.
    expect(halfOf(state.progress, world.philipp.personId)).toMatchObject({ halfPercent: 81, halfFull: false });
  });

  it('Stufe 3 kostet das 3-Fache; danach gibt es keine weitere Stufe', async () => {
    const world = await objectWorld();
    const results = await push(world.backend, world.actor, [
      upgradeOp({ islandObjectId: world.objectId, toLevel: 2 }),
      upgradeOp({ islandObjectId: world.objectId, toLevel: 3 }),
      upgradeOp({ islandObjectId: world.objectId, toLevel: 3 }),
    ]);

    expect(results.map((result) => result.type)).toEqual(['applied', 'applied', 'permanently_rejected']);
    const state = await stateOf(world);
    expect(state.upgrades.map((booking) => booking.amount)).toEqual([-6, -9]);
    expect(state.balance).toBe(2);
    expect(objectIn(state, world.objectId)).toMatchObject({ level: 3 });
  });

  it('dieselbe Aufwertung auf zwei Geräten kostet nur einmal: die zweite ist ein Konflikt mit dem kanonischen Objekt', async () => {
    const world = await objectWorld();
    const ipad = (await signIn(world.backend, 'philipp@example.test', defaultPassword, newDevice())).device;

    const [first] = await push(world.backend, world.actor, [upgradeOp({ islandObjectId: world.objectId })]);
    const [second] = await push(world.backend, ipad, [upgradeOp({ islandObjectId: world.objectId })], installationB);

    expect(first).toMatchObject({ type: 'applied' });
    expect(second).toMatchObject({
      type: 'permanently_rejected',
      error: { code: 'conflict' },
      canonical: { type: 'record', entityType: 'island_object', entityId: world.objectId, data: { level: 2 } },
    });
    const state = await stateOf(world);
    expect(state.upgrades).toHaveLength(1);
    expect(state.balance).toBe(11);
  });

  it('Retry und zweite Installation mit derselben Operation: genau eine Buchung', async () => {
    const world = await objectWorld();
    const operation = upgradeOp({ islandObjectId: world.objectId });
    const ipad = (await signIn(world.backend, 'philipp@example.test', defaultPassword, newDevice())).device;

    const [first] = await push(world.backend, world.actor, [operation]);
    const [retry] = await push(world.backend, world.actor, [operation]);
    const [otherInstallation] = await push(world.backend, ipad, [{ ...operation, operationId: EntityId.parse(randomUUID()) }], installationB);

    expect(first).toMatchObject({ type: 'applied' });
    expect(retry).toMatchObject({ type: 'already_applied', changes: first?.type === 'applied' ? first.changes : [] });
    expect(otherInstallation).toMatchObject({ type: 'already_applied' });
    const state = await stateOf(world);
    expect(state.upgrades).toHaveLength(1);
    expect(state.balance).toBe(11);
  });

  it('lehnt erst ab, wenn der Bestand danach unter −30 läge; eine Ablehnung schreibt nichts', async () => {
    const world = await builtWorld();
    // 4 Energie, neun Laternen: 4 − 27 = −23. Stufe 2 (6) führt auf −29, Stufe 3 (9) läge bei −38.
    const field = (index: number) => world.fieldId(`grundinsel:${index % 4}:${Math.floor(index / 4)}`);
    const ids: EntityId[] = [];
    for (let index = 0; index < 9; index++) ids.push(await buildAs(world, world.actor, { fieldId: field(index) }));

    const results = await push(world.backend, world.actor, [
      upgradeOp({ islandObjectId: ids[0]!, toLevel: 2 }),
      upgradeOp({ islandObjectId: ids[0]!, toLevel: 3 }),
    ]);

    expect(results[0]).toMatchObject({ type: 'applied' });
    expect(results[1]).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' }, canonical: { data: { level: 2 } } });
    const state = await stateOf(world);
    expect(state.balance).toBe(-29);
    expect(state.upgrades).toHaveLength(1);
  });

  it('nur genau eine Stufe weiter: Stufe 1 direkt auf 3 ist ein Konflikt', async () => {
    const world = await objectWorld();
    const [result] = await push(world.backend, world.actor, [upgradeOp({ islandObjectId: world.objectId, toLevel: 3 })]);
    expect(rejectionOf(result)).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' }, canonical: { data: { level: 1 } } });
    expect((await stateOf(world)).upgrades).toEqual([]);
  });
});

describe('placeObject', { timeout: 20_000 }, () => {
  it('Umstellen: das Objekt wechselt kostenlos auf ein freies eigenes Feld', async () => {
    const world = await objectWorld();
    const before = await stateOf(world);
    const target = world.fieldId(fieldKeys.philippsEcke2);

    const [result] = await push(world.backend, world.actor, [placeOp(world.objectId, onField(target))]);

    expect(result).toMatchObject({ type: 'applied' });
    if (result?.type !== 'applied') return;
    expect(result.changes?.map((change) => change.entityType)).toEqual(['island_object']);
    expect(result.changes?.[0]).toMatchObject({ entityId: world.objectId, data: { fieldId: target, level: 1 } });
    const after = await stateOf(world);
    expect(after.balance).toBe(before.balance);
    expect(after.progress.members).toEqual(before.progress.members);
  });

  it('Einlagern ist Platzieren im Lager; aus dem Lager platziert, steht es wieder auf einem Feld', async () => {
    const world = await objectWorld();
    const target = world.fieldId(fieldKeys.philippsRollenbereich);

    const [stored] = await push(world.backend, world.actor, [placeOp(world.objectId, { type: 'lager' })]);
    expect(stored).toMatchObject({ type: 'applied', changes: [{ entityId: world.objectId, data: { fieldId: null } }] });
    // Noch einmal einlagern ändert nichts.
    const [again] = await push(world.backend, world.actor, [placeOp(world.objectId, { type: 'lager' })]);
    expect(again).toMatchObject({ type: 'applied', changes: [{ entityId: world.objectId, data: { fieldId: null } }] });
    const [placed] = await push(world.backend, world.actor, [placeOp(world.objectId, onField(target))]);
    expect(placed).toMatchObject({ type: 'applied', changes: [{ entityId: world.objectId, data: { fieldId: target } }] });
    // Die verbaute Energie bleibt der Insel, auch im Lager.
    expect(halfOf((await stateOf(world)).progress, world.philipp.personId).halfPercent).toBe(27);
  });

  it('Feldkonflikt: Ein auf dem Server belegtes Feld verdrängt das ältere Objekt atomar ins Lager', async () => {
    const world = await objectWorld();
    const first = world.fieldId(fieldKeys.philippsEcke);
    const second = await buildAs(world, world.actor, { fieldId: world.fieldId(fieldKeys.philippsEcke2), blueprintKey: 'holzweg' });

    const [result] = await push(world.backend, world.actor, [placeOp(second, onField(first))]);

    expect(result).toMatchObject({ type: 'applied' });
    if (result?.type !== 'applied') return;
    expect(result.changes?.map((change) => [change.entityId, change.type === 'record' && (change.data as { fieldId: string | null }).fieldId])).toEqual([
      [world.objectId, null],
      [second, first],
    ]);
    const state = await stateOf(world);
    expect(objectIn(state, world.objectId)).toMatchObject({ fieldId: null, level: 1 });
    expect(objectIn(state, second)).toMatchObject({ fieldId: first });
  });

  it('wendet die Platzierungsregeln an: im Rollenbereich nur Gebautes der eigenen Rolle', async () => {
    const world = await objectWorld();
    // Ein Apfelbaum (Natur) darf in Philipps Ecke, aber nicht in seinen Rollenbereich (Bauen).
    const apfelbaum = await buildAs(world, world.actor, { fieldId: world.fieldId(fieldKeys.philippsEcke2), blueprintKey: 'apfelbaum' });

    const [result] = await push(world.backend, world.actor, [placeOp(apfelbaum, onField(world.fieldId(fieldKeys.philippsRollenbereich)))]);

    expect(rejectionOf(result)).toMatchObject({
      type: 'permanently_rejected',
      error: { code: 'conflict' },
      canonical: { type: 'record', entityId: apfelbaum, data: { fieldId: world.fieldId(fieldKeys.philippsEcke2) } },
    });
  });

  it('Retry: dieselbe Operation liefert dasselbe Ergebnis und verschiebt nichts erneut', async () => {
    const world = await objectWorld();
    const operation = placeOp(world.objectId, { type: 'lager' });
    const [first] = await push(world.backend, world.actor, [operation]);
    await push(world.backend, world.actor, [placeOp(world.objectId, onField(world.fieldId(fieldKeys.philippsEcke2)))]);

    const [retry] = await push(world.backend, world.actor, [operation]);

    expect(retry).toMatchObject({ type: 'already_applied', changes: first?.type === 'applied' ? first.changes : [] });
    expect(objectIn(await stateOf(world), world.objectId)).toMatchObject({ fieldId: world.fieldId(fieldKeys.philippsEcke2) });
  });
});

describe('Autorisierung von upgradeObject', () => {
  for (const testCase of authorizationCases({ ...upgradeObjectCommandScenario, command: 'upgradeObject' })) it(testCase.name, testCase.run, 60_000);
});

describe('Autorisierung von placeObject', () => {
  for (const testCase of authorizationCases({ ...placeObjectCommandScenario, command: 'placeObject' })) it(testCase.name, testCase.run, 60_000);
});
