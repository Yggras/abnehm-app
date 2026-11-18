import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant } from '@abnehm/contracts/base';
import { EnergyBooking } from '@abnehm/contracts/energy';
import { IslandProgress, type IslandRole } from '@abnehm/contracts/island';
import { gameCatalog } from '@abnehm/game-rules/content';

import { blueprintUnlock, communityProject, island, islandEvent, islandField, islandObject, islandProgress, notificationIntent } from '../src/db/schema/index.ts';
import { insertBooking } from '../src/energy/bookings.ts';
import { projectIslandProgress } from '../src/island/progress-projector.ts';
import { createTestBackend } from './support/app.ts';
import { personWithSession } from './support/authorization.ts';
import { coupleByInvitation, worldStart } from './support/coupled-world.ts';
import { actionIdOf, decideOp, recordsOf, requestOp } from './support/shared-actions.ts';
import { installationB, pullAll, push } from './support/sync.ts';

// Nachweis für #184: Die Annahme der Rollenwahl ist das Schlüpfen (Spezifikation 4, Abschnitte 2.1, 2.4,
// 5 und 7), über Push und Pull der echten Hono-App mit isoliertem Postgres und Testuhr. Die erwarteten
// Werte stehen in der Spezifikation: Grundinsel 16 × 12 mit je Person 60 Feldern (`content/base-island.ts`),
// drei Start-Baupläne je Rolle, Projekt 1 mit Bedarf 20 je Anteil, Level 1 mit Bedarf 11 je Hälfte.

const hatchedAt = new Date('2026-10-14T12:05:00.000Z');
/** Zone des annehmenden Geräts; sie wird die Zeitzone der Insel, nicht die der Personen (Europe/Berlin). */
const acceptingZone = 'Europe/Vienna';

async function roleChoiceOpen(proposerRole: IslandRole = 'natur') {
  const clock = createTestClock(worldStart);
  const backend = await createTestBackend({ clock });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const { couplingId } = await coupleByInvitation(backend, philipp.device, anna.device);
  const proposal = requestOp({ type: 'rollenwahl', actionId: EntityId.parse(randomUUID()), payload: { proposerRole } });
  await push(backend, anna.device, [proposal]);
  clock.set(Instant.parse(hatchedAt.toISOString()));
  const accept = decideOp(actionIdOf(proposal), 'annehmen', { timeZone: acceptingZone });
  const [{ id: islandId }] = (await backend.database.db.select({ id: island.id }).from(island).where(eq(island.couplingId, couplingId))) as [{ id: string }];
  return { backend, philipp, anna, couplingId: EntityId.parse(couplingId), islandId: EntityId.parse(islandId), actionId: actionIdOf(proposal), accept };
}

const values = <T>(records: Record<string, T>) => Object.values(records);

