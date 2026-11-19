import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { eventRewardId, islandEventId, islandEventStateId } from '@abnehm/contracts/island-records';
import { notificationTexts } from '@abnehm/contracts/notification-texts';
import { areaOccasionKey } from '@abnehm/game-rules/areas';
import { withCatalogNames } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import { levelThreshold } from '@abnehm/game-rules/progress';

import { islandField, islandObject, notificationIntent } from '../src/db/schema/index.ts';
import { energize, fieldOn, hatchedPhones, islandOf, type GamePhone } from './support/game-phones.ts';
import { spendWithoutProjection } from './support/level-up.ts';

// Nachweis für #204 auf echten Geräten: Philipps Bau hebt die Insel auf Level 4. Im selben Befehl schaltet der Server
// die Schilfwiese des ausgelieferten Katalogs frei, mit Feldern für beide, Entdeckung und je einem Push. Beide Geräte
// (Spieldienst der App auf echtem SQLite) bekommen das Gebiet per Sync; jede Person holt den Steinfrosch einmal ab,
// Philipp offline und vorläufig. Gegen die echte Hono-App mit Postgres (Spezifikation 4, Testnähte 2 und 3).

type World = Awaited<ReturnType<typeof hatchedPhones>>;

/** Die Insel auf dem Server so, wie `spendWithoutProjection` sie braucht. */
async function serverIsland(world: World) {
  const { islandId } = islandOf(world.philippsPhone);
  const fields = await world.backend.database.db.select().from(islandField).where(eq(islandField.islandId, islandId));
  const fieldId = (key: string) => EntityId.parse(fields.find((field) => field.fieldKey === key)!.id);
  return { backend: world.backend, clock: world.clock, islandId: EntityId.parse(islandId), couplingId: EntityId.parse(fields[0]!.couplingId), fieldId };
}

/** Anna hat ihre Hälfte bis Level 4 gefüllt, Philipp fehlt ein Holzweg; er hat dafür Energie. */
async function oneStepBeforeLevel4() {
  const world = await hatchedPhones();
  const island = await serverIsland(world);
  await spendWithoutProjection(island, world.anna, { fieldKey: 'grundinsel:12:1', amount: levelThreshold(4) });
  await spendWithoutProjection(island, world.philipp, { fieldKey: 'grundinsel:0:1', amount: levelThreshold(4) - 1 });
  // 10 Tage mit allen Tageszielen: 40 Energie, nach 35 verbauten bleiben 5.
  await energize(world, Array.from({ length: 10 }, (_, index) => `2026-10-${String(5 + index).padStart(2, '0')}`));
  await world.annasPhone.sync();
  return { world, island };
}

const discoveryOf = (phone: GamePhone) => {
  const found = islandOf(phone).events.open.find((event) => event.kind === 'entdeckung');
  if (found === undefined) throw new Error(`Keine Entdeckung: ${JSON.stringify(islandOf(phone).events.open)}`);
  return found;
};

