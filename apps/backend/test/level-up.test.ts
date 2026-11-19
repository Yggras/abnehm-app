import { describe, expect, it } from 'vitest';

import { islandEventId } from '@abnehm/contracts/island-records';
import { testCatalog } from '@abnehm/game-rules/fixtures';
import { levelOccasionKey } from '@abnehm/game-rules/unlocks';

import { progressChanges } from '../src/island/progress-change.ts';
import { builtWorld, type BuildWorld } from './support/building.ts';
import { levelEventsOf, levelIntents, spendWithoutProjection, unlocksOf } from './support/level-up.ts';

// Nachweis für #200 am Server: Freischaltungen je Rolle und mehrere Level in einem Befehl, mit dem
// Test-Katalog der Spielregeln (Level-Freischaltungen bei 2 und 4, Gebiet bei 4). Der ausgelieferte Katalog
// hat noch keine Level-Freischaltungen. Verbaute Energie entsteht hier direkt in der Datenbank; den
// Inselfortschritt berechnet danach `progressChanges` wie jeder Spielbefehl in seiner Transaktion.

/** Beide verbauen `amount` auf einem Feld der Reihe `row` ihrer Ecke, dann wird die Insel in einer Transaktion neu berechnet. */
async function spendBoth(world: BuildWorld, amount: number, row = 1) {
  await spendWithoutProjection(world, world.anna, { fieldKey: `grundinsel:12:${row}`, amount });
  await spendWithoutProjection(world, world.philipp, { fieldKey: `grundinsel:0:${row}`, amount });
  const at = new Date(world.clock.read().instant);
  return world.backend.database.db.transaction((tx) => progressChanges(tx, world.islandId, at, testCatalog()));
}

const startKeys = ['holzweg', 'sitzbank', 'laterne', 'blumenwiese', 'beerenstrauch', 'apfelbaum'];

describe('Levelaufstieg mit Test-Katalog', { timeout: 60_000 }, () => {
  it('schaltet für jedes neu erreichte Level den Bauplan je Rolle frei, mit je einem Ereignis und einem Intent je Empfänger', async () => {
    const world = await builtWorld();

    // Schwelle(4) = 36: von Level 1 direkt auf Level 4.
    const changes = await spendBoth(world, 36);

    expect(changes[0]).toMatchObject({ entityType: 'island_progress', data: { level: 4 } });
    // Level-Freischaltungen von 2 und 4; Gebiet und Entdeckung von Level 4 schaltet #204 frei.
    const unlocks = await unlocksOf(world);
    expect(unlocks.filter((unlock) => !startKeys.includes(unlock.key))).toEqual([
      { key: 't_bauen_2', reason: 'level' },
      { key: 't_bauen_4', reason: 'level' },
      { key: 't_natur_2', reason: 'level' },
      { key: 't_natur_4', reason: 'level' },
    ]);
    expect(changes.filter((change) => change.entityType === 'blueprint_unlock')).toHaveLength(4);

    const events = await levelEventsOf(world);
    expect(events.map((event) => [event.type, event.occasionKey])).toEqual([2, 3, 4].map((level) => ['levelaufstieg', levelOccasionKey(world.islandId, level)]));
    expect(changes.filter((change) => change.entityType === 'island_event').map((change) => change.entityId)).toEqual(events.map((event) => event.id));

    // Nur einmal je Empfänger, mit dem höchsten Level.
    const intents = await levelIntents(world);
    expect(intents).toHaveLength(2);
    for (const intent of intents) {
      expect(intent).toMatchObject({ sourceEventId: islandEventId(world.islandId, levelOccasionKey(world.islandId, 4)), payload: { level: 4 } });
    }
  });

  it('ein Level ohne Katalogeintrag zählt trotzdem: Ereignis ja, Freischaltung nein', async () => {
    const world = await builtWorld();
    await spendBoth(world, 11);

    // Schwelle(3) = 23; für Level 3 hat der Test-Katalog keinen Bauplan.
    const changes = await spendBoth(world, 12, 2);

    expect(changes.map((change) => change.entityType)).toEqual(['island_progress', 'island_event']);
    expect((await levelEventsOf(world)).map((event) => event.occasionKey)).toEqual([2, 3].map((level) => levelOccasionKey(world.islandId, level)));
    const intents = await levelIntents(world);
    expect(intents.map((intent) => (intent.payload as { level: number }).level).sort()).toEqual([2, 2, 3, 3]);
  });

  it('eine erneute Berechnung ohne neues Level schreibt nichts weiter', async () => {
    const world = await builtWorld();
    await spendBoth(world, 36);
    const before = { unlocks: await unlocksOf(world), events: await levelEventsOf(world), intents: await levelIntents(world) };

    const at = new Date(world.clock.read().instant);
    const changes = await world.backend.database.db.transaction((tx) => progressChanges(tx, world.islandId, at, testCatalog()));

    expect(changes.map((change) => change.entityType)).toEqual(['island_progress']);
    expect({ unlocks: await unlocksOf(world), events: await levelEventsOf(world), intents: await levelIntents(world) }).toEqual(before);
  });
});
