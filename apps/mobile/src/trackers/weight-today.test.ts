/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';
import { TrackerWeightReady } from '@abnehm/contracts/today';

import { fakeAreaPorts, fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import type { TodayState } from '../shell/today-registry';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #175: Der Beitrag `trackers.weight` (Spezifikation 3, Abschnitt 7) ist beobachtbar und
// zeigt das letzte Tagesgewicht sowie den Stand des Wiegetags: `wiegetag_offen`, `gewogen` oder
// `kein_wiegetag` mit dem nächsten Wiegetag aus dem `PlanReader` (hier die Fake-Ports aus #104),
// gesucht über die nächsten sieben Tage. Heute ist Mittwoch, der 14.10.2026.

const goal: FakeGoalVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c01'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-10-01'),
  calorieBudgetMilliKcal: 1_800_000,
  lowerBoundMilliKcal: 1_500_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 80_000,
  waterTargetMl: 1500,
  weeklySportTargetMinutes: 150,
};

const weekdays: Weekday[] = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];

/** Wochenplan, in dem genau die genannten Wochentage Wiegetage sind. */
function weeklyPlan(weighDays: readonly Weekday[], validFrom = '2026-10-01', id = '2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02'): FakeWeeklyPlanVersion {
  const day = (weekday: Weekday): [BausteinKey, BausteinKey, BausteinKey] =>
    weighDays.includes(weekday) ? ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] : ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'];
  return {
    id: EntityId.parse(id),
    personId: philipp,
    validFrom: LocalDate.parse(validFrom),
    days: Object.fromEntries(weekdays.map((weekday) => [weekday, day(weekday)])) as FakeWeeklyPlanVersion['days'],
  };
}

const planReaderWith = (...plans: FakeWeeklyPlanVersion[]) => fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal], weeklyPlans: plans }) }).planReader;

const worlds: TrackerWorld[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const world of worlds.splice(0)) world.close();
});

/** Wartet, bis die asynchronen Plan-Abfragen ihren Zustand gemeldet haben. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

async function setup({ planReader = planReaderWith(weeklyPlan(['mittwoch'])), person = true }: { planReader?: PlanReader; person?: boolean } = {}) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world = await createTrackerWorld(clock, { person });
  worlds.push(world);
  let refreshNow = () => {};
  const states: TodayState<'trackers.weight'>[] = [];
  const source = world.trackers.weightToday(planReader, (update) => {
    refreshNow = update;
    return () => {
      refreshNow = () => {};
    };
  });
  stops.push(source.subscribe((state) => states.push(state)));
  await settled();
  const weigh = async (weightG: number, measuredAt: string) => {
    const outcome = world.trackers.recordWeight({ weightG, measuredAt: Instant.parse(measuredAt) });
    await settled();
    return outcome;
  };
  return { ...world, clock, states, weigh, latest: () => states.at(-1), refresh: () => refreshNow() };
}

const actions = {
  detailAction: { actionId: 'tracker.weight.open', target: { type: 'capture.weight' } },
  quickAction: { type: 'navigate', intent: { actionId: 'tracker.weight.add', target: { type: 'capture.weight', newEntry: true } } },
} as const;

/** Erwarteter Zustand; Tage als schlichte Zeichenfolgen, wie sie im Vergleich stehen. */
const ready = (
  value: TrackerWeightReady['value'],
  status: Exclude<TrackerWeightReady['status'], { type: 'kein_wiegetag' }> | { type: 'kein_wiegetag'; nextWeighDay: string | null },
) => ({
  type: 'ready',
  data: { key: 'gewicht', value, status, ...actions },
});

it('zeigt am Wiegetag ohne Messung „wiegetag_offen“; die Fläche öffnet capture.weight, der Knopf das Formular', async () => {
  const { latest } = await setup();

  expect(latest()).toEqual(ready(null, { type: 'wiegetag_offen' }));
  expect(TrackerWeightReady.safeParse((latest() as { data: unknown }).data).success).toBe(true);
});

it('wechselt nach dem Eintragen auf „gewogen“ und zeigt das Tagesgewicht', async () => {
  const { weigh, latest } = await setup();

  await weigh(82_400, '2026-10-14T05:30:00.000Z');

  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_400 }, { type: 'gewogen' }));
});

it('zeigt bei mehreren Messungen eines Tags die früheste als Tagesgewicht', async () => {
  const { weigh, latest } = await setup();

  await weigh(82_900, '2026-10-14T09:00:00.000Z');
  await weigh(82_400, '2026-10-14T05:30:00.000Z');
  await weigh(83_100, '2026-10-14T09:30:00.000Z');

  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_400 }, { type: 'gewogen' }));
});

