/**
 * @jest-environment ./jest/skia-environment.js
 */
import { render, screen } from '@testing-library/react-native';
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { IslandView } from './IslandView';
import { IslandHost } from './testing/island-host';
import { richIsland } from './testing/rich-island';
import type * as mockSkia from './testing/skia-mock';

// Lastrahmen (Spezifikation 4, Abschnitt 7): Die Produktgrafik bleibt unter dem Lastprofil des Spikes,
// 1.382 gezeichnete Elemente und 157 Animationen (spikes/insel-rendering/RESULTS.md). Gezählt wird die
// volle Insel mit dem echten Skia-Code; die Leistung auf den Geräten misst #221.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());

const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });

test('die volle Insel steht nach den Spielregeln auf Level 6 mit 56 und 81 Prozent', () => {
  const { progress } = richIsland();

  expect(progress.level).toBe(6);
  expect(progress.levelNeed).toBe(16);
  expect(progress.members.map(({ halfPercent }) => halfPercent)).toEqual([56, 81]);
});

test('die volle Insel zeichnet weniger Elemente und Animationen als der Spike', async () => {
  await render(
    <IslandHost clock={clock}>
      <IslandView {...richIsland()} onOpen={jest.fn()} />
    </IslandHost>,
  );

  // Gezeichnet ist jedes Skia-Element außer Gruppen; animiert ist, was einen Shared Value als Prop trägt.
  const nodes = screen.container.queryAll((node) => node.type.startsWith('sk'));
  const drawn = nodes.filter((node) => node.type !== 'skGroup');
  const isShared = (value: unknown) => typeof value === 'object' && value !== null && 'value' in value && 'modify' in value;
  const animated = nodes.filter((node) => Object.values(node.props).some(isShared));

  // Gemessen am 29.10.2026: 431 Elemente, 26 animierte Gruppen.
  expect(drawn.length).toBeGreaterThan(300);
  expect(drawn.length).toBeLessThan(1382);
  expect(animated.length).toBeGreaterThan(0);
  expect(animated.length).toBeLessThan(157);
});