// Zwei Geräte mit vollständigem Pull der Grundinsel: unter Parallellast länger als die üblichen 5 s.
describe('Schlüpfen', { timeout: 20_000 }, () => {
  it('Tracer Bullet: Anna schlägt Natur vor, Philipp nimmt an; beide sehen danach dieselbe geschlüpfte Insel', async () => {
    const { backend, philipp, anna, couplingId, islandId, accept } = await roleChoiceOpen('natur');

    expect(await push(backend, philipp.device, [accept])).toMatchObject([{ type: 'applied', changes: [{ data: { status: 'angenommen' } }] }]);

    for (const person of [philipp, anna]) {
      const { changes } = await pullAll(backend, person.device);
      expect(values(recordsOf(changes, 'island'))).toEqual([
        expect.objectContaining({ couplingId, state: 'aktiv', hatchedAt: hatchedAt.toISOString(), timeZone: acceptingZone }),
      ]);
      const roles = Object.fromEntries(values(recordsOf(changes, 'coupling_member')).map((member) => [member.personId, member.role]));
      expect(roles).toEqual({ [anna.personId]: 'natur', [philipp.personId]: 'bauen' });

      const fields = values(recordsOf(changes, 'island_field'));
      expect(fields).toHaveLength(16 * 12);
      // Seite a gehört der Person mit Bauen: Philipp; Seite b Anna.
      const owner = (fieldKey: string) => fields.find((field) => field.fieldKey === fieldKey)?.ownerPersonId;
      expect(owner('grundinsel:0:0')).toBe(philipp.personId);
      expect(owner('grundinsel:15:0')).toBe(anna.personId);
      expect(owner('grundinsel:7:7')).toBeNull();
      expect(fields.filter((field) => field.ownerPersonId === philipp.personId)).toHaveLength(60);
      expect(fields.filter((field) => field.ownerPersonId === anna.personId)).toHaveLength(60);

      expect(values(recordsOf(changes, 'blueprint_unlock')).map((unlock) => [unlock.catalogKey, unlock.reason]).sort()).toEqual(
        [['apfelbaum', 'start'], ['beerenstrauch', 'start'], ['blumenwiese', 'start'], ['holzweg', 'start'], ['laterne', 'start'], ['sitzbank', 'start']],
      );
      const [project] = values(recordsOf(changes, 'community_project'));
      expect(project).toMatchObject({ islandId, sequenceNumber: 1, templateKey: gameCatalog.projects[0]!.key, buildNeed: 20, natureNeed: 20, status: 'aktiv' });
      expect(values(recordsOf(changes, 'island_event'))).toEqual([
        expect.objectContaining({ islandId, type: 'momo_geschluepft', status: 'abgeschlossen', occurredAt: hatchedAt.toISOString() }),
      ]);
      const [progress] = values(recordsOf(changes, 'island_progress'));
      expect(IslandProgress.parse(progress)).toMatchObject({
        islandId,
        couplingId,
        level: 1,
        levelNeed: 11,
        members: expect.arrayContaining([
          { personId: philipp.personId, halfPercent: 0, halfFull: false },
          { personId: anna.personId, halfPercent: 0, halfFull: false },
        ]),
        activeProject: { projectId: expect.any(String), templateKey: gameCatalog.projects[0]!.key, sequenceNumber: 1, stage: 'gestartet' },
      });
    }
  });

  it('bei Wiederholung derselben Annahme entsteht das Ereignis genau einmal', async () => {
    const { backend, philipp, islandId, accept } = await roleChoiceOpen();

    await push(backend, philipp.device, [accept]);
    expect(await push(backend, philipp.device, [accept])).toMatchObject([{ type: 'already_applied' }]);

    const events = await backend.database.db.select().from(islandEvent).where(eq(islandEvent.islandId, islandId));
    expect(events.map((event) => event.type)).toEqual(['momo_geschluepft']);
    expect(await backend.database.db.select().from(islandField).where(eq(islandField.islandId, islandId))).toHaveLength(16 * 12);
  });

  it('zwei Installationen: nimmt Philipps zweites Gerät mit eigener Operation ebenfalls an, schlüpft Momo nur einmal', async () => {
    const { backend, philipp, actionId, islandId, accept } = await roleChoiceOpen();
    await push(backend, philipp.device, [accept]);

    // Dieselbe Entscheidung derselben Person, aber eine andere Operation von einer anderen Installation.
    const fromIpad = decideOp(actionId, 'annehmen', { timeZone: acceptingZone });
    const [result] = await push(backend, philipp.device, [fromIpad], installationB);

    expect(result?.type).not.toBe('applied');
    const db = backend.database.db;
    expect((await db.select().from(islandEvent).where(eq(islandEvent.islandId, islandId))).map((event) => event.type)).toEqual(['momo_geschluepft']);
    expect(await db.select().from(islandField).where(eq(islandField.islandId, islandId))).toHaveLength(16 * 12);
    expect(await db.select().from(communityProject).where(eq(communityProject.islandId, islandId))).toHaveLength(1);
  });

  it('atomar: scheitert ein Teil, bleibt nichts zurück, und der Vorschlag bleibt offen', async () => {
    const { backend, philipp, anna, couplingId, islandId, actionId, accept } = await roleChoiceOpen();
    // Eine schon vorhandene Freischaltung lässt das Schlüpfen mitten in der Materialisierung scheitern.
    await backend.database.db.insert(blueprintUnlock).values({
      id: randomUUID(), islandId, couplingId, catalogKey: 'laterne', reason: 'start', unlockedAt: hatchedAt, createdAt: hatchedAt, serverVersion: 1n,
    });

    expect(await push(backend, philipp.device, [accept])).toMatchObject([{ type: 'permanently_rejected', error: { code: 'conflict' } }]);

    const db = backend.database.db;
    expect(await db.select({ state: island.state, hatchedAt: island.hatchedAt, timeZone: island.timeZone }).from(island).where(eq(island.id, islandId))).toEqual([
      { state: 'wartet_auf_rollen', hatchedAt: null, timeZone: null },
    ]);
    expect(await db.select().from(islandField).where(eq(islandField.islandId, islandId))).toEqual([]);
    expect(await db.select().from(blueprintUnlock).where(eq(blueprintUnlock.islandId, islandId))).toHaveLength(1);
    expect(await db.select().from(communityProject).where(eq(communityProject.islandId, islandId))).toEqual([]);
    expect(await db.select().from(islandEvent).where(eq(islandEvent.islandId, islandId))).toEqual([]);
    expect(await db.select().from(islandProgress).where(eq(islandProgress.islandId, islandId))).toEqual([]);
    const { changes } = await pullAll(backend, anna.device);
    expect(values(recordsOf(changes, 'coupling_member')).map((member) => member.role)).toEqual([null, null]);
    expect(recordsOf(changes, 'shared_action')[actionId]).toMatchObject({ status: 'offen' });
    // Nur der Intent des Vorschlags an Philipp, keiner aus dem gescheiterten Schlüpfen.
    expect((await db.select().from(notificationIntent)).map((intent) => intent.type)).toEqual(['rollen_anfrage']);
  });

  it('nach dem Schlüpfen lässt sich keine weitere Rollenwahl vorschlagen', async () => {
    const { backend, philipp, anna, accept } = await roleChoiceOpen();
    await push(backend, philipp.device, [accept]);

    const again = requestOp({ type: 'rollenwahl', actionId: EntityId.parse(randomUUID()), payload: { proposerRole: 'bauen' } });
    expect(await push(backend, anna.device, [again])).toMatchObject([{ type: 'permanently_rejected', error: { code: 'conflict' } }]);
  });
});