describe('Gebiet und Entdeckung App ↔ Backend', { timeout: 120_000 }, () => {
  it('Tracer Bullet: Philipps Bau hebt die Insel auf Level 4; beide sehen die Schilfwiese und holen den Steinfrosch einzeln ab', async () => {
    const { world, island } = await oneStepBeforeLevel4();
    const { philippsPhone, annasPhone } = world;

    expect(philippsPhone.game.build({ fieldId: fieldOn(philippsPhone, 'grundinsel:0:0'), blueprintKey: 'holzweg' })).toMatchObject({ type: 'gebaut' });
    await philippsPhone.sync();
    await annasPhone.sync();

    // Beide Geräte: Level 4, das Gebiet ohne Nebel, je 40 eigene Felder dort, die Entdeckung neu.
    for (const phone of [philippsPhone, annasPhone]) {
      const hatched = islandOf(phone);
      expect(hatched.progress.level).toBe(4);
      expect(hatched.appearance.formKey).toBe('huepfer');
      expect(hatched.unlockedAreas).toEqual(['schilfwiese']);
      const areaFields = hatched.fields.filter((field) => field.key.startsWith('schilfwiese:'));
      expect(areaFields).toHaveLength(80);
      expect(areaFields.filter((field) => field.ownerPersonId === hatched.viewerPersonId)).toHaveLength(40);
      expect(hatched.unlockedBlueprints).toEqual(expect.arrayContaining(['steinmauer', 'briefkasten', 'seerosenteich', 'schilfgras']));
      expect(discoveryOf(phone)).toMatchObject({ area: { key: 'schilfwiese', name: 'Schilfwiese' }, seen: false, claimable: true });
    }
    // „Neu bei euch“ auf „Wir“.
    const wir = annasPhone.wir();
    const eventId = islandEventId(island.islandId, areaOccasionKey(island.islandId, 'schilfwiese'));
    expect(wir.type === 'ready' && wir.data.filter((item) => item.type === 'shared_event' && item.eventType === 'gebiet')).toEqual([
      expect.objectContaining({ eventId }),
    ]);

    // Ein Push „gebiet“ an beide, mit dem Text aus Abschnitt 12.
    const intents = await world.backend.database.db.select().from(notificationIntent).where(eq(notificationIntent.type, 'gebiet'));
    expect(intents.map((intent) => intent.recipientPersonId).sort()).toEqual([world.anna.personId, world.philipp.personId].sort());
    for (const intent of intents) {
      expect(intent).toMatchObject({ sourceEventId: eventId, payload: { gebietKey: 'schilfwiese' } });
      expect(notificationTexts.renderStored(intent.messageKey, withCatalogNames(gameCatalog, intent.payload))).toEqual({
        type: 'rendered',
        text: { title: 'Neues Gebiet auf eurer Insel 🏝️', body: 'Der Nebel zieht ab – es gibt etwas zu entdecken.' },
      });
    }

    // Philipp holt offline ab: vorläufig im Lager; der Server bestätigt mit derselben ID.
    philippsPhone.offline();
    const philippsState = discoveryOf(philippsPhone).stateId;
    expect(philippsPhone.game.claimEventReward(philippsState)).toMatchObject({ type: 'abgeholt', rewards: [{ key: 'steinfrosch' }] });
    expect(islandOf(philippsPhone).storage.map((item) => [item.id, item.catalogKey])).toEqual([[eventRewardId(philippsState, 0), 'steinfrosch']]);
    philippsPhone.online();
    await philippsPhone.sync();
    expect(philippsPhone.outbox()).toEqual([]);

    // Anna holt ihren eigenen ab; eindeutig je Ereignis und Person.
    const annasState = discoveryOf(annasPhone).stateId;
    expect(annasState).toBe(islandEventStateId(eventId, EntityId.parse(world.anna.personId)));
    expect(annasPhone.game.claimEventReward(annasState)).toMatchObject({ type: 'abgeholt' });
    await annasPhone.sync();
    await philippsPhone.sync();

    const rewards = await world.backend.database.db
      .select({ id: islandObject.id, owner: islandObject.ownerPersonId, origin: islandObject.origin, fieldId: islandObject.fieldId })
      .from(islandObject)
      .where(and(eq(islandObject.islandId, island.islandId), eq(islandObject.catalogKey, 'steinfrosch')));
    expect(rewards.sort((a, b) => a.owner.localeCompare(b.owner))).toEqual(
      [
        { id: eventRewardId(philippsState, 0), owner: world.philipp.personId, origin: 'entdeckung', fieldId: null },
        { id: eventRewardId(annasState, 0), owner: world.anna.personId, origin: 'entdeckung', fieldId: null },
      ].sort((a, b) => a.owner.localeCompare(b.owner)),
    );
    // Abgeholt ist abgeholt: Die Entdeckung ist auf beiden Geräten erledigt, ein zweites Abholen geht nicht.
    for (const phone of [philippsPhone, annasPhone]) expect(islandOf(phone).events.open.filter((event) => event.kind === 'entdeckung')).toEqual([]);
    expect(philippsPhone.game.claimEventReward(philippsState)).toEqual({ type: 'verboten', reason: 'schon_abgeholt' });
  });
});
