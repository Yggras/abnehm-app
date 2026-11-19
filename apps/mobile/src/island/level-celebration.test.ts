/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import type { MomoMood } from '@abnehm/contracts/island';
import type { ContributionState } from '@abnehm/contracts/contribution';
import type { WirContribution } from '@abnehm/contracts/wir';

import type { HapticKind } from '../haptics/haptics';
import type { TodayState } from '../shell/today-registry';
import { messageOfReaction, type MomoReaction } from './momo-reactions';
import { createLaichkugelWorld, islandId } from './testing/laichkugel-world';

// Nachweis für #200 in der App: die Levelfeier je Installation (Spezifikation 4, Abschnitt 6 „Levelaufstieg
// erleben“) am lokalen Spieldienst gegen eine echte SQLite-Datei. Den Aufstieg bringt ein Pull über die
// Sync-Adapter, etwa nachdem Anna die letzte Lücke gefüllt hat. Geprüft wird an der Schnittstelle des
// Spieldienstes: Reaktionen, Haptik, Stimmung und die Beiträge an „Wir“.

const berlin = TimeZone.parse('Europe/Berlin');
const noon = Instant.parse('2026-10-14T10:00:00.000Z');
const levelUp = (level: number): MomoReaction => ({ yesterday: null, today: null, level });

const cleanups: (() => void)[] = [];
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  jest.useRealTimers();
});

async function setup() {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const haptics: HapticKind[] = [];
  const world = await createLaichkugelWorld(clock, { haptics: { feedback: (kind) => void haptics.push(kind) } });
  cleanups.push(() => world.close());
  world.couple();
  world.hatch();
  const reactions: MomoReaction[] = [];
  return {
    world,
    haptics,
    reactions,
    listen: () => world.game.observeReactions((next) => void reactions.push(next)),
    todayMood(): MomoMood | null {
      let state: TodayState<'momo.character'> | null = null;
      world.game.momoCharacter.subscribe((next) => void (state = next))();
      const current = state as TodayState<'momo.character'> | null;
      return current?.type === 'ready' ? current.data.appearance.moodKey : null;
    },
    wir(): WirContribution[] {
      let state: ContributionState<WirContribution[]> | null = null;
      world.game.wirContributions.subscribe((next) => void (state = next))();
      const current = state as ContributionState<WirContribution[]> | null;
      return current?.type === 'ready' ? current.data : [];
    },
  };
}

describe('Levelfeier', () => {
  it('Tracer: Nach dem Pull von Annas Aufstieg feiert Momo „begeistert“ mit „Momo ist jetzt auf Level 2“, die Haptik kommt einmal', async () => {
    const app = await setup();
    app.listen();

    app.world.pullProgress(2, [2]);

    expect(app.reactions).toEqual([levelUp(2)]);
    expect(messageOfReaction(levelUp(2))).toEqual({
      messageKey: 'momo.levelaufstieg',
      values: { level: 2, bonus: false, energie: 0, gesternBonus: false, gesternEnergie: 0 },
    });
    expect(app.haptics).toEqual(['levelaufstieg']);
    // „begeistert“ ist die Pose mit den drei Energie-Funken (Momo-Rig, #187). Beim Levelaufstieg hält sie so lange,
    // wie die Meldung steht (5 s), nicht nur `duration-celebrate` (Nutzerentscheidung in #200).
    expect(app.todayMood()).toBe('begeistert');
    jest.advanceTimersByTime(4_999);
    expect(app.todayMood()).toBe('begeistert');
    jest.advanceTimersByTime(1);
    expect(app.todayMood()).not.toBe('begeistert');
  });

  it('merkt sich das gefeierte Level je Installation: kein zweites Mal nach Re-Render, weiterem Pull und Neustart', async () => {
    const app = await setup();
    const stop = app.listen();
    app.world.pullProgress(2, [2]);

    stop();
    const stopAgain = app.listen();
    // Ein weiterer Pull derselben Projektion, etwa nach Annas nächstem Bau ohne neues Level.
    app.world.pullProgress(2);
    stopAgain();
    await app.world.restart();
    app.listen();

    expect(app.reactions).toEqual([levelUp(2)]);
    expect(app.haptics).toEqual(['levelaufstieg']);
  });

  it('fasst mehrere übersprungene Level zu einer Feier mit dem neuesten zusammen', async () => {
    const app = await setup();
    app.listen();

    app.world.pullProgress(4, [2, 3, 4]);

    expect(app.reactions).toEqual([levelUp(4)]);
    expect(app.haptics).toEqual(['levelaufstieg']);
  });

  it('wartet auf den nächsten sichtbaren Moment: Ein Aufstieg ohne angemeldete Oberfläche erscheint beim Anmelden', async () => {
    const app = await setup();
    app.listen()();
    app.world.pullProgress(3, [2, 3]);
    expect(app.reactions).toEqual([]);

    app.listen();

    expect(app.reactions).toEqual([levelUp(3)]);
    expect(app.haptics).toEqual(['levelaufstieg']);
  });

  it('übernimmt ohne gemerktes Level das aktuelle still, etwa nach einer Neuanmeldung, und feiert erst den nächsten Aufstieg', async () => {
    const app = await setup();
    // Die Installation hat die Insel noch nie beobachtet: Die Projektion steht schon auf Level 5.
    app.world.pullProgress(5, [2, 3, 4, 5]);
    app.listen();
    expect(app.reactions).toEqual([]);
    expect(app.haptics).toEqual([]);

    app.world.pullProgress(6, [6]);

    expect(app.reactions).toEqual([levelUp(6)]);
  });

  it('feiert ein Level nach einer Gegenbuchung nicht noch einmal, wenn die Insel es erneut erreicht', async () => {
    const app = await setup();
    app.listen();
    app.world.pullProgress(3, [2, 3]);

    app.world.pullProgress(2);
    app.world.pullProgress(3);

    expect(app.reactions).toEqual([levelUp(3)]);
    expect(app.haptics).toEqual(['levelaufstieg']);
  });

  it('meldet „Levelaufstieg“ als gemeinsames Ereignis an „Wir“, je Level eines', async () => {
    const app = await setup();

    app.world.pullProgress(3, [2, 3]);

    const shared = app.wir().filter((contribution) => contribution.type === 'shared_event');
    expect(shared.map((event) => (event.type === 'shared_event' ? [event.eventType, event.messageKey, event.objectId] : null))).toEqual([
      ['momo_geschluepft', 'neu_bei_euch.momo_geschluepft', islandId],
      ['levelaufstieg', 'neu_bei_euch.levelaufstieg', islandId],
      ['levelaufstieg', 'neu_bei_euch.levelaufstieg', islandId],
    ]);
  });
});
