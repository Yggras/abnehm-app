import { act, screen, userEvent, within } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Dimensions, StyleSheet, type TextStyle } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';

import { fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { ClockProvider } from '../clock/clock-context';
import { color, textScale, type as typeTokens } from '../design';
import { hitArea } from '../design/testing/hit-area';
import { routeScreen } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { appTrackers, appWeightDetail } from './app-trackers';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';
import { WeightCaptureScreen } from './WeightCaptureScreen';

// Nachweis für #176 am gerenderten Bildschirm: der Gewicht-Detailbildschirm `capture.weight` ohne
// `newEntry` mit dem echten Tracker-Modul über einer echten SQLite-Datei und dem `PlanReader`-Fake aus
// #104. Heute ist Mittwoch, der 14.10.2026, 12:00 in Berlin.

jest.mock('../design/native/DateTimePicker', () => jest.requireActual('../design/testing/text-date-time-picker'));
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const goal: FakeGoalVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c21'),
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
const weekdays: Weekday[] = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const weeklyPlan: FakeWeeklyPlanVersion = {
  id: EntityId.parse('2a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c22'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-10-01'),
  days: Object.fromEntries(weekdays.map((weekday) => [weekday, ['ernaehrung_erfasst', 'wasserziel', 'gewogen'] as BausteinKey[]])) as FakeWeeklyPlanVersion['days'],
};

const user = userEvent.setup();
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Drei Tagesgewichte mit sinkendem Trend: Trend 79,2 kg, seit Start −0,8 kg, Ziel etwa am 13.12.2026. */
const falling = [
  [80_000, '2026-10-10T05:30:00.000Z'],
  [80_000, '2026-10-12T05:30:00.000Z'],
  [76_000, '2026-10-14T05:30:00.000Z'],
] as const;

async function open({ weighings = [] as readonly (readonly [number, string])[], planReader = fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) as PlanReader } = {}) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world: TrackerWorld = await createTrackerWorld(clock);
  cleanups.push(() => world.close());
  for (const [weightG, at] of weighings) world.trackers.expire(world.trackers.recordWeight({ weightG, measuredAt: Instant.parse(at) }).undoToken);
  cleanups.push(appTrackers.opened(world.trackers));
  cleanups.push(appWeightDetail.opened(world.trackers.weightDetail(planReader, () => () => {})));
  const Layout = () => (
    <ClockProvider clock={clock}>
      {/* Der modale Rahmen zeigt die Meldung an seinem unteren Rand (`ScreenFrame`); ein zweiter Platz fehlt hier bewusst. */}
      <MessageHostProvider>
        <Slot />
      </MessageHostProvider>
    </ClockProvider>
  );
  await renderRouter({ _layout: Layout, index: () => null, 'capture/weight': routeScreen('capture.weight', WeightCaptureScreen) }, { initialUrl: '/' });
  await act(() => router.push('/capture/weight'));
  await act(async () => {});
  return world;
}

/** Alle sichtbaren Texte und ihre Farbe. */
const textColors = () =>
  screen.queryAllByText(/[\s\S]+/).map((text) => (StyleSheet.flatten(text.props.style as TextStyle) ?? {}).color);

test('zeigt oben Trendgewicht groß, Tagesgewicht klein, „seit Start“, Veränderung in 2 Wochen und Prognose als Schätzung', async () => {
  await open({ weighings: falling });

  expect(screen.getByText('Trendgewicht')).toBeOnTheScreen();
  const trend = screen.getByText('79,2 kg');
  expect(StyleSheet.flatten(trend.props.style)).toMatchObject({ fontSize: typeTokens.numberXl.fontSize });
  expect(screen.getByText('Tagesgewicht 76,0 kg · heute')).toBeOnTheScreen();
  expect(screen.getByText('Seit Start −0,8 kg')).toBeOnTheScreen();
  expect(screen.getByText('Trend −0,8 kg in 2 Wochen')).toBeOnTheScreen();
  expect(screen.getByText('Zielgewicht 75,0 kg etwa am 13. Dezember 2026')).toBeOnTheScreen();
  expect(screen.getByText('Schätzung')).toBeOnTheScreen();
  expect(screen.getByLabelText('Seit Start minus 0,8 kg')).toBeOnTheScreen();
  expect(screen.getByLabelText('Trend minus 0,8 kg in 2 Wochen')).toBeOnTheScreen();
});

