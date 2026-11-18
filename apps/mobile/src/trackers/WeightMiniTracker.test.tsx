import { act, render, screen, userEvent } from '@testing-library/react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, type BausteinKey, type Weekday } from '@abnehm/contracts/base';

import { fakeAreaPorts, fakePlanReader, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { ClockProvider } from '../clock/clock-context';
import { hitArea } from '../design/testing/hit-area';
import { openTarget } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { createTodayRegistry } from '../shell/today-registry';
import { TodayContent } from '../shell/TodayScreen';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #175 am gerenderten Bildschirm: Der Gewichts-Mini-Tracker auf „Heute“ mit dem echten
// Tracker-Modul über einer echten SQLite-Datei, in allen Status. Am Wiegetag zeigt er „Eintragen“,
// sonst den nächsten Wiegetag; ohne Wiegetag im Wochenplan nur „Eintragen“. Heute ist Mittwoch, der 14.10.

jest.mock('../navigation', () => ({ ...jest.requireActual('../navigation'), openTarget: jest.fn() }));

const goal = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c01'), personId: philipp, validFrom: LocalDate.parse('2026-10-01'),
  calorieBudgetMilliKcal: 1_800_000, lowerBoundMilliKcal: 1_500_000, maintenanceReason: null, pace: 'entspannt' as const,
  goalWeightG: 80_000, waterTargetMl: 2500, weeklySportTargetMinutes: 150,
};
const weekdays: Weekday[] = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const planWith = (weighDays: readonly Weekday[]) => {
  const weeklyPlan: FakeWeeklyPlanVersion = {
    id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c02'), personId: philipp, validFrom: LocalDate.parse('2026-10-01'),
    days: Object.fromEntries(weekdays.map((day): [Weekday, [BausteinKey, BausteinKey, BausteinKey]] =>
      [day, weighDays.includes(day) ? ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] : ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit']])) as FakeWeeklyPlanVersion['days'],
  };
  return fakeAreaPorts({ planReader: fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) }).planReader;
};

const user = userEvent.setup();
const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
  jest.mocked(openTarget).mockClear();
});

async function renderToday({ weighDays = ['mittwoch'] as readonly Weekday[], weighings = [] as readonly (readonly [number, string])[] } = {}) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world = await createTrackerWorld(clock);
  worlds.push(world);
  for (const [weightG, at] of weighings) world.trackers.recordWeight({ weightG, measuredAt: Instant.parse(at) });
  const registry = createTodayRegistry();
  registry.register('tracker', 'trackers.weight', world.trackers.weightToday(planWith(weighDays), () => () => {}));
  await render(
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <TodayContent registry={registry} />
      </MessageHostProvider>
    </ClockProvider>,
  );
  await act(async () => {});
  return world;
}

const enter = () => screen.getByRole('button', { name: 'Gewicht: Eintragen' });

test('Wiegetag offen: zeigt „Heute ist Wiegetag“ und „Eintragen“ öffnet das Formular für einen neuen Eintrag', async () => {
  await renderToday({ weighings: [[91_800, '2026-10-13T05:45:00.000Z']] });

  expect(screen.getByRole('button', { name: 'Gewicht: 91,8 kg, Heute ist Wiegetag. Details öffnen' })).toBeOnTheScreen();
  await user.press(enter());

  expect(openTarget).toHaveBeenCalledWith({ type: 'capture.weight', newEntry: true });
});

test('gewogen: zeigt das Tagesgewicht von heute und „Heute gewogen“', async () => {
  await renderToday({ weighings: [[91_800, '2026-10-13T05:45:00.000Z'], [91_500, '2026-10-14T05:30:00.000Z']] });

  expect(screen.getByText('91,5 kg')).toBeOnTheScreen();
  expect(screen.getByText('Heute gewogen')).toBeOnTheScreen();
  expect(enter()).toBeOnTheScreen();
});

test('kein Wiegetag: nennt den nächsten Wiegetag, morgen als „morgen“', async () => {
  await renderToday({ weighDays: ['donnerstag'] });

  expect(screen.getByText('Nächster Wiegetag: morgen')).toBeOnTheScreen();
});

test('kein Wiegetag: nennt einen späteren Wiegetag mit Wochentag', async () => {
  await renderToday({ weighDays: ['montag'], weighings: [[91_800, '2026-10-13T05:45:00.000Z']] });

  expect(screen.getByRole('button', { name: 'Gewicht: 91,8 kg, Nächster Wiegetag: Montag. Details öffnen' })).toBeOnTheScreen();
});

test('Wochenplan ohne Wiegetag: nur Gewicht und „Eintragen“, kein Wiegetag-Satz', async () => {
  await renderToday({ weighDays: [], weighings: [[91_800, '2026-10-13T05:45:00.000Z']] });

  expect(screen.getByRole('button', { name: 'Gewicht: 91,8 kg. Details öffnen' })).toBeOnTheScreen();
  expect(screen.queryByText(/Wiegetag|gewogen/)).not.toBeOnTheScreen();
  expect(enter()).toBeOnTheScreen();
});

test('ab drei Tagesgewichten: Trendwert mit der Unterzeile „Trend“ (#176)', async () => {
  await renderToday({ weighings: [[80_000, '2026-10-11T05:30:00.000Z'], [81_000, '2026-10-12T05:30:00.000Z'], [79_000, '2026-10-13T05:30:00.000Z']] });

  // 80 000 → 80 100 → 80 100 + 0,1 × (79 000 − 80 100) = 79 990
  expect(screen.getByText('Trend')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Gewicht: 80,0 kg Trend, Heute ist Wiegetag. Details öffnen' })).toBeOnTheScreen();
});

test('unter drei Tagesgewichten ohne „Trend“', async () => {
  await renderToday({ weighings: [[91_800, '2026-10-13T05:45:00.000Z']] });

  expect(screen.queryByText('Trend')).not.toBeOnTheScreen();
});

test('ohne Messung: „Noch kein Gewicht“', async () => {
  await renderToday();

  expect(screen.getByText('Noch kein Gewicht')).toBeOnTheScreen();
});

test('die Fläche öffnet den Detailbildschirm capture.weight', async () => {
  await renderToday();

  await user.press(screen.getByRole('button', { name: /^Gewicht: .*Details öffnen$/ }));

  expect(openTarget).toHaveBeenCalledWith({ type: 'capture.weight' });
});

test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp', async () => {
  await renderToday({ weighings: [[91_800, '2026-10-13T05:45:00.000Z']] });

  for (const name of ['Gewicht: Eintragen', 'Gewicht: 91,8 kg, Heute ist Wiegetag. Details öffnen']) {
    const area = hitArea(screen.getByRole('button', { name }));
    expect(area.height).toBeGreaterThanOrEqual(48);
    expect(area.width).toBeGreaterThanOrEqual(48);
  }
});
