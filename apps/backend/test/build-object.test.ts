import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { energyBookingId, summarizeEnergy, type EnergyBooking } from '@abnehm/contracts/energy';
import { IslandProgress } from '@abnehm/contracts/island';

import { energyBooking, islandObject, islandProgress } from '../src/db/schema/index.ts';
import { readBookings } from '../src/energy/bookings.ts';
import { correctBooking } from '../src/island/booking-correction.ts';
import { islandProgressRecord } from '../src/island/progress-projector.ts';
import { authorizationCases } from './support/authorization.ts';
import { buildObjectCommandScenario, buildOp, builtWorld, fieldKeys, lockBlueprint, type BuildWorld } from './support/building.ts';
import { worldStart } from './support/coupled-world.ts';
import { defaultPassword, newDevice, signIn } from './support/auth-client.ts';
import { installationB, push } from './support/sync.ts';

// Nachweis für #191 am Server: `buildObject` mit echter Hono-App, isoliertem Postgres und Testuhr
// (Spezifikation 4, Testnaht 2). Philipp hat Bauen, Seite a der Grundinsel und 4 Energie.

async function stateOf(world: BuildWorld) {
  const db = world.backend.database.db;
  const bookings: EnergyBooking[] = (await readBookings(db, [world.philipp.personId as EntityId])).get(world.philipp.personId as EntityId)!;
  const [progress] = await db.select().from(islandProgress).where(eq(islandProgress.islandId, world.islandId));
  return {
    objects: await db.select().from(islandObject),
    builds: bookings.filter((booking) => booking.type === 'build_debit'),
    balance: summarizeEnergy(bookings).balance,
    progress: islandProgressRecord(progress!),
  };
}

const halfOf = (progress: IslandProgress, personId: string) => progress.members.find((member) => member.personId === personId)!;

describe('buildObject', { timeout: 20_000 }, () => {
  it('Tracer: schreibt Objekt, Feldbelegung, build_debit und den neuen Inselfortschritt atomar in einem Befehl', async () => {
    const world = await builtWorld();
    const fieldId = world.fieldId(fieldKeys.philippsEcke);
    const operation = buildOp({ fieldId });

    const [result] = await push(world.backend, world.philipp.device, [operation]);

    const { commandId, islandObjectId } = operation.payload;
    expect(result).toMatchObject({ type: 'applied' });
    if (result?.type !== 'applied') return;
    expect(result.changes?.map((change) => change.entityType)).toEqual(['island_object', 'energy_booking', 'island_progress']);
    expect(result.changes?.[0]).toMatchObject({
      entityId: islandObjectId,
      data: { ownerPersonId: world.philipp.personId, catalogKey: 'laterne', origin: 'gebaut', level: 1, fieldId, islandId: world.islandId },
    });
    // Preis aus dem Katalog (Start-Bauplan Laterne: 3), Buchungsschlüssel ist die ID des Spielbefehls.
    expect(result.changes?.[1]).toMatchObject({
      entityId: energyBookingId(commandId),
      data: { type: 'build_debit', amount: -3, bookingKey: commandId, trigger: { commandId, islandObjectId } },
    });
    const state = await stateOf(world);
    expect(state.balance).toBe(1);
    // Bedarf(1) = 11; 3/11 → 27 %. Ein Levelaufstieg entsteht erst, wenn auch Anna ihre Hälfte füllt.
    expect(state.progress).toMatchObject({ level: 1, levelNeed: 11, dataAsOf: worldStart.instant });
    expect(halfOf(state.progress, world.philipp.personId)).toEqual({ personId: world.philipp.personId, halfPercent: 27, halfFull: false });
    expect(halfOf(state.progress, world.anna.personId)).toMatchObject({ halfPercent: 0 });
  });

  it('die serialisierte Projektion enthält weder Energiemengen noch exakte Anteile', async () => {
    const world = await builtWorld();
    const [result] = await push(world.backend, world.philipp.device, [buildOp({ fieldId: world.fieldId(fieldKeys.philippsEcke) })]);
    const progress = result?.type === 'applied' ? result.changes?.find((change) => change.entityType === 'island_progress') : undefined;
    expect(progress?.type === 'record' && IslandProgress.parse(progress.data)).toBeTruthy();
    const keys = JSON.stringify(progress).match(/"[a-zA-Z]+":/g)!.map((key) => key.slice(1, -2));
    expect(keys).not.toEqual(expect.arrayContaining(['amount', 'balance', 'spent', 'paid', 'energy']));
  });

  it('Retry und zweite Installation: genau ein Objekt und eine Buchung', async () => {
    const world = await builtWorld();
    const operation = buildOp({ fieldId: world.fieldId(fieldKeys.philippsEcke) });
    const second = (await signIn(world.backend, 'philipp@example.test', defaultPassword, newDevice())).device;

    const [first] = await push(world.backend, world.philipp.device, [operation]);
    const [retry] = await push(world.backend, world.philipp.device, [operation]);
    const [otherInstallation] = await push(world.backend, second, [{ ...operation, operationId: EntityId.parse(randomUUID()) }], installationB);

    expect(first).toMatchObject({ type: 'applied' });
    expect(retry).toMatchObject({ type: 'already_applied', changes: first?.type === 'applied' ? first.changes : [] });
    expect(otherInstallation).toMatchObject({ type: 'already_applied' });
    const state = await stateOf(world);
    expect(state.objects).toHaveLength(1);
    expect(state.builds).toHaveLength(1);
    expect(state.balance).toBe(1);
  });

  it('lehnt erst ab, wenn der Bestand danach unter −30 läge', async () => {
    const world = await builtWorld();
    const field = (index: number) => world.fieldId(`grundinsel:${index % 4}:${Math.floor(index / 4)}`);
    // 4 − 11 × 3 = −29: erlaubt. Der zwölfte Bau läge bei −32.
    const results = await push(world.backend, world.philipp.device, Array.from({ length: 12 }, (_, index) => buildOp({ fieldId: field(index) })));

    expect(results.slice(0, 11).every((result) => result.type === 'applied')).toBe(true);
    expect(results[11]).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
    const state = await stateOf(world);
    expect(state.balance).toBe(-29);
    expect(state.objects).toHaveLength(11);
  });

  it('prüft Katalogschlüssel, Freischaltung und Rolle; eine Ablehnung schreibt nichts', async () => {
    const world = await builtWorld();
    await lockBlueprint(world, 'sitzbank');
    const results = await push(world.backend, world.philipp.device, [
      buildOp({ fieldId: world.fieldId(fieldKeys.philippsEcke), blueprintKey: 'goldturm' }),
      buildOp({ fieldId: world.fieldId(fieldKeys.philippsEcke), blueprintKey: 'sitzbank' }),
      // Im Rollenbereich nur Baupläne der eigenen Rolle; Philipp hat Bauen.
      buildOp({ fieldId: world.fieldId(fieldKeys.philippsRollenbereich), blueprintKey: 'apfelbaum' }),
    ]);

    expect(results.map((result) => result.type === 'permanently_rejected' && result.error.code)).toEqual(['unknown_catalog_key', 'conflict', 'conflict']);
    const state = await stateOf(world);
    expect(state.objects).toEqual([]);
    expect(state.builds).toEqual([]);
    expect(halfOf(state.progress, world.philipp.personId).halfPercent).toBe(0);
  });

  it('ein schon belegtes eigenes Feld: das ältere Objekt wechselt ins Lager, keine Energie geht verloren', async () => {
    const world = await builtWorld();
    const fieldId = world.fieldId(fieldKeys.philippsEcke);
    const first = buildOp({ fieldId, blueprintKey: 'holzweg' });
    const second = buildOp({ fieldId, blueprintKey: 'holzweg' });

    const [, displacing] = await push(world.backend, world.philipp.device, [first, second]);

    expect(displacing).toMatchObject({ type: 'applied' });
    if (displacing?.type !== 'applied') return;
    expect(displacing.changes?.map((change) => change.entityType)).toEqual(['island_object', 'island_object', 'energy_booking', 'island_progress']);
    const state = await stateOf(world);
    expect(state.objects.find((object) => object.id === first.payload.islandObjectId)).toMatchObject({ fieldId: null });
    expect(state.objects.find((object) => object.id === second.payload.islandObjectId)).toMatchObject({ fieldId });
    expect(state.balance).toBe(2);
  });
});