describe('Projector Inselfortschritt', { timeout: 20_000 }, () => {
  it('rechnet Level und Hälften aus den Buchungen beider Personen; die Projektion enthält weder Energiemengen noch exakte Anteile', async () => {
    const { backend, philipp, anna, couplingId, islandId, accept } = await roleChoiceOpen();
    await push(backend, philipp.device, [accept]);
    const db = backend.database.db;
    // Philipp verbaut 7, Anna 4 Energie auf dieser Insel (Bedarf(1) = 11): 7/11 → 63 %, 4/11 → 36 %.
    const spend = async (personId: string, catalogKey: string, amount: number) => {
      const objectId = EntityId.parse(randomUUID());
      await db.insert(islandObject).values({
        id: objectId, islandId, couplingId, ownerPersonId: personId, catalogKey, origin: 'gebaut', level: 1, fieldId: null,
        createdAt: hatchedAt, updatedAt: hatchedAt, serverVersion: 1n,
      });
      // Der Buchungsschlüssel eines Spielbefehls ist seine Befehls-ID (Vertrag `EnergyBooking`).
      const commandId = EntityId.parse(randomUUID());
      await insertBooking(
        db,
        EnergyBooking.parse({
          type: 'build_debit', id: EntityId.parse(randomUUID()), personId, amount: -amount, localDate: '2026-10-14',
          bookingKey: commandId, createdAt: hatchedAt.toISOString(), trigger: { commandId, islandObjectId: objectId },
        }),
      );
    };
    await spend(philipp.personId, 'laterne', 3);
    await spend(philipp.personId, 'holzweg', 4);
    await spend(anna.personId, 'apfelbaum', 4);

    await db.transaction((tx) => projectIslandProgress(tx, { islandId, at: hatchedAt }));

    const { changes } = await pullAll(backend, anna.device);
    const [record] = values(recordsOf(changes, 'island_progress'));
    expect(record).toEqual(
      IslandProgress.parse({
        islandId,
        couplingId,
        level: 1,
        levelNeed: 11,
        members: [philipp.personId, anna.personId].sort().map((personId) => ({
          personId,
          halfPercent: personId === philipp.personId ? 63 : 36,
          halfFull: false,
        })),
        activeProject: (record as { activeProject: unknown }).activeProject,
        dataAsOf: hatchedAt.toISOString(),
        serverVersion: (record as { serverVersion: string }).serverVersion,
      }),
    );
    // Die serialisierte Projektion kennt nur die Felder des Vertrags; verbaute Mengen (7, 4) und Bestände fehlen.
    const serialized = JSON.stringify(record);
    expect(Object.keys(record!).sort()).toEqual(['activeProject', 'couplingId', 'dataAsOf', 'islandId', 'level', 'levelNeed', 'members', 'serverVersion']);
    expect(serialized).not.toMatch(/"(amount|spent|energy|balance|paid|ownCount|need)"/i);
    expect(serialized).not.toMatch(/:(7|4),/);
  });
});
