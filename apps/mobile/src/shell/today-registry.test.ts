import { contractFixtures } from '@abnehm/contracts/fixtures';
import type { TodayState } from './today-registry';

import { createTodayRegistry, MissingTodayContributionError, todaySlots } from './today-registry';

const ready = (data: unknown) => ({ type: 'ready', data });

test('feste Reihenfolge und Eigentümer erlauben nur den eigenen Beitrag', () => {
  expect(todaySlots.map(({ key, owner }) => [key, owner])).toEqual([
    ['header', 'fundament'], ['top_notice', 'partner'], ['momo.character', 'momo'],
    ['momo.daily_goals', 'ziele'], ['nutrition.budget', 'ziele'], ['nutrition.log', 'ernaehrung'],
    ['trackers.water', 'tracker'], ['trackers.sport', 'tracker'], ['trackers.weight', 'tracker'], ['partner', 'partner'],
  ]);
  const registry = createTodayRegistry();
  expect(() => registry.register('tracker', 'nutrition.log', { subscribe() { return () => {}; } })).toThrow();
  expect(() => registry.read('nutrition.log')).toThrow(MissingTodayContributionError);
});

test('Quelle meldet Zustandswechsel und prüft Ready-Daten am Steckplatz', () => {
  const registry = createTodayRegistry();
  const received: string[] = [];
  let publish: ((value: TodayState<'nutrition.log'>) => void) | undefined;
  registry.register('ernaehrung', 'nutrition.log', {
    subscribe(listener) {
      publish = listener;
      listener({ type: 'loading' });
      return () => { publish = undefined; };
    },
  });
  const stop = registry.subscribe('nutrition.log', (state) => received.push(state.type));
  publish!(ready(contractFixtures.today!.NutritionLogReady!.valid['ohne Aufnahme']) as TodayState<'nutrition.log'>);
  publish!({ type: 'empty', reasonKey: 'noch_keine_eintraege' });
  publish!({ type: 'error', code: 'invalid_payload' });
  expect(received).toEqual(['loading', 'ready', 'empty', 'error']);
  expect(() => publish!(ready({ intakeKcal: -5 }) as TodayState<'nutrition.log'>)).toThrow();
  stop();
  expect(publish).toBeUndefined();
});

test('derselbe Slot lässt keine zweite Quelle zu', () => {
  const registry = createTodayRegistry();
  const source = { subscribe: () => () => {} };
  registry.register('partner', 'partner', source);
  expect(() => registry.register('partner', 'partner', source)).toThrow();
});
