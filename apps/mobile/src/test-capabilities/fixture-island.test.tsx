/**
 * @jest-environment ./jest/skia-environment.js
 */
import { render, screen } from '@testing-library/react-native';
import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ClockProvider } from '../clock/clock-context';
import { IslandView } from '../island/IslandView';
import type * as mockSkia from '../island/testing/skia-mock';
import { fixtureIsland } from './fixture-island';

// Lastrahmen (Spezifikation 4, Abschnitt 7): Die Produktgrafik bleibt unter dem Lastprofil des Spikes,
// 1.382 gezeichnete Elemente und 157 Animationen (spikes/insel-rendering/RESULTS.md). Gezählt wird die
// Fixture-Insel mit dem echten Skia-Code; die Leistung auf den Geräten misst #221.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('../island/testing/skia-mock').skiaWithCanvasKit());

const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });

test('die Fixture-Insel zeichnet weniger Elemente und Animationen als der Spike', async () => {
  await render(
    <GestureHandlerRootView>
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 375, height: 667 }, insets: { top: 20, left: 0, right: 0, bottom: 0 } }}>
        <ClockProvider clock={clock}>
          <IslandView {...fixtureIsland()} onOpen={jest.fn()} />
        </ClockProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>,
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
