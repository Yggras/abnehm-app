/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';

import { fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';
import type { WeightDetail, WeightDetailState } from './weight-detail';

// Nachweis für #176: das beobachtbare Lesemodell des Gewicht-Detailbildschirms (Spezifikation 3,
// Abschnitte 3 und 5) über einer echten SQLite-Datei. Zielgewicht, Tempo und Haltemodus kommen aus dem
// `PlanReader`-Fake aus #104. Heute ist Mittwoch, der 14.10.2026.

const goal: FakeGoalVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c11'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-10-01'),
  calorieBudgetMilliKcal: 1_800_000,
  lowerBoundMilliKcal: 1_500_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 75_000,
  waterTargetMl: 1500,
  weeklySportTargetMinutes: 150,
};
const holding: FakeGoalVersion = { ...goal, maintenanceReason: 'gewaehlt', pace: null };

const weekdays: Weekday[] = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const weeklyPlan: FakeWeeklyPlanVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c12'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-10-01'),
  days: Object.fromEntries(weekdays.map((weekday) => [weekday, ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] as BausteinKey[]])) as FakeWeeklyPlanVersion['days'],
};

const worlds: TrackerWorld[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const world of worlds.splice(0)) world.close();
});

const settled = () => new Promise((resolve) => setImmediate(resolve));

async function setup(planReader: PlanReader = fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] })) {
  const world = await createTrackerWorld(createTestClock({ instant: noon, timeZone: berlin }));
  worlds.push(world);
  const states: WeightDetailState[] = [];
  stops.push(world.trackers.weightDetail(planReader, () => () => {}).subscribe((state) => states.push(state)));
  await settled();
  const weigh = async (weightG: number, measuredAt: string) => {
    world.trackers.expire(world.trackers.recordWeight({ weightG, measuredAt: Instant.parse(measuredAt) }).undoToken);
    await settled();
  };
  const detail = (): WeightDetail => {
    const state = states.at(-1);
    if (state?.type !== 'ready') throw new Error(`kein Lesemodell: ${state?.type}`);
    return state.detail;
  };
  return { ...world, states, weigh, detail };
}

it('ist ohne Messung leer, ohne Trend und ohne Prognose', async () => {
  const { detail } = await setup();

  expect(detail()).toEqual({ today: '2026-10-14', lastDayWeight: null, trend: null, forecast: null, entries: [] });
});

it('zeigt unter drei Tagesgewichten nur das Tagesgewicht und die Messungen', async () => {
  const { weigh, detail } = await setup();
  await weigh(80_000, '2026-10-13T05:30:00.000Z');
  await weigh(79_800, '2026-10-14T05:30:00.000Z');

  expect(detail()).toMatchObject({ lastDayWeight: { localDate: '2026-10-14', weightG: 79_800 }, trend: null, forecast: null });
});

it('zeigt ab drei Tagesgewichten Trend, „seit Start“, Veränderung in 2 Wochen und Prognose', async () => {
  const { weigh, detail } = await setup();
  await weigh(80_000, '2026-10-10T05:30:00.000Z');
  await weigh(80_000, '2026-10-12T05:30:00.000Z');
  await weigh(76_000, '2026-10-14T05:30:00.000Z');

  // Trend 79 240; Prognose: 4,24 kg ÷ 0,5 kg × 7 = 59,36 → 60 Tage nach dem 14.10.
  expect(detail()).toMatchObject({
    lastDayWeight: { localDate: '2026-10-14', weightG: 76_000 },
    trend: { trendG: 79_240, sinceStartG: -760, change: { changeKg: -0.8, direction: 'sinkend' } },
    forecast: { localDate: '2026-12-13', goalWeightG: 75_000 },
  });
});

