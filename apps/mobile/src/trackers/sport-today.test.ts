/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';
import type { SportEntryRecord } from '@abnehm/contracts/trackers';

import { fakeAreaPorts, fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { createTodayRegistry, type TodayState } from '../shell/today-registry';
import { sportEntryEntity } from '.';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #173: Der Beitrag `trackers.sport` (Spezifikation 3, Abschnitt 7) hängt am Slot der
// „Heute“-Registry, ist beobachtbar und zeigt die Wochenminuten nach der Sport-Zählregel und das
// Sportwochenziel der gültigen Zielversion aus dem `PlanReader` (hier die Fake-Ports aus #104).

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
const weeklyPlan: FakeWeeklyPlanVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-10-01'),
  days: Object.fromEntries(
    ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'].map((day) => [day, ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit']]),
  ) as FakeWeeklyPlanVersion['days'],
};
const withPlan = () => fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) }).planReader;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Wartet, bis die asynchrone Plan-Abfrage ihren Zustand gemeldet hat. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

async function setup({ planReader = withPlan(), person = true }: { planReader?: PlanReader; person?: boolean } = {}) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world: TrackerWorld = await createTrackerWorld(clock, { person });
  cleanups.push(world.close);
  let refreshNow = () => {};
  const registry = createTodayRegistry();
  registry.register('tracker', 'trackers.sport', world.trackers.sportToday(planReader, (update) => {
    refreshNow = update;
    return () => {
      refreshNow = () => {};
    };
  }));
  const states: TodayState<'trackers.sport'>[] = [];
  cleanups.unshift(registry.subscribe('trackers.sport', (state) => states.push(state)));
  await settled();
  return { ...world, clock, states, latest: () => states.at(-1), refresh: () => refreshNow() };
}

const ready = (weekMinutes: number, status: string) => ({
  type: 'ready',
  data: {
    key: 'sport',
    weekMinutes,
    weeklyTargetMinutes: 150,
    status,
    detailAction: { actionId: 'tracker.sport.open', target: { type: 'capture.sport' } },
    quickAction: { type: 'navigate', intent: { actionId: 'tracker.sport.add', target: { type: 'capture.sport', newEntry: true } } },
  },
});

/** Eine Einheit, die um `startedAt` begann. */
const unit = (durationMinutes: number, startedAt: string) => ({ activityType: 'laufen', durationMinutes, startedAt: Instant.parse(startedAt), activeMilliKcal: null }) as const;

/** Ein Sporteintrag, wie ihn ein Pull vom Server übernimmt; ohne Angaben ein Import über Apple Health am Mittwoch. */
function pulled(world: TrackerWorld, data: Partial<SportEntryRecord> & Pick<SportEntryRecord, 'origin'>, id = EntityId.parse(randomUUID())) {
  const base = {
    activityType: 'radfahren', startedAt: Instant.parse('2026-10-14T05:00:00.000Z'), durationMinutes: 45, activeMilliKcal: null,
    localDate: LocalDate.parse('2026-10-14'), timeZone: TimeZone.parse('Europe/Berlin'), utcOffsetMinutes: 120, personId: philipp, createdAt: noon, updatedAt: noon,
  };
  const byOrigin = data.origin === 'manuell'
    ? { replacedByEntryId: null, reactivatedAt: null }
    : { overrideActivityType: null, externalKey: randomUUID(), sourceAppId: 'com.fitbit.FitbitMobile', sourceAppName: null, hiddenAt: null };
  world.database.transaction((tx) =>
    sportEntryEntity.applyCanonical(tx, { entityId: id, serverVersion: ServerVersion.parse('1'), data: { ...base, ...byOrigin, ...data } as SportEntryRecord }));
  return id;
}

it('zeigt Wochenminuten und Sportwochenziel; Fläche öffnet capture.sport, der Knopf das Formular für eine neue Einheit', async () => {
  const { latest } = await setup();

  expect(latest()).toEqual(ready(0, 'leer'));
});

