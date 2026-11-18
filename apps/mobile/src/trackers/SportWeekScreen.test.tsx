import { act, screen, userEvent, within } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Dimensions, StyleSheet, type TextStyle } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import type { PlanReader } from '@abnehm/contracts/ports';

import { fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { ClockProvider } from '../clock/clock-context';
import { textScale, type as typeTokens } from '../design';
import { hitArea } from '../design/testing/hit-area';
import { routeScreen } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { appSportWeeks, appTrackers } from './app-trackers';
import type { SportInput } from './sport';
import { SportCaptureScreen } from './SportCaptureScreen';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #174 am gerenderten Bildschirm: der Sport-Detailbildschirm `capture.sport` ohne `newEntry`
// mit dem echten Tracker-Modul über einer echten SQLite-Datei und dem `PlanReader`-Fake aus #104.
// Heute ist Mittwoch, der 14.10.2026, 12:00 in Berlin; die Woche läuft vom 12. bis 18.10.

jest.mock('../design/native/DateTimePicker', () => jest.requireActual('../design/testing/text-date-time-picker'));
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const goal: FakeGoalVersion = {
  id: EntityId.parse('4a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c31'),
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
const weekdays: Weekday[] = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const weeklyPlan: FakeWeeklyPlanVersion = {
  id: EntityId.parse('4a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c32'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-09-01'),
  days: Object.fromEntries(weekdays.map((weekday) => [weekday, ['wasserziel', 'sporteinheit'] as BausteinKey[]])) as FakeWeeklyPlanVersion['days'],
};

const user = userEvent.setup();
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const unit = (input: Partial<SportInput> & Pick<SportInput, 'startedAt'>): SportInput => ({ activityType: 'laufen', durationMinutes: 30, activeMilliKcal: null, ...input });

/** Die Woche wie in `solo`: Montag Gehen, heute zwei Einheiten; dazu eine Einheit in der Vorwoche. */
const week: readonly SportInput[] = [
  unit({ activityType: 'gehen', durationMinutes: 40, startedAt: Instant.parse('2026-10-12T16:00:00.000Z') }),
  unit({ activityType: 'krafttraining', durationMinutes: 20, startedAt: Instant.parse('2026-10-14T05:00:00.000Z') }),
  unit({ activityType: 'laufen', durationMinutes: 30, startedAt: Instant.parse('2026-10-14T09:00:00.000Z'), activeMilliKcal: 210_000 }),
  unit({ activityType: 'schwimmen', durationMinutes: 50, startedAt: Instant.parse('2026-10-08T16:00:00.000Z') }),
];

async function open({ units = week, planReader = fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] }) as PlanReader } = {}) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world: TrackerWorld = await createTrackerWorld(clock);
  cleanups.push(() => world.close());
  for (const input of units) world.trackers.expire(world.trackers.recordSport(input).undoToken);
  cleanups.push(appTrackers.opened(world.trackers));
  cleanups.push(appSportWeeks.opened((day) => world.trackers.sportWeek(planReader, () => () => {}, day)));
  const Layout = () => (
    <ClockProvider clock={clock}>
      {/* Der modale Rahmen zeigt die Meldung an seinem unteren Rand (`ScreenFrame`). */}
      <MessageHostProvider>
        <Slot />
      </MessageHostProvider>
    </ClockProvider>
  );
  await renderRouter({ _layout: Layout, index: () => null, 'capture/sport': routeScreen('capture.sport', SportCaptureScreen) }, { initialUrl: '/' });
  await act(() => router.push('/capture/sport'));
  await act(async () => {});
  return world;
}

const settle = () => act(async () => {});
const runRow = () => screen.getByRole('button', { name: 'Laufen, 30 min, 11:00 · Manuell · etwa 210 kcal' });

test('zeigt den Wochenbalken „X von Wochenziel min“ als Fortschrittsanzeige und die Einträge nach Tag', async () => {
  await open();

  expect(screen.getByRole('header', { name: 'Diese Woche, Woche vom 12.10. bis 18.10.' })).toBeOnTheScreen();
  const bar = screen.getByRole('progressbar', { name: 'Sport in dieser Woche' });
  expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 150, now: 90, text: '90 von 150 min' });
  // Die Wochensumme steht groß wie auf dem Mini-Tracker (Impeccable-Kritik).
  expect(StyleSheet.flatten(screen.getByText('90 min').props.style as TextStyle)).toMatchObject({ fontSize: typeTokens.numberXl.fontSize });
  expect(screen.getByText('von 150 min')).toBeOnTheScreen();
  expect(screen.queryByText('erreicht')).not.toBeOnTheScreen();

  const headers = screen.getAllByRole('header').map((header) => header.props.children);
  expect(headers).toEqual(expect.arrayContaining(['Heute', 'Mo, 12.10.']));
  expect(headers.indexOf('Heute')).toBeLessThan(headers.indexOf('Mo, 12.10.'));
  // Heute zwei Einheiten, die neueste zuerst; Symbol der Art, Dauer, Uhrzeit, Herkunft und „≈ kcal“.
  const rows = screen.getAllByRole('button').map((row) => row.props.accessibilityLabel).filter((name) => /, \d+ min, /.test(name ?? ''));
  expect(rows).toEqual([
    'Laufen, 30 min, 11:00 · Manuell · etwa 210 kcal',
    'Krafttraining, 20 min, 07:00 · Manuell',
    'Gehen, 40 min, 18:00 · Manuell',
  ]);
  expect(screen.getByText('11:00 · Manuell · ≈ 210 kcal')).toBeOnTheScreen();
  expect(screen.queryByText('Schwimmen')).not.toBeOnTheScreen();
});

