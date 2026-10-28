/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';

import { fakeAreaPorts, fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { insertPersonForTest } from '../daily-goals/testing/persisted';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { nutritionEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createTodayRegistry, type TodayState } from '../shell/today-registry';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { createTrackers, waterEntryEntity, type Trackers } from '.';

// Nachweis für #171: Der Beitrag `trackers.water` (Spezifikation 3, Abschnitt 7) hängt am Slot der
// „Heute“-Registry, ist beobachtbar und zeigt heute gezählte ml und das Wasserziel der gültigen
// Zielversion aus dem `PlanReader` (hier die Fake-Ports aus #104).

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const berlin = TimeZone.parse('Europe/Berlin');
const noon = Instant.parse('2026-10-14T10:00:00.000Z');

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
    ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'].map((day) => [day, ['ernaehrung_erfasst', 'wasserziel', 'gewogen']]),
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
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  if (person) database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock: TestClock = createTestClock({ instant: noon, timeZone: berlin });
  const newId = () => EntityId.parse(randomUUID());
  const trackers: Trackers = createTrackers({
    database,
    clock,
    newId,
    writer: createSyncWriter({ registry: createSyncRegistry([waterEntryEntity]), clock, newId }),
    persistence: { reevaluateDailyGoals() {} },
  });
  let refreshNow = () => {};
  const registry = createTodayRegistry();
  registry.register('tracker', 'trackers.water', trackers.waterToday(planReader, (update) => {
    refreshNow = update;
    return () => {
      refreshNow = () => {};
    };
  }));
  const states: TodayState<'trackers.water'>[] = [];
  const stop = registry.subscribe('trackers.water', (state) => states.push(state));
  cleanups.unshift(stop);
  await settled();
  return { database, clock, trackers, states, latest: () => states.at(-1), refresh: () => refreshNow() };
}

const ready = (countedMl: number, status: string) => ({
  type: 'ready',
  data: {
    key: 'wasser',
    countedMl,
    targetMl: 1500,
    status,
    detailAction: { actionId: 'tracker.water.open', target: { type: 'capture.water' } },
    quickAction: { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } },
  },
});

it('zeigt heute gezählte ml und das Wasserziel; Fläche öffnet capture.water, der Knopf bucht water.quick_add', async () => {
  const { latest } = await setup();

  expect(latest()).toEqual(ready(0, 'leer'));
});

it('folgt jeder Buchung und jedem Rückgängig über alle Status, immer neutral', async () => {
  const { trackers, latest } = await setup();

  trackers.addWater({ ml: 250 });
  await settled();
  expect(latest()).toEqual(ready(250, 'teil'));

  trackers.addWater({ ml: 1250 });
  await settled();
  expect(latest()).toEqual(ready(1500, 'erreicht'));

  const { undoToken } = trackers.addWater({ ml: 250 });
  await settled();
  expect(latest()).toEqual(ready(1750, 'ueber_ziel'));

  trackers.undo(undoToken);
  await settled();
  expect(latest()).toEqual(ready(1500, 'erreicht'));
});

it('wechselt am Tageswechsel ohne neue Eingabe auf den neuen Tag', async () => {
  const { clock, trackers, latest, refresh } = await setup();
  trackers.addWater({ ml: 750 });
  await settled();

  clock.set(Instant.parse('2026-10-14T22:00:00.000Z'));
  refresh();
  await settled();

  expect(latest()).toEqual(ready(0, 'leer'));
});

it('zählt kalorienhaltige Getränke aus der Ernährung nicht', async () => {
  const { database, trackers, latest } = await setup();
  database.transaction((tx) => sqliteOf(tx).insert(nutritionEntry).values({
    id: randomUUID(), personId: philipp, consumedAt: noon, localDate: '2026-10-14', timeZone: berlin, utcOffsetMinutes: 120,
    meal: 'fruehstueck', captureMethod: 'suche', foodRefType: 'eigen', foodRefKey: 'orangensaft', baseAmount: 250,
    displayUnit: 'ml', displayAmountMilli: 250_000, snapshotName: 'Orangensaft', snapshotBaseUnit: 'ml', snapshotReferenceAmount: 100,
    snapshotMilliKcal: 45_000, snapshotProteinMg: 700, snapshotCarbsMg: 10_400, snapshotFatMg: 200, snapshotPortions: [],
    snapshotSource: 'eigen', totalMilliKcal: 112_500, totalProteinMg: 1750, totalCarbsMg: 26_000, totalFatMg: 500,
    createdAt: noon, updatedAt: noon,
  }).run());
  trackers.addWater({ ml: 250 });
  await settled();

  expect(latest()).toEqual(ready(250, 'teil'));
});

it('ohne gültige Zielversion liefert der Beitrag empty mit dem Leer-Grund ohne_zielversion', async () => {
  const { latest } = await setup({ planReader: fakeAreaPorts().planReader });

  expect(latest()).toEqual({ type: 'empty', reasonKey: 'ohne_zielversion' });
});

it('lädt, solange die eigene Person noch nicht synchronisiert ist', async () => {
  const { latest } = await setup({ person: false });

  expect(latest()).toEqual({ type: 'loading' });
});

it('meldet einen Vertragsbruch des PlanReader als Fehlerzustand statt als Ausnahme', async () => {
  const broken = fakeAreaPorts({ planReader: fakePlanReader({ goals: [{ ...goal, waterTargetMl: -1 }], weeklyPlans: [weeklyPlan] }) }).planReader;
  const { latest } = await setup({ planReader: broken });

  expect(latest()).toEqual({ type: 'error', code: 'invalid_payload' });
});

it('beendet Beobachtung und Anstoß beim Abmelden', async () => {
  const { trackers, states, refresh } = await setup();
  const before = states.length;
  for (const cleanup of cleanups.splice(0, 1)) cleanup();

  trackers.addWater({ ml: 250 });
  refresh();
  await settled();

  expect(states).toHaveLength(before);
});