it('folgt jeder Einheit und jedem Rückgängig über alle Status, immer neutral', async () => {
  const { trackers, latest } = await setup();

  trackers.recordSport(unit(40, '2026-10-12T16:00:00.000Z'));
  await settled();
  expect(latest()).toEqual(ready(40, 'teil'));

  trackers.recordSport(unit(110, '2026-10-14T05:00:00.000Z'));
  await settled();
  expect(latest()).toEqual(ready(150, 'erreicht'));

  const { undoToken } = trackers.recordSport(unit(15, '2026-10-14T09:00:00.000Z'));
  await settled();
  expect(latest()).toEqual(ready(165, 'ueber_ziel'));

  trackers.undo(undoToken);
  await settled();
  expect(latest()).toEqual(ready(150, 'erreicht'));
});

it('zählt nur die Woche Montag bis Sonntag: Der Sonntag davor bleibt draußen', async () => {
  const { trackers, latest } = await setup();

  // Sonntag, 11.10., 23:30 Berlin, und Montag, 12.10., 00:30 Berlin.
  trackers.recordSport(unit(30, '2026-10-11T21:30:00.000Z'));
  trackers.recordSport(unit(20, '2026-10-11T22:30:00.000Z'));
  await settled();

  expect(latest()).toEqual(ready(20, 'teil'));
});

it('wechselt am Wochenwechsel ohne neue Eingabe auf die neue Woche', async () => {
  const { clock, trackers, latest, refresh } = await setup();
  trackers.recordSport(unit(45, '2026-10-14T05:00:00.000Z'));
  await settled();

  // Sonntag, 18.10., 23:59 Berlin: noch dieselbe Woche.
  clock.set(Instant.parse('2026-10-18T21:59:00.000Z'));
  refresh();
  await settled();
  expect(latest()).toEqual(ready(45, 'teil'));

  // Montag, 19.10., 00:01 Berlin.
  clock.set(Instant.parse('2026-10-18T22:01:00.000Z'));
  refresh();
  await settled();
  expect(latest()).toEqual(ready(0, 'leer'));
});

it('zählt über den Sommerzeitwechsel nach dem gespeicherten lokalen Tag', async () => {
  // Die Uhr steht am Sonntag, 25.10., 23:45 Berlin (Winterzeit, UTC+1).
  const { clock, trackers, latest, refresh } = await setup();
  clock.set(Instant.parse('2026-10-25T22:45:00.000Z'));
  // Begonnen am Sonntag um 00:30 Sommerzeit (UTC+2) und um 23:00 Winterzeit (UTC+1).
  trackers.recordSport(unit(30, '2026-10-24T22:30:00.000Z'));
  trackers.recordSport(unit(25, '2026-10-25T22:00:00.000Z'));
  refresh();
  await settled();

  expect(latest()).toEqual(ready(55, 'teil'));
});

it('zählt ausgeblendete Importe und ersetzte manuelle Einträge nicht, reaktivierte schon', async () => {
  const world = await setup();
  const importId = pulled(world, { origin: 'apple_health', durationMinutes: 45 });
  pulled(world, { origin: 'manuell', durationMinutes: 40, replacedByEntryId: importId });
  pulled(world, { origin: 'health_connect', durationMinutes: 20, hiddenAt: noon });
  pulled(world, { origin: 'manuell', durationMinutes: 30, replacedByEntryId: importId, reactivatedAt: noon });
  await settled();

  expect(world.latest()).toEqual(ready(75, 'teil'));
});

it('zählt einen ersetzten Eintrag wieder, wenn sein ersetzender Import aus der Vorwoche ausgeblendet ist', async () => {
  const world = await setup();
  // Import am Sonntag der Vorwoche, ersetzter manueller Eintrag am Montag dieser Woche.
  const importId = pulled(world, { origin: 'apple_health', localDate: LocalDate.parse('2026-10-11'), hiddenAt: noon });
  pulled(world, { origin: 'manuell', durationMinutes: 40, localDate: LocalDate.parse('2026-10-12'), replacedByEntryId: importId });
  await settled();

  expect(world.latest()).toEqual(ready(40, 'teil'));
});

it('ohne gültige Zielversion liefert der Beitrag empty mit dem Leer-Grund ohne_zielversion', async () => {
  const { latest } = await setup({ planReader: fakeAreaPorts().planReader });

  expect(latest()).toEqual({ type: 'empty', reasonKey: 'ohne_zielversion' });
});

it('lädt, solange die eigene Person noch nicht synchronisiert ist', async () => {
  const { latest } = await setup({ person: false });

  expect(latest()).toEqual({ type: 'loading' });
});