test('zeigt importierte Einträge mit Herkunftsabzeichen; sie öffnen das schreibgeschützte Sheet statt des Formulars (#186)', async () => {
  const world = await open({ units: [] });
  await act(async () => {
    world.trackers.importHealth(
      {
        origin: 'health_connect',
        type: 'workout',
        upserts: [
          {
            type: 'workout',
            externalKey: 'rad-1',
            sourceApp: { id: 'com.fitbit.FitbitMobile', name: 'Fitbit' },
            utcOffsetMinutes: 120,
            startedAt: Instant.parse('2026-10-13T15:00:00.000Z'),
            endedAt: Instant.parse('2026-10-13T15:45:00.000Z'),
            durationSeconds: 2_700,
            platformActivityType: null,
            activeMilliKcal: null,
          },
        ],
        deletedKeys: [],
        reconcileSince: null,
        notBefore: Instant.parse('2026-10-01T00:00:00.000Z'),
      },
      () => {},
    );
  });

  expect(screen.getByText('Health Connect')).toBeOnTheScreen();
  // Die bekannte Kennung von Google Health hat Vorrang vor dem gelieferten Namen (Spezifikation 3, Abschnitt 6).
  expect(screen.getByText('17:00 · Google Health (Fitbit)')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Sonstiges, 45 min, 17:00 · Google Health (Fitbit), Health Connect' }));
  const sheet = within(screen.getByTestId('sheet'));
  expect(sheet.getByRole('header', { name: 'Training aus Health Connect' })).toBeOnTheScreen();
  expect(sheet.queryByLabelText('Dauer')).not.toBeOnTheScreen();
  expect(sheet.queryByRole('button', { name: 'Speichern' })).not.toBeOnTheScreen();
});

test('blättert in die Vergangenheit und zurück, aber nicht über die laufende Woche hinaus', async () => {
  await open();

  expect(screen.getByRole('button', { name: 'Nächste Woche' })).toBeDisabled();
  await user.press(screen.getByRole('button', { name: 'Vorige Woche' }));
  await settle();

  expect(screen.getByRole('header', { name: 'Letzte Woche, Woche vom 05.10. bis 11.10.' })).toBeOnTheScreen();
  expect(screen.getByRole('progressbar', { name: 'Sport in dieser Woche' }).props.accessibilityValue).toMatchObject({ now: 50 });
  expect(screen.getByText('Schwimmen')).toBeOnTheScreen();
  // Eine neue Einheit beginnt „jetzt“; in vergangenen Wochen gibt es „+ Einheit“ deshalb nicht.
  expect(screen.queryByRole('button', { name: '+ Einheit' })).not.toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Vorige Woche' }));
  await settle();
  expect(screen.getByRole('header', { name: '28.09.–04.10., Woche vom 28.09. bis 04.10.' })).toBeOnTheScreen();
  expect(screen.getByText('In dieser Woche gab es keine Einheit.')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Nächste Woche' }));
  await settle();
  await user.press(screen.getByRole('button', { name: 'Nächste Woche' }));
  await settle();
  expect(screen.getByRole('header', { name: 'Diese Woche, Woche vom 12.10. bis 18.10.' })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Nächste Woche' })).toBeDisabled();
});

test('„+ Einheit“ öffnet das Formular aus #173', async () => {
  await open();

  await user.press(screen.getByRole('button', { name: '+ Einheit' }));
  await settle();

  expect(screen).toHavePathname('/capture/sport');
  expect(screen).toHaveSearchParams({ newEntry: 'true' });
  expect(screen.getByLabelText('Dauer')).toBeOnTheScreen();
});

test('ohne gültige Zielversion zeigt sie die Minuten ohne Balken', async () => {
  await open({ planReader: fakePlanReader({ goals: [], weeklyPlans: [] }) });

  expect(screen.getByText('90 min')).toBeOnTheScreen();
  expect(screen.getByText('in dieser Woche')).toBeOnTheScreen();
  expect(screen.queryByRole('progressbar')).not.toBeOnTheScreen();
});

describe('Bearbeitungs-Sheet', () => {
  test('öffnet mit den Werten der Einheit; Speichern ändert sie und zeigt „Rückgängig“', async () => {
    const world = await open();

    await user.press(runRow());
    const sheet = screen.getByTestId('sheet');
    expect(within(sheet).getByRole('header', { name: 'Einheit bearbeiten' })).toBeOnTheScreen();
    expect(within(sheet).getByRole('radio', { name: 'Laufen' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(within(sheet).getByLabelText('Dauer').props.value).toBe('30');
    expect(within(sheet).getByLabelText('Beginn').props.value).toBe('2026-10-14T09:00:00.000Z');
    expect(within(sheet).getByLabelText('Kalorien (optional)').props.value).toBe('210');
    await user.press(within(sheet).getByRole('radio', { name: '45 min' }));
    await user.press(within(sheet).getByRole('button', { name: 'Speichern' }));
    await settle();

    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
    expect(world.sports().find((row) => row.startedAt === '2026-10-14T09:00:00.000Z')).toMatchObject({ durationMinutes: 45, activeMilliKcal: 210_000 });
    expect(screen.getByText('45 min Laufen gespeichert')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Sport in dieser Woche' }).props.accessibilityValue).toMatchObject({ now: 105 });

    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
    await settle();
    expect(world.sports().find((row) => row.startedAt === '2026-10-14T09:00:00.000Z')).toMatchObject({ durationMinutes: 30 });
  });

  test('Titel und Felder scrollen, „Speichern“ und „Löschen“ stehen fest darunter (iPhone SE, Impeccable-Kritik)', async () => {
    await open();

    await user.press(runRow());

    const sheet = screen.getByTestId('sheet');
    const scroll = within(sheet).getByTestId('sheet-scroll');
    // https://reactnative.dev/docs/scrollview#keyboardshouldpersisttaps
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(within(scroll).getByRole('header', { name: 'Einheit bearbeiten' })).toBeOnTheScreen();
    expect(within(scroll).getByLabelText('Dauer')).toBeOnTheScreen();
    for (const name of ['Speichern', 'Löschen']) {
      expect(within(sheet).getByRole('button', { name })).toBeOnTheScreen();
      expect(within(scroll).queryByRole('button', { name })).not.toBeOnTheScreen();
    }
  });

  test('„Löschen“ löscht ohne Bestätigungsdialog; „Rückgängig“ legt die Einheit neu an', async () => {
    const world = await open();

    await user.press(runRow());
    await user.press(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Löschen' }));
    await settle();

    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(screen.getByText('30 min Laufen gelöscht')).toBeOnTheScreen();
    expect(screen.queryByText('11:00 · Manuell · ≈ 210 kcal')).not.toBeOnTheScreen();
    expect(world.sports().filter((row) => row.deletedAt === null)).toHaveLength(3);

    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
    await settle();
    expect(world.sports().filter((row) => row.deletedAt === null)).toHaveLength(4);
    expect(screen.getByText('11:00 · Manuell · ≈ 210 kcal')).toBeOnTheScreen();
  });
});

test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp, auch im Sheet', async () => {
  await open();
  const fits = (name: string) => {
    const area = hitArea(screen.getByRole('button', { name }));
    expect({ name, fits: area.width >= 48 && area.height >= 48 }).toEqual({ name, fits: true });
  };

  fits('Vorige Woche');
  fits('Nächste Woche');
  fits('+ Einheit');
  fits('Laufen, 30 min, 11:00 · Manuell · etwa 210 kcal');
  fits('Gehen, 40 min, 18:00 · Manuell');
  await user.press(runRow());
  fits('Speichern');
  fits('Löschen');
});

describe('Schriftfaktor 2,0', () => {
  const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  beforeEach(() => Dimensions.set({ window: { ...initial.window, fontScale: 2 }, screen: { ...initial.screen, fontScale: 2 } }));
  afterEach(() => Dimensions.set(initial));

  test('Texte wachsen mit, und Blättern und Bearbeiten bleiben bedienbar', async () => {
    const world = await open();

    for (const text of screen.queryAllByText(/[\s\S]+/, { includeHiddenElements: true })) {
      const big = (StyleSheet.flatten(text.props.style as TextStyle) ?? {}).fontSize === typeTokens.numberXl.fontSize;
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(big ? textScale.limit.numberXl : textScale.max);
    }
    expect(StyleSheet.flatten(screen.getByText('Diese Woche').props.style as TextStyle)).toMatchObject({ flex: 1 });
    await user.press(runRow());
    await user.press(within(screen.getByTestId('sheet')).getByRole('button', { name: 'Löschen' }));
    expect(world.sports().filter((row) => row.deletedAt === null)).toHaveLength(3);
  });
});
