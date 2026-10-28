import { describe, expect, it } from 'vitest';

import { indexCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';
import { tracer } from '@abnehm/game-rules/fixtures';
import { basePrice } from '@abnehm/game-rules/prices';
import { islandProgress, spentOnIsland } from '@abnehm/game-rules/progress';

// Tracer für #179 im Backend: Aus demselben Katalog und denselben Buchungsfakten wie der App-Test
// (apps/mobile/src/game-rules/tracer.test.ts) entstehen dieselben Werte.

describe('Spielregeln auf dem Server', () => {
  const spent = [spentOnIsland(tracer.bookings.philipp, tracer.island), spentOnIsland(tracer.bookings.anna, tracer.island)] as const;

  it('rechnet Level und beide Hälften', () => {
    expect(spent).toEqual(tracer.expected.spent);
    expect(islandProgress(spent)).toEqual(tracer.expected.progress);
  });

  it('kennt den Preis eines Start-Bauplans', () => {
    const blueprint = indexCatalog(gameCatalog).find('bauplan', tracer.startBlueprint);
    expect(blueprint.type === 'found' ? basePrice(blueprint.entry) : blueprint.error).toBe(tracer.expected.startPrice);
  });
});