describe('Gegenbuchung einer Ausgabe', { timeout: 20_000 }, () => {
  it('Ausgabe plus Gegenbuchung ergibt denselben Bestand und dieselbe Hälfte wie vorher; die Projektion folgt im selben Aufruf', async () => {
    const world = await builtWorld();
    const before = await stateOf(world);
    const operation = buildOp({ fieldId: world.fieldId(fieldKeys.philippsEcke) });
    await push(world.backend, world.philipp.device, [operation]);
    expect(halfOf((await stateOf(world)).progress, world.philipp.personId).halfPercent).toBe(27);

    const changes = await world.backend.database.db.transaction((tx) =>
      correctBooking(tx, { originalBookingId: energyBookingId(operation.payload.commandId), at: new Date(worldStart.instant) }),
    );

    expect(changes.map((change) => change.entityType)).toEqual(['energy_booking', 'island_progress']);
    expect(changes[0]).toMatchObject({ data: { type: 'counter_booking', amount: 3, trigger: { originalType: 'build_debit', originalAmount: -3 } } });
    const after = await stateOf(world);
    expect(after.balance).toBe(before.balance);
    expect(halfOf(after.progress, world.philipp.personId)).toEqual(halfOf(before.progress, world.philipp.personId));
    // Das Objekt bleibt stehen; korrigiert wird nur die Buchung.
    expect(after.objects).toHaveLength(1);
  });

  it('eine Gutschrift lässt sich korrigieren, ohne dass sich der Inselfortschritt ändert', async () => {
    const world = await builtWorld();
    const [credit] = await world.backend.database.db.select().from(energyBooking).where(eq(energyBooking.type, 'daily_goal_credit'));
    const changes = await world.backend.database.db.transaction((tx) => correctBooking(tx, { originalBookingId: EntityId.parse(credit!.id), at: new Date(worldStart.instant) }));
    expect(changes.map((change) => change.entityType)).toEqual(['energy_booking']);
    expect((await stateOf(world)).balance).toBe(3);
  });
});

describe('Autorisierung von buildObject', () => {
  for (const testCase of authorizationCases({ ...buildObjectCommandScenario, command: 'buildObject' })) it(testCase.name, testCase.run, 30_000);
});