test('formuliert einen steigenden Trend neutral, ohne problem-Farbe', async () => {
  await open({ weighings: [[80_000, '2026-10-12T05:30:00.000Z'], [80_000, '2026-10-13T05:30:00.000Z'], [83_000, '2026-10-14T05:30:00.000Z']] });

  expect(screen.getByText('Trend +0,3 kg in 2 Wochen')).toBeOnTheScreen();
  expect(screen.getByText('Seit Start +0,3 kg')).toBeOnTheScreen();
  expect(textColors()).not.toContain(color.problem);
});

test('listet alle Messungen mit Herkunft und kennzeichnet das Tagesgewicht', async () => {
  await open({ weighings: [...falling, [76_800, '2026-10-14T09:00:00.000Z']] });

  expect(screen.getByRole('header', { name: 'Messungen' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '76,8 kg, heute · 11:00 · Manuell' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '76,0 kg, heute · 07:30 · Tagesgewicht · Manuell' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: '80,0 kg, Mo, 12.10. · 07:30 · Tagesgewicht · Manuell' })).toBeOnTheScreen();
});

test('zeigt importierte Messungen mit Herkunft und Quell-App, ohne Bearbeiten', async () => {
  const world = await open({ weighings: falling });
  await act(async () => {
    world.trackers.importHealth(
      {
        origin: 'apple_health',
        type: 'weight',
        upserts: [{ type: 'weight', externalKey: 'waage-1', sourceApp: { id: 'com.withings.wiScaleNG', name: 'Withings' }, utcOffsetMinutes: 120, measuredAt: Instant.parse('2026-10-13T05:00:00.000Z'), weightG: 79_437 }],
        deletedKeys: [],
        reconcileSince: null,
        notBefore: Instant.parse('2026-09-14T00:00:00.000Z'),
      },
      () => {},
    );
  });

  expect(screen.getByLabelText('79,4 kg, gestern · 07:00 · Tagesgewicht · Withings, Apple Health')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /^79,4 kg/ })).not.toBeOnTheScreen();
  expect(screen.getByText('Apple Health')).toBeOnTheScreen();
});

test('unter drei Tagesgewichten: Tagesgewicht und der Satz zum Trend, ohne Trendwerte', async () => {
  await open({ weighings: [[80_000, '2026-10-13T05:30:00.000Z'], [79_600, '2026-10-14T05:30:00.000Z']] });

  expect(screen.getByText('Ab drei Tagesgewichten zeigen wir deinen Trend.')).toBeOnTheScreen();
  expect(screen.getByLabelText('Tagesgewicht 79,6 kg, heute')).toBeOnTheScreen();
  expect(screen.queryByText('Trendgewicht')).not.toBeOnTheScreen();
  expect(screen.queryByText(/Seit Start|in 2 Wochen|Zielgewicht/)).not.toBeOnTheScreen();
});

test('ohne Messung: Leerzustand mit genau einer Aktion „Gewicht eintragen“', async () => {
  await open();

  const content = screen.getByTestId('screen-scroll');
  const actions = within(content).getAllByRole('button').filter((button) => button.props.accessibilityLabel !== 'Fertig');
  expect(actions.map((button) => button.props.accessibilityLabel ?? 'Gewicht eintragen')).toEqual(['Gewicht eintragen']);
  await user.press(screen.getByRole('button', { name: 'Gewicht eintragen' }));
  expect(screen).toHavePathname('/capture/weight');
  expect(screen.getByLabelText('Gewicht')).toBeOnTheScreen();
});

test('kein Tagesgewicht in den letzten 14 Tagen: Trend bleibt, die Veränderung entfällt mit Hinweis', async () => {
  await open({ weighings: [[80_000, '2026-09-20T05:30:00.000Z'], [79_500, '2026-09-25T05:30:00.000Z'], [79_000, '2026-09-30T05:30:00.000Z']] });

  expect(screen.getByText('Trendgewicht')).toBeOnTheScreen();
  expect(screen.getByText('Für die Veränderung in 2 Wochen fehlt eine Messung der letzten 14 Tage.')).toBeOnTheScreen();
});

test('im Haltemodus entfällt die Prognose', async () => {
  await open({ weighings: falling, planReader: fakePlanReader({ goals: [{ ...goal, maintenanceReason: 'gewaehlt', pace: null }], weeklyPlans: [weeklyPlan] }) });

  expect(screen.getByText('Trendgewicht')).toBeOnTheScreen();
  expect(screen.queryByText(/Zielgewicht|Schätzung/)).not.toBeOnTheScreen();
});

