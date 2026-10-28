import { followTodayContribution } from './app-today';
import { createTodayRegistry, type TodaySource, type TodayState } from './today-registry';

// Bereichsbeiträge auf „Heute“ sind ab dem Start registriert und folgen der jeweils geöffneten
// Kontodatenbank (#171), wie der Kopf (#110).

type Water = TodayState<'trackers.water'>;

const water = (countedMl: number): Water => ({
  type: 'ready',
  data: {
    key: 'wasser', countedMl, targetMl: 1500, status: countedMl === 0 ? 'leer' : 'teil',
    detailAction: { actionId: 'tracker.water.open', target: { type: 'capture.water' } },
    quickAction: { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } },
  },
});

/** Quelle eines Kontos, die ihre Abonnenten zählt und auf Zuruf meldet. */
function accountSource(initial: Water) {
  const listeners = new Set<(state: Water) => void>();
  const source: TodaySource<'trackers.water'> = {
    subscribe(listener) {
      listeners.add(listener);
      listener(initial);
      return () => listeners.delete(listener);
    },
  };
  return { source, listeners, publish: (state: Water) => listeners.forEach((listener) => listener(state)) };
}

it('lädt ohne geöffnetes Konto und folgt dann der Quelle des jeweils geöffneten Kontos', () => {
  const registry = createTodayRegistry();
  const opened = followTodayContribution(registry, 'tracker', 'trackers.water');
  const received: Water[] = [];
  const stop = registry.subscribe('trackers.water', (state) => received.push(state));
  expect(received).toEqual([{ type: 'loading' }]);

  const a = accountSource(water(250));
  const closeA = opened(a.source);
  a.publish(water(500));
  expect(received.slice(1)).toEqual([water(250), water(500)]);

  const b = accountSource(water(0));
  opened(b.source);
  expect(a.listeners.size).toBe(0);
  closeA();
  expect(received.at(-1)).toEqual(water(0));

  stop();
  expect(b.listeners.size).toBe(0);
});

it('lädt wieder, sobald die Sitzung das Konto löst', () => {
  const registry = createTodayRegistry();
  const opened = followTodayContribution(registry, 'tracker', 'trackers.water');
  const received: Water[] = [];
  registry.subscribe('trackers.water', (state) => received.push(state));
  const a = accountSource(water(250));

  opened(a.source)();

  expect(received).toEqual([{ type: 'loading' }, water(250), { type: 'loading' }]);
  expect(a.listeners.size).toBe(0);
});
