/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { createLaichkugelWorld } from './testing/laichkugel-world';

// Nachweis für #204 in der App: die Verwandlungsszene je Installation (Spezifikation 4, Abschnitt 6 „Levelaufstieg
// erleben“) am lokalen Spieldienst gegen eine echte SQLite-Datei. Den Aufstieg auf Level 4 und die Schilfwiese bringt
// ein Pull, etwa nachdem Anna die letzte Lücke gefüllt hat.

const clock = createTestClock({ instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function hatchedWorld() {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  world.couple();
  world.hatch();
  return world;
}

describe('Verwandlungsszene', () => {
  it('Tracer: Nach dem Pull auf Level 4 verwandelt sich Momo beim nächsten Öffnen von der Kaulquappe in den Hüpfer, danach zieht der Nebel von der Schilfwiese ab', async () => {
    const world = await hatchedWorld();
    // Beim ersten Öffnen nach dem Schlüpfen merkt sich die Installation Level 1 still.
    expect(world.game.takeTransformation()).toBeNull();

    world.pullProgress(4, [2, 3, 4]);
    world.areaOnServer(4);

    expect(world.game.takeTransformation()).toEqual({ from: 'kaulquappe', areas: ['schilfwiese'] });
    // Einmal je Installation, auch nach einem Neustart.
    expect(world.game.takeTransformation()).toBeNull();
    await world.restart();
    expect(world.game.takeTransformation()).toBeNull();
  });

  it('ein Levelaufstieg ohne neue Form zeigt keine Verwandlung', async () => {
    const world = await hatchedWorld();
    world.game.takeTransformation();

    world.pullProgress(3, [2, 3]);

    expect(world.game.takeTransformation()).toBeNull();
    // Das gezeigte Level steht jetzt auf 3; von dort ist Level 4 die nächste Form.
    world.pullProgress(4, [4]);
    world.areaOnServer(4);
    expect(world.game.takeTransformation()).toEqual({ from: 'kaulquappe', areas: ['schilfwiese'] });
  });

  it('ohne gemerktes Level übernimmt die Installation das aktuelle still, etwa nach einer Neuanmeldung', async () => {
    const world = await hatchedWorld();
    world.pullProgress(4, [2, 3, 4]);
    world.areaOnServer(4);

    expect(world.game.takeTransformation()).toBeNull();
    expect(world.game.takeTransformation()).toBeNull();
  });

  it('sinkt das Level nach einer Gegenbuchung, verwandelt sich Momo beim erneuten Erreichen nicht noch einmal', async () => {
    const world = await hatchedWorld();
    world.game.takeTransformation();
    world.pullProgress(4, [2, 3, 4]);
    world.areaOnServer(4);
    world.game.takeTransformation();

    world.pullProgress(3);
    expect(world.game.takeTransformation()).toBeNull();
    world.pullProgress(4);
    expect(world.game.takeTransformation()).toBeNull();
  });
});
