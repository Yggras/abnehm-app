/** @jest-environment node */

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';

import { fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import type { SportInput } from './sport';
import type { SportWeek, SportWeekState } from './sport-week';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #174: das beobachtbare Lesemodell des Sport-Detailbildschirms (Spezifikation 3, Abschnitte 3
// und 5) über einer echten SQLite-Datei: Wochenminuten nach der Zählregel über Wochengrenzen und den
// Sommerzeitwechsel, lokale Tage nach einer Reise, Einträge nach Tag und das Sportwochenziel aus dem
// `PlanReader`-Fake aus #104. Heute ist Mittwoch, der 14.10.2026; die Woche läuft vom 12. bis 18.10.

const goal: FakeGoalVersion = {
  id: EntityId.parse('3a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c21'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-09-01'),
  calorieBudgetMilliKcal: 1_800_000,
  lowerBoundMilliKcal: 1_500_000,
  maintenanceReason: null,
  pace: 'entspannt',
  goalWeightG: 75_000,
  waterTargetMl: 1500,
  weeklySportTargetMinutes: 150,
};
/** Ab Montag dieser Woche 180 Minuten. */
const raised: FakeGoalVersion = { ...goal, id: EntityId.parse('3a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c22'), validFrom: LocalDate.parse('2026-10-12'), weeklySportTargetMinutes: 180 };

const weekdays: Weekday[] = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const weeklyPlan: FakeWeeklyPlanVersion = {
  id: EntityId.parse('3a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c23'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-09-01'),
  days: Object.fromEntries(weekdays.map((weekday) => [weekday, ['wasserziel', 'sporteinheit'] as BausteinKey[]])) as FakeWeeklyPlanVersion['days'],
};

const worlds: TrackerWorld[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const world of worlds.splice(0)) world.close();
});

const settled = () => new Promise((resolve) => setImmediate(resolve));

type Setup = Readonly<{ at?: Instant; planReader?: PlanReader }>;

async function setup({ at = noon, planReader = fakePlanReader({ goals: [goal, raised], weeklyPlans: [weeklyPlan] }) }: Setup = {}) {
  const clock: TestClock = createTestClock({ instant: at, timeZone: berlin });
  const world = await createTrackerWorld(clock);
  worlds.push(world);
  const refreshes = new Set<() => void>();
  const refresh = (update: () => void) => {
    refreshes.add(update);
    return () => refreshes.delete(update);
  };
  /** Beobachtet die Woche eines Tags (`null`: die laufende) und liefert ihren jüngsten Stand. */
  const watch = async (week: LocalDate | null = null) => {
    const states: SportWeekState[] = [];
    stops.push(world.trackers.sportWeek(planReader, refresh, week).subscribe((state) => states.push(state)));
    await settled();
    return (): SportWeek => {
      const state = states.at(-1);
      if (state?.type !== 'ready') throw new Error(`keine Woche: ${state?.type}`);
      return state.week;
    };
  };
  const record = async (input: Partial<SportInput> & Pick<SportInput, 'startedAt'>) => {
    world.trackers.expire(world.trackers.recordSport({ activityType: 'laufen', durationMinutes: 30, activeMilliKcal: null, ...input }).undoToken);
    await settled();
    return EntityId.parse(world.sports().find((row) => row.startedAt === input.startedAt)!.id);
  };
  const tick = async () => {
    for (const update of refreshes) update();
    await settled();
  };
  return { ...world, clock, watch, record, tick };
}

const at = (instant: string) => Instant.parse(instant);
const day = (localDate: string) => LocalDate.parse(localDate);

it('zeigt eine leere laufende Woche mit dem Sportwochenziel von heute', async () => {
  const { watch } = await setup();
  const week = await watch();

  expect(week()).toEqual({
    monday: '2026-10-12', sunday: '2026-10-18', today: '2026-10-14', isCurrent: true, weekMinutes: 0, weeklyTargetMinutes: 180, days: [],
  });
});

it('gruppiert die Einträge nach Tag, neuester Tag und neueste Einheit zuerst, und folgt jeder Änderung', async () => {
  const { watch, record, trackers } = await setup();
  const week = await watch();

  const montag = await record({ activityType: 'gehen', durationMinutes: 40, startedAt: at('2026-10-12T16:00:00.000Z') });
  const frueh = await record({ activityType: 'krafttraining', durationMinutes: 30, startedAt: at('2026-10-14T05:00:00.000Z') });
  const mittag = await record({ activityType: 'radfahren', durationMinutes: 45, startedAt: at('2026-10-14T09:00:00.000Z'), activeMilliKcal: 210_000 });

  expect(week().weekMinutes).toBe(115);
  expect(week().days).toEqual([
    {
      localDate: '2026-10-14',
      entries: [
        {
          id: mittag, activityType: 'radfahren', recognizedActivityType: null, durationMinutes: 45, startedAt: '2026-10-14T09:00:00.000Z', localDate: '2026-10-14',
          timeZone: 'Europe/Berlin', origin: 'manuell', sourceAppId: null, sourceAppName: null, activeMilliKcal: 210_000,
        },
        expect.objectContaining({ id: frueh, activityType: 'krafttraining' }),
      ],
    },
    { localDate: '2026-10-12', entries: [expect.objectContaining({ id: montag, activityType: 'gehen', durationMinutes: 40 })] },
  ]);

  trackers.expire(trackers.deleteSport(frueh).undoToken);
  await settled();

  expect(week().weekMinutes).toBe(85);
  expect(week().days[0]!.entries.map((entry) => entry.id)).toEqual([mittag]);
});

it('zeigt die überschriebene Art vor der Plattformart und keine ausgeblendeten Importe', async () => {
  const { watch, trackers, sports } = await setup();
  const week = await watch();
  const workout = (externalKey: string, startedAt: string) => ({
    type: 'workout' as const,
    externalKey,
    sourceApp: { id: 'com.fitbit.FitbitMobile', name: 'Fitbit' },
    utcOffsetMinutes: 120,
    startedAt: at(startedAt),
    endedAt: at(new Date(Date.parse(startedAt) + 2_700_000).toISOString()),
    durationSeconds: 2_700,
    platformActivityType: null,
    activeMilliKcal: 180_000,
  });
  trackers.importHealth(
    {
      origin: 'apple_health',
      type: 'workout',
      upserts: [workout('umbenannt', '2026-10-13T05:00:00.000Z'), workout('ausgeblendet', '2026-10-13T16:00:00.000Z')],
      deletedKeys: [],
      reconcileSince: null,
      notBefore: at('2026-10-01T00:00:00.000Z'),
    },
    () => {},
  );
  const idOf = (startedAt: string) => EntityId.parse(sports().find((row) => row.startedAt === startedAt)!.id);
  const [renamed, hidden] = [idOf('2026-10-13T05:00:00.000Z'), idOf('2026-10-13T16:00:00.000Z')];
  trackers.expire(trackers.overrideActivityType(renamed, 'yoga_dehnen').undoToken);
  trackers.expire(trackers.hideImported(hidden).undoToken);
  await settled();

  expect(week().weekMinutes).toBe(45);
  expect(week().days).toEqual([
    {
      localDate: '2026-10-13',
      entries: [
        expect.objectContaining({
          activityType: 'yoga_dehnen', recognizedActivityType: 'sonstiges', durationMinutes: 45, origin: 'apple_health',
          sourceAppId: 'com.fitbit.FitbitMobile', sourceAppName: 'Fitbit', activeMilliKcal: 180_000,
        }),
      ],
    },
  ]);
});

it('zählt an der Wochengrenze nach dem gespeicherten lokalen Tag', async () => {
  const { watch, record } = await setup();
  // Sonntag 23:30 und Montag 00:15 in Berlin, eine Dreiviertelstunde auseinander.
  await record({ durationMinutes: 20, startedAt: at('2026-10-11T21:30:00.000Z') });
  await record({ durationMinutes: 25, startedAt: at('2026-10-11T22:15:00.000Z') });

  const current = await watch();
  const previous = await watch(day('2026-10-11'));

  expect(current()).toMatchObject({ monday: '2026-10-12', weekMinutes: 25, days: [expect.objectContaining({ localDate: '2026-10-12' })] });
  expect(previous()).toMatchObject({
    monday: '2026-10-05', sunday: '2026-10-11', isCurrent: false, weekMinutes: 20, days: [expect.objectContaining({ localDate: '2026-10-11' })],
  });
});

it('zählt die Woche des Sommerzeitwechsels von Montag bis Sonntag, unabhängig von ihren 169 Stunden', async () => {
  // Dienstag, 27.10.2026, 12:00 in Berlin (Winterzeit, UTC+1); die Uhr wurde am Sonntag, 25.10., zurückgestellt.
  const { watch, record, sports } = await setup({ at: at('2026-10-27T11:00:00.000Z') });
  await record({ durationMinutes: 30, startedAt: at('2026-10-19T04:00:00.000Z') }); // Montag 06:00 (UTC+2)
  await record({ durationMinutes: 40, startedAt: at('2026-10-25T00:30:00.000Z') }); // Sonntag 02:30 (UTC+2, vor der Umstellung)
  await record({ durationMinutes: 50, startedAt: at('2026-10-25T22:30:00.000Z') }); // Sonntag 23:30 (UTC+1)
  await record({ durationMinutes: 60, startedAt: at('2026-10-25T23:30:00.000Z') }); // Montag 00:30 (UTC+1)

  const changeover = await watch(day('2026-10-22'));
  const current = await watch();

  expect(changeover()).toMatchObject({ monday: '2026-10-19', sunday: '2026-10-25', weekMinutes: 120 });
  expect(current()).toMatchObject({ monday: '2026-10-26', weekMinutes: 60 });
  expect(sports().map(({ localDate, utcOffsetMinutes }) => [localDate, utcOffsetMinutes])).toEqual([
    ['2026-10-19', 120],
    ['2026-10-25', 120],
    ['2026-10-25', 60],
    ['2026-10-26', 60],
  ]);
});

it('behält nach einer Reise den gespeicherten Tag und die Zone der Anlage', async () => {
  const { watch, record, clock } = await setup();
  // Montag 00:30 in Berlin; in New York wäre es noch Sonntag.
  await record({ startedAt: at('2026-10-11T22:30:00.000Z') });
  clock.setTimeZone(TimeZone.parse('America/New_York'));

  const week = await watch();

  expect(week()).toMatchObject({ monday: '2026-10-12', weekMinutes: 30 });
  expect(week().days).toEqual([{ localDate: '2026-10-12', entries: [expect.objectContaining({ timeZone: 'Europe/Berlin' })] }]);
});

it('nimmt für eine vergangene Woche das Sportwochenziel ihres Sonntags', async () => {
  const { watch } = await setup();

  const previous = await watch(day('2026-10-07'));

  expect(previous()).toMatchObject({ monday: '2026-10-05', isCurrent: false, weeklyTargetMinutes: 150 });
});

it('zeigt für einen Tag nach heute die laufende Woche', async () => {
  const { watch } = await setup();

  const future = await watch(day('2026-10-21'));

  expect(future()).toMatchObject({ monday: '2026-10-12', isCurrent: true });
});

it('zeigt ohne gültige Zielversion die Minuten ohne Wochenziel', async () => {
  const { watch, record } = await setup({ planReader: fakePlanReader({ goals: [], weeklyPlans: [] }) });
  await record({ startedAt: at('2026-10-13T16:00:00.000Z') });

  const week = await watch();

  expect(week()).toMatchObject({ weekMinutes: 30, weeklyTargetMinutes: null });
});

it('wechselt die laufende Woche auf Anstoß, sobald die Uhr in der nächsten steht', async () => {
  const { watch, clock, tick } = await setup();
  const week = await watch();

  clock.advanceBy(Date.parse('2026-10-19T08:00:00.000Z') - Date.parse(noon));
  await tick();

  expect(week()).toMatchObject({ monday: '2026-10-19', today: '2026-10-19', isCurrent: true });
});

it('meldet einen gescheiterten PlanReader als Fehler', async () => {
  const failing: PlanReader = { ...fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }), effectivePlan: () => Promise.reject(new Error('kaputt')) };
  const { trackers } = await setup({ planReader: failing });
  const states: SportWeekState[] = [];
  stops.push(trackers.sportWeek(failing, () => () => {}, null).subscribe((state) => states.push(state)));
  await settled();

  expect(states.at(-1)).toEqual({ type: 'error' });
});
