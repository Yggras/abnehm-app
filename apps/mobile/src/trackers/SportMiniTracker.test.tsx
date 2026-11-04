import { act, render, screen, userEvent } from '@testing-library/react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';

import { fakeAreaPorts, fakePlanReader } from '../area-ports/testing/fakes';
import { ClockProvider } from '../clock/clock-context';
import { hitArea } from '../design/testing/hit-area';
import { openTarget } from '../navigation';
import { MessageHostProvider, MessageSlot } from '../shell/MessageHost';
import { createTodayRegistry } from '../shell/today-registry';
import { TodayContent } from '../shell/TodayScreen';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #173 am gerenderten Bildschirm: Der Sport-Mini-Tracker auf „Heute“ mit dem echten
// Tracker-Modul über einer echten SQLite-Datei zeigt die Wochenminuten im Verhältnis zum Sportwochenziel
// aus dem `PlanReader`-Fake (#104). „+ Einheit“ öffnet das Formular, die Fläche die Wochenübersicht.

jest.mock('../navigation', () => ({ ...jest.requireActual('../navigation'), openTarget: jest.fn() }));

const goal = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c01'), personId: philipp, validFrom: LocalDate.parse('2026-10-01'),
  calorieBudgetMilliKcal: 1_800_000, lowerBoundMilliKcal: 1_500_000, maintenanceReason: null, pace: 'entspannt' as const,
  goalWeightG: 80_000, waterTargetMl: 2500, weeklySportTargetMinutes: 150,
};
const weeklyPlan = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02'), personId: philipp, validFrom: LocalDate.parse('2026-10-01'),
  days: Object.fromEntries(['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag']
    .map((day) => [day, ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit']])) as never,
};
const withPlan = () => fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) }).planReader;

const user = userEvent.setup();
const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
  jest.mocked(openTarget).mockClear();
});

async function renderToday(planReader: PlanReader = withPlan()) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world = await createTrackerWorld(clock);
  worlds.push(world);
  const registry = createTodayRegistry();
  registry.register('tracker', 'trackers.sport', world.trackers.sportToday(planReader, () => () => {}));
  await render(
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <TodayContent registry={registry} />
        <MessageSlot />
      </MessageHostProvider>
    </ClockProvider>,
  );
  await act(async () => {});
  return world;
}

const progress = () => screen.getByRole('progressbar', { name: 'Sport diese Woche' });
const unit = (durationMinutes: number, startedAt: string) => ({ activityType: 'radfahren', durationMinutes, startedAt: Instant.parse(startedAt), activeMilliKcal: null }) as const;

test('zeigt Wochenminuten von Sportwochenziel als Text und Wochenbalken und folgt jeder Einheit', async () => {
  const { trackers } = await renderToday();
  expect(screen.getByText('0 min')).toBeOnTheScreen();
  expect(screen.getByText('von 150 min diese Woche')).toBeOnTheScreen();
  expect(progress()).toHaveAccessibilityValue({ min: 0, max: 150, now: 0, text: '0 min von 150 min diese Woche' });
  expect(screen.getByText('Noch offen')).toBeOnTheScreen();

  await act(async () => {
    trackers.recordSport(unit(40, '2026-10-12T16:00:00.000Z'));
    trackers.recordSport(unit(35, '2026-10-13T16:00:00.000Z'));
  });

  expect(progress()).toHaveAccessibilityValue({ min: 0, max: 150, now: 75, text: '75 min von 150 min diese Woche' });
  expect(screen.getByText('Unterwegs')).toBeOnTheScreen();

  await act(async () => {
    trackers.recordSport(unit(90, '2026-10-14T05:00:00.000Z'));
  });

  expect(progress()).toHaveAccessibilityValue({ min: 0, max: 150, now: 150, text: '165 min von 150 min diese Woche, erreicht' });
  expect(screen.getByText('Über dem Ziel')).toBeOnTheScreen();
});

test('„+ Einheit“ öffnet das Formular für eine neue Einheit, die Fläche die Wochenübersicht', async () => {
  await renderToday();

  await user.press(screen.getByRole('button', { name: 'Sport: + Einheit' }));
  expect(openTarget).toHaveBeenLastCalledWith({ type: 'capture.sport', newEntry: true });

  await user.press(screen.getByRole('button', { name: 'Sport: 0 min von 150 min diese Woche, Noch offen. Details öffnen' }));
  expect(openTarget).toHaveBeenLastCalledWith({ type: 'capture.sport' });
});

test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp', async () => {
  await renderToday();

  for (const name of ['Sport: + Einheit', 'Sport: 0 min von 150 min diese Woche, Noch offen. Details öffnen']) {
    const area = hitArea(screen.getByRole('button', { name }));
    expect(area.height).toBeGreaterThanOrEqual(48);
    expect(area.width).toBeGreaterThanOrEqual(48);
  }
});

test('ohne gültige Zielversion zeigt der Mini-Tracker einen Hinweis statt Wert und Knopf', async () => {
  await renderToday(fakeAreaPorts().planReader);

  expect(screen.getByText('Noch kein Ziel festgelegt.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Sport: + Einheit' })).not.toBeOnTheScreen();
});