it('formuliert einen steigenden Trend als Zahl, ohne Wertung', async () => {
  const { weigh, detail } = await setup();
  await weigh(80_000, '2026-10-12T05:30:00.000Z');
  await weigh(80_000, '2026-10-13T05:30:00.000Z');
  await weigh(83_000, '2026-10-14T05:30:00.000Z');

  expect(detail().trend?.change).toEqual({ changeKg: 0.3, direction: 'steigend' });
});

it('lässt die Veränderung ohne Tagesgewicht in den letzten 14 Tagen entfallen, den Trend aber stehen', async () => {
  const { weigh, detail } = await setup();
  await weigh(80_000, '2026-09-20T05:30:00.000Z');
  await weigh(79_500, '2026-09-25T05:30:00.000Z');
  await weigh(79_000, '2026-09-30T05:30:00.000Z');

  expect(detail().trend).toMatchObject({ change: { changeKg: null, direction: 'noch_nicht_verfuegbar' } });
});

it('lässt die Prognose im Haltemodus entfallen', async () => {
  const { weigh, detail } = await setup(fakePlanReader({ goals: [holding], weeklyPlans: [weeklyPlan] }));
  await weigh(80_000, '2026-10-12T05:30:00.000Z');
  await weigh(80_000, '2026-10-13T05:30:00.000Z');
  await weigh(80_000, '2026-10-14T05:30:00.000Z');

  expect(detail()).toMatchObject({ trend: { trendG: 80_000 }, forecast: null });
});

it('lässt die Prognose ohne gültigen Plan und nach erreichtem Zielgewicht entfallen', async () => {
  const withoutPlan = await setup(fakePlanReader());
  for (const day of [12, 13, 14]) await withoutPlan.weigh(80_000, `2026-10-${day}T05:30:00.000Z`);
  expect(withoutPlan.detail().forecast).toBeNull();

  const atGoal = await setup();
  for (const day of [12, 13, 14]) await atGoal.weigh(75_000, `2026-10-${day}T05:30:00.000Z`);
  expect(atGoal.detail().forecast).toBeNull();
});

it('listet alle zählenden Messungen, neueste zuerst, mit Herkunft und gekennzeichnetem Tagesgewicht', async () => {
  const { trackers, weigh, detail, weights } = await setup();
  await weigh(80_200, '2026-10-13T05:30:00.000Z');
  await weigh(80_900, '2026-10-13T16:00:00.000Z');
  trackers.importHealth(
    {
      origin: 'apple_health',
      type: 'weight',
      upserts: [{ type: 'weight', externalKey: 'waage-1', sourceApp: { id: 'com.withings.wiScaleNG', name: 'Withings' }, utcOffsetMinutes: 120, measuredAt: Instant.parse('2026-10-14T05:00:00.000Z'), weightG: 80_137 }],
      deletedKeys: [],
      reconcileSince: null,
      notBefore: Instant.parse('2026-09-14T00:00:00.000Z'),
    },
    () => {},
  );
  // Eine gelöschte Messung erscheint nicht.
  await weigh(81_000, '2026-10-14T06:00:00.000Z');
  const deleted = weights().find((row) => row.weightG === 81_000)!;
  trackers.expire(trackers.deleteWeight(EntityId.parse(deleted.id)).undoToken);
  await settled();

  expect(detail().entries.map(({ weightG, localDate, origin, sourceAppName, isDayWeight }) => ({ weightG, localDate, origin, sourceAppName, isDayWeight }))).toEqual([
    { weightG: 80_137, localDate: '2026-10-14', origin: 'apple_health', sourceAppName: 'Withings', isDayWeight: true },
    { weightG: 80_900, localDate: '2026-10-13', origin: 'manuell', sourceAppName: null, isDayWeight: false },
    { weightG: 80_200, localDate: '2026-10-13', origin: 'manuell', sourceAppName: null, isDayWeight: true },
  ]);
});

it('meldet einen scheiternden PlanReader als Fehlerzustand', async () => {
  const { states } = await setup({ effectivePlan: () => Promise.reject(new Error('kaputt')) });

  expect(states.at(-1)).toEqual({ type: 'error' });
});
