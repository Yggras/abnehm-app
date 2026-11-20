/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import { eventRewardId, islandEventId } from '@abnehm/contracts/island-records';
import type { WirContribution } from '@abnehm/contracts/wir';
import { areaOccasionKey } from '@abnehm/game-rules/areas';

import { createLaichkugelWorld, islandId } from './testing/laichkugel-world';

// Nachweis für #204 am lokalen Spieldienst: Entdeckung auf „Wir“ als „neues Gebiet“ und das Abholen der
// Entdeckungs-Deko je Person, gegen eine echte SQLite-Datei. Gebiet und Entdeckung legt der Test ab, wie der Pull
// sie nach der Freischaltung bringt.

const clock = createTestClock({ instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function discoveredWorld() {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  world.couple();
  world.hatch();
  world.pullProgress(4, [2, 3, 4]);
  const stateId = world.areaOnServer(4);
  return { world, stateId };
}

function wirOf(world: Awaited<ReturnType<typeof discoveredWorld>>['world']): WirContribution[] {
  let state: ContributionState<WirContribution[]> | null = null;
  world.game.wirContributions.subscribe((next) => void (state = next))();
  const current = state as ContributionState<WirContribution[]> | null;
  return current?.type === 'ready' ? current.data : [];
}

describe('Entdeckung in der App', () => {
  it('erscheint auf „Wir“ als gemeinsames Ereignis „neues Gebiet“', async () => {
    const { world } = await discoveredWorld();
    const eventId = islandEventId(islandId, areaOccasionKey(islandId, 'schilfwiese'));

    expect(wirOf(world).filter((contribution) => contribution.type === 'shared_event' && contribution.eventType === 'gebiet')).toEqual([
      expect.objectContaining({ eventId, messageKey: 'neu_bei_euch.gebiet', action: expect.objectContaining({ target: { type: 'momo' } }) }),
    ]);
  });

  it('die Deko holt jede Person einmal ab: vorläufig ins eigene Lager, mit der ID aus Ereignisstand und Index wie auf dem Server', async () => {
    const { world, stateId } = await discoveredWorld();

    const outcome = world.game.claimEventReward(stateId);

    expect(outcome).toMatchObject({ type: 'abgeholt', rewards: [{ type: 'deko', key: 'steinfrosch', name: 'Steinfrosch' }] });
    let storage: readonly { id: string; catalogKey: string; origin: string }[] = [];
    world.game.observeStage((next) => void (storage = next.type === 'geschluepft' && next.island !== null ? next.island.storage : []))();
    expect(storage).toEqual([expect.objectContaining({ id: eventRewardId(stateId, 0), catalogKey: 'steinfrosch', origin: 'entdeckung' })]);
    expect(world.operations().map((operation) => operation.type)).toEqual(['claimEventReward']);

    expect(world.game.claimEventReward(stateId)).toEqual({ type: 'verboten', reason: 'schon_abgeholt' });
  });
});
