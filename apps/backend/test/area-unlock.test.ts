import { and, eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { islandEventId, islandEventStateId } from '@abnehm/contracts/island-records';
import { areaOccasionKey } from '@abnehm/game-rules/areas';
import { testCatalog } from '@abnehm/game-rules/fixtures';
import { levelThreshold } from '@abnehm/game-rules/progress';

import { areaUnlock, islandEvent, islandEventState, islandField, notificationIntent } from '../src/db/schema/index.ts';
import { progressChanges } from '../src/island/progress-change.ts';
import { builtWorld, type BuildWorld } from './support/building.ts';
import { spendWithoutProjection, unlocksOf } from './support/level-up.ts';

// Nachweis für #204 am Server: Gebietsfreischaltung und Entdeckung im Befehl des Levelaufstiegs, mit dem
// Test-Katalog der Spielregeln (Gebiete bei Level 4 und 8, zwei Landschaftsvorlagen). Verbaute Energie entsteht
// direkt in der Datenbank; den Inselfortschritt berechnet danach `progressChanges` wie jeder Spielbefehl in
// seiner Transaktion. Philipp hat Seite a (Bauen), Anna Seite b (Natur).

const catalog = testCatalog();

/** Beide verbauen so viel, dass die Insel `level` erreicht; je Aufruf ein eigenes Feld der Ecke. */
async function reach(world: BuildWorld, level: number, row: number) {
  const spent = await spentSoFar(world);
  const amount = levelThreshold(level) - spent;
  await spendWithoutProjection(world, world.anna, { fieldKey: `grundinsel:12:${row}`, amount });
  await spendWithoutProjection(world, world.philipp, { fieldKey: `grundinsel:0:${row}`, amount });
  spentByWorld.set(world, spent + amount);
  const at = new Date(world.clock.read().instant);
  return world.backend.database.db.transaction((tx) => progressChanges(tx, world.islandId, at, catalog));
}
const spentByWorld = new WeakMap<BuildWorld, number>();
const spentSoFar = async (world: BuildWorld) => spentByWorld.get(world) ?? 0;

const db = (world: BuildWorld) => world.backend.database.db;

async function areaOf(world: BuildWorld, areaKey: string) {
  const [unlock] = await db(world).select().from(areaUnlock).where(and(eq(areaUnlock.islandId, world.islandId), eq(areaUnlock.areaKey, areaKey)));
  const fields = await db(world).select().from(islandField).where(and(eq(islandField.islandId, world.islandId), like(islandField.fieldKey, `${areaKey}:%`)));
  const eventId = islandEventId(world.islandId, areaOccasionKey(world.islandId, areaKey));
  const [event] = await db(world).select().from(islandEvent).where(eq(islandEvent.id, eventId));
  const states = await db(world).select().from(islandEventState).where(eq(islandEventState.islandEventId, eventId));
  return { unlock, fields, eventId, event, states };
}

const areaIntents = (world: BuildWorld) => db(world).select().from(notificationIntent).where(eq(notificationIntent.type, 'gebiet'));

describe('Gebietsfreischaltung im Befehl des Levelaufstiegs', { timeout: 60_000 }, () => {
  it('schaltet bei Level 4 Gebiet, Felder für beide, Entdeckung und Intents im selben Befehl frei', async () => {
    const world = await builtWorld();

    const changes = await reach(world, 4, 1);

    const area = await areaOf(world, 't_gebiet_1');
    expect(area.unlock).toMatchObject({ areaKey: 't_gebiet_1', level: 4, couplingId: world.couplingId });
    // Je Person +10 Ecke und +30 Rollenbereich; Seite a gehört Philipp, Seite b Anna.
    expect(area.fields).toHaveLength(80);
    const owners = new Map(area.fields.map((field) => [field.fieldKey, field.ownerPersonId]));
    expect(owners.get('t_gebiet_1:0:-5')).toBe(world.philipp.personId);
    expect(owners.get('t_gebiet_1:15:-1')).toBe(world.anna.personId);
    expect(area.fields.filter((field) => field.ownerPersonId === world.philipp.personId)).toHaveLength(40);

    // Die Entdeckung schaltet ihre Baupläne für die Insel frei und wartet mit der Deko auf beide.
    const unlocks = await unlocksOf(world);
    expect(unlocks.filter((unlock) => unlock.reason === 'entdeckung').map((unlock) => unlock.key)).toEqual([
      't_ent_bauen_1a',
      't_ent_bauen_1b',
      't_ent_natur_1a',
      't_ent_natur_1b',
    ]);
    expect(area.event).toMatchObject({
      type: 'entdeckung',
      occasionKey: `gebiet:${world.islandId}:t_gebiet_1`,
      responsiblePersonId: null,
      status: 'erfuellbar',
      reward: { areaKey: 't_gebiet_1', blueprints: ['t_ent_bauen_1a', 't_ent_bauen_1b', 't_ent_natur_1a', 't_ent_natur_1b'], deko: ['t_ent_deko_1'] },
    });
    expect(area.states.map((state) => [state.id, state.personId, state.seenAt, state.claimedAt]).sort()).toEqual(
      [world.philipp.personId, world.anna.personId].map((personId) => [islandEventStateId(area.eventId, EntityId.parse(personId)), personId, null, null]).sort(),
    );

    const intents = await areaIntents(world);
    expect(intents.map((intent) => intent.recipientPersonId).sort()).toEqual([world.anna.personId, world.philipp.personId].sort());
    for (const intent of intents) expect(intent).toMatchObject({ sourceEventId: area.eventId, messageKey: 'gebiet', payload: { gebietKey: 't_gebiet_1' } });

    // Die Antwort trägt Gebiet, Felder, Baupläne und Ereignis; die Ereignisstände kommen je Person mit dem Pull.
    const count = (entityType: string) => changes.filter((change) => change.entityType === entityType).length;
    expect([count('area_unlock'), count('island_field'), count('island_event_state')]).toEqual([1, 80, 0]);
    expect(changes.some((change) => change.entityType === 'island_event' && change.entityId === area.eventId)).toBe(true);
  });

  it('ist idempotent: eine erneute Berechnung schreibt weder Gebiet noch Entdeckung noch Intent', async () => {
    const world = await builtWorld();
    await reach(world, 4, 1);
    const before = { area: await areaOf(world, 't_gebiet_1'), intents: await areaIntents(world), unlocks: await unlocksOf(world) };

    const at = new Date(world.clock.read().instant);
    const changes = await db(world).transaction((tx) => progressChanges(tx, world.islandId, at, catalog));

    expect(changes.map((change) => change.entityType)).toEqual(['island_progress']);
    expect({ area: await areaOf(world, 't_gebiet_1'), intents: await areaIntents(world), unlocks: await unlocksOf(world) }).toEqual(before);
  });

  it('zwischen den Formlevels schaltet kein Gebiet frei', async () => {
    const world = await builtWorld();
    await reach(world, 3, 1);
    expect(await db(world).select().from(areaUnlock).where(eq(areaUnlock.islandId, world.islandId))).toEqual([]);
    expect(await areaIntents(world)).toEqual([]);
  });
});

describe('Endlose Gebiete mit Test-Katalog', { timeout: 60_000 }, () => {
  it('nutzt bei 49 und 55 die nächste Landschaftsvorlage, ohne neue Form und ohne Deko; je Befehl ein Push für das neueste Gebiet', async () => {
    const world = await builtWorld();

    await reach(world, 49, 1);

    const areas = await db(world).select({ key: areaUnlock.areaKey, level: areaUnlock.level }).from(areaUnlock).where(eq(areaUnlock.islandId, world.islandId));
    expect(areas.sort((a, b) => a.level - b.level)).toEqual([
      { key: 't_gebiet_1', level: 4 },
      { key: 't_gebiet_2', level: 8 },
      { key: 'endlos_1_t_vorlage_erste', level: 49 },
    ]);
    const first = await areaOf(world, 'endlos_1_t_vorlage_erste');
    expect(first.fields).toHaveLength(80);
    expect(first.fields.find((field) => field.fieldKey === 'endlos_1_t_vorlage_erste:0:0')?.ownerPersonId).toBe(world.philipp.personId);
    // Der wiederverwendete Entdeckungs-Bauplan gehört der Insel schon seit Gebiet 1; abzuholen gibt es nichts.
    expect(first.event).toMatchObject({
      type: 'entdeckung',
      status: 'abgeschlossen',
      reward: { areaKey: 'endlos_1_t_vorlage_erste', blueprints: ['t_ent_bauen_1a', 't_ent_natur_1a'], deko: [] },
    });
    expect(first.states).toHaveLength(2);
    // Drei Gebiete in einem Befehl, aber nur ein Push je Empfänger: der des neuesten.
    const intents = await areaIntents(world);
    expect(intents).toHaveLength(2);
    for (const intent of intents) expect(intent).toMatchObject({ sourceEventId: first.eventId, payload: { gebietKey: 'endlos_1_t_vorlage_erste' } });

    await reach(world, 55, 2);

    const second = await areaOf(world, 'endlos_2_t_vorlage_zweite');
    expect(second.unlock).toMatchObject({ level: 55 });
    expect(second.fields).toHaveLength(80);
    expect(second.event).toMatchObject({ reward: { blueprints: ['t_ent_bauen_2a', 't_ent_natur_2a'], deko: [] } });
    expect((await areaIntents(world)).filter((intent) => intent.sourceEventId === second.eventId)).toHaveLength(2);
    // Kein Bauplan doppelt: Die wiederverwendeten Entdeckungs-Baupläne stehen je einmal.
    const keys = (await unlocksOf(world)).map((unlock) => unlock.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