describe('Bearbeitungs-Sheet', () => {
  const row = () => screen.getByRole('button', { name: '76,0 kg, heute · 07:30 · Tagesgewicht · Manuell' });

  test('öffnet mit Wert und Messzeitpunkt; Speichern ändert die Messung und zeigt „Rückgängig“', async () => {
    const world = await open({ weighings: falling });

    await user.press(row());
    const sheet = screen.getByTestId('sheet');
    expect(within(sheet).getByRole('header', { name: 'Messung bearbeiten' })).toBeOnTheScreen();
    expect(within(sheet).getByLabelText('Gewicht').props.value).toBe('76,0');
    expect(within(sheet).getByLabelText('Gemessen am').props.value).toBe('2026-10-14T05:30:00.000Z');
    await user.clear(within(sheet).getByLabelText('Gewicht'));
    await user.type(within(sheet).getByLabelText('Gewicht'), '76,4');
    await user.press(within(sheet).getByRole('button', { name: 'Speichern' }));
    await act(async () => {});

    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
    expect(world.weights().find((weight) => weight.measuredAt === '2026-10-14T05:30:00.000Z')).toMatchObject({ weightG: 76_400 });
    expect(screen.getByText('76,4 kg gespeichert')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
    await act(async () => {});
    expect(world.weights().find((weight) => weight.measuredAt === '2026-10-14T05:30:00.000Z')).toMatchObject({ weightG: 76_000 });
  });

  test('fragt beim Bearbeiten nicht „Tippfehler?“', async () => {
    const world = await open({ weighings: falling });

    await user.press(row());
    const sheet = screen.getByTestId('sheet');
    await user.clear(within(sheet).getByLabelText('Gewicht'));
    await user.type(within(sheet).getByLabelText('Gewicht'), '86,0');
    await user.press(within(sheet).getByRole('button', { name: 'Speichern' }));

    expect(screen.queryByText(/Tippfehler/)).not.toBeOnTheScreen();
    expect(world.weights().find((weight) => weight.measuredAt === '2026-10-14T05:30:00.000Z')).toMatchObject({ weightG: 86_000 });
  });

  test('„Löschen“ löscht ohne Bestätigungsdialog; „Rückgängig“ legt die Messung neu an', async () => {
    const world = await open({ weighings: falling });

    await user.press(row());
    await user.press(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Löschen' }));
    await act(async () => {});

    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(world.weights().filter((weight) => weight.deletedAt === null)).toHaveLength(2);
    expect(screen.getByText('76,0 kg gelöscht')).toBeOnTheScreen();
    expect(screen.queryByText('Trendgewicht')).not.toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
    await act(async () => {});
    expect(world.weights().filter((weight) => weight.deletedAt === null)).toHaveLength(3);
    expect(screen.getByText('Trendgewicht')).toBeOnTheScreen();
  });
});

test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp, auch im Sheet', async () => {
  await open({ weighings: falling });
  const fits = (name: string | RegExp) => {
    const area = hitArea(screen.getByRole('button', { name }));
    expect({ name: String(name), fits: area.width >= 48 && area.height >= 48 }).toEqual({ name: String(name), fits: true });
  };

  fits('Gewicht eintragen');
  fits('76,0 kg, heute · 07:30 · Tagesgewicht · Manuell');
  await user.press(screen.getByRole('button', { name: '76,0 kg, heute · 07:30 · Tagesgewicht · Manuell' }));
  fits('Speichern');
  fits('Löschen');
});

describe('Schriftfaktor 2,0', () => {
  const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  beforeEach(() => Dimensions.set({ window: { ...initial.window, fontScale: 2 }, screen: { ...initial.screen, fontScale: 2 } }));
  afterEach(() => Dimensions.set(initial));

  test('Texte wachsen mit, die große Zahl bis zur Grenze des Design-Systems, und Bearbeiten bleibt bedienbar', async () => {
    const world = await open({ weighings: falling });

    for (const text of screen.queryAllByText(/[\s\S]+/, { includeHiddenElements: true })) {
      const big = (StyleSheet.flatten(text.props.style as TextStyle) ?? {}).fontSize === typeTokens.numberXl.fontSize;
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(big ? textScale.limit.numberXl : textScale.max);
    }
    await user.press(screen.getByRole('button', { name: '76,0 kg, heute · 07:30 · Tagesgewicht · Manuell' }));
    await user.press(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Löschen' }));
    expect(world.weights().filter((weight) => weight.deletedAt === null)).toHaveLength(2);
  });
});