it('zeigt das letzte Tagesgewicht eines früheren Tags, solange heute am Wiegetag noch keine Messung zählt', async () => {
  const { weigh, latest } = await setup();

  await weigh(82_800, '2026-10-12T05:30:00.000Z');
  await weigh(82_600, '2026-10-13T05:30:00.000Z');

  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_600 }, { type: 'wiegetag_offen' }));
});

it('zählt eine rückgängig gemachte Messung nicht mehr', async () => {
  const { trackers, weigh, latest } = await setup();
  await weigh(82_800, '2026-10-13T05:30:00.000Z');
  const { undoToken } = await weigh(82_400, '2026-10-14T05:30:00.000Z');

  trackers.undo(undoToken);
  await new Promise((resolve) => setImmediate(resolve));

  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_800 }, { type: 'wiegetag_offen' }));
});

it('zeigt an einem anderen Tag den nächsten Wiegetag aus dem Wochenplan', async () => {
  const { weigh, latest } = await setup({ planReader: planReaderWith(weeklyPlan(['montag', 'freitag'])) });
  await weigh(82_400, '2026-10-14T05:30:00.000Z');

  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_400 }, { type: 'kein_wiegetag', nextWeighDay: '2026-10-16' }));
});

it('sucht den nächsten Wiegetag über genau die nächsten sieben Tage, auch über eine neue Wochenplanversion', async () => {
  const withoutWeighDay = weeklyPlan([]);
  // Ab Mittwoch, dem 21.10., gilt ein Plan mit Wiegetag am Mittwoch: genau sieben Tage nach heute.
  const inSevenDays = weeklyPlan(['mittwoch'], '2026-10-21', '2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c03');
  const { latest } = await setup({ planReader: planReaderWith(withoutWeighDay, inSevenDays) });

  expect(latest()).toEqual(ready(null, { type: 'kein_wiegetag', nextWeighDay: '2026-10-21' }));
});

it('findet keinen Wiegetag, der erst nach acht Tagen kommt', async () => {
  const inEightDays = weeklyPlan(['donnerstag'], '2026-10-22', '2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c03');
  const { latest } = await setup({ planReader: planReaderWith(weeklyPlan([]), inEightDays) });

  expect(latest()).toEqual(ready(null, { type: 'kein_wiegetag', nextWeighDay: null }));
});

it('meldet bei einem Wochenplan ganz ohne Wiegetag keinen nächsten Wiegetag', async () => {
  const { weigh, latest } = await setup({ planReader: planReaderWith(weeklyPlan([])) });
  await weigh(82_400, '2026-10-14T05:30:00.000Z');

  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_400 }, { type: 'kein_wiegetag', nextWeighDay: null }));
});

it('bleibt ohne gültige Zielversion bedienbar: kein Wiegetag, aber Gewicht und „Eintragen“', async () => {
  const { weigh, latest } = await setup({ planReader: fakeAreaPorts().planReader });
  await weigh(82_400, '2026-10-14T05:30:00.000Z');

  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_400 }, { type: 'kein_wiegetag', nextWeighDay: null }));
});

it('wechselt am Tageswechsel ohne neue Eingabe auf den neuen Tag', async () => {
  const { clock, weigh, latest, refresh } = await setup({ planReader: planReaderWith(weeklyPlan(['mittwoch', 'donnerstag'])) });
  await weigh(82_400, '2026-10-14T05:30:00.000Z');
  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_400 }, { type: 'gewogen' }));

  clock.set(Instant.parse('2026-10-14T22:30:00.000Z'));
  refresh();
  await settled();

  expect(latest()).toEqual(ready({ type: 'tagesgewicht', weightG: 82_400 }, { type: 'wiegetag_offen' }));
});

it('ist nie im Ton problem: Alle Status sind neutral', async () => {
  const { weigh, states } = await setup();
  await weigh(150_000, '2026-10-14T05:30:00.000Z');

  for (const state of states) expect(JSON.stringify(state)).not.toContain('problem');
});

it('lädt, solange die eigene Person noch nicht synchronisiert ist', async () => {
  const { latest } = await setup({ person: false });

  expect(latest()).toEqual({ type: 'loading' });
});

it('meldet einen Vertragsbruch des PlanReader als Fehlerzustand statt als Ausnahme', async () => {
  const broken = fakeAreaPorts({ planReader: fakePlanReader({ goals: [{ ...goal, waterTargetMl: -1 }], weeklyPlans: [weeklyPlan(['mittwoch'])] }) }).planReader;
  const { latest } = await setup({ planReader: broken });

  expect(latest()).toEqual({ type: 'error', code: 'invalid_payload' });
});

it('beendet Beobachtung und Anstoß beim Abmelden', async () => {
  const { trackers, states, refresh } = await setup();
  const before = states.length;
  for (const stop of stops.splice(0)) stop();

  trackers.recordWeight({ weightG: 82_400, measuredAt: noon });
  refresh();
  await settled();

  expect(states).toHaveLength(before);
});
