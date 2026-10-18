import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { createTodayPreview } from './today-preview';
import { todaySlots } from './today-registry';

test('synthetische Heute-Beiträge bestehen alle Vertragsschemas und füllen jeden Pflichtslot', () => {
  const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
  const registry = createTodayPreview(clock);
  const states: string[] = [];
  for (const { key } of todaySlots) registry.subscribe(key, (state) => states.push(state.type));
  expect(states).toEqual(Array(10).fill('ready'));
});
