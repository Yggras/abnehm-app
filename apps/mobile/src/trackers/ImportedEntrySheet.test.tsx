import { act, screen, userEvent, within } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Dimensions, StyleSheet, type TextStyle } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, type BausteinKey, type Weekday } from '@abnehm/contracts/base';
import type { ImportOrigin } from '@abnehm/contracts/trackers';

import { fakePlanReader, type FakeGoalVersion, type FakeWeeklyPlanVersion } from '../area-ports/testing/fakes';
import { ClockProvider } from '../clock/clock-context';
import { textScale } from '../design';
import { hitArea } from '../design/testing/hit-area';
import { routeScreen } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { appSportWeeks, appTrackers, appWeightDetail } from './app-trackers';
import { SportCaptureScreen } from './SportCaptureScreen';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';
import { WeightCaptureScreen } from './WeightCaptureScreen';

// Nachweis für #186 am gerenderten Bildschirm: das schreibgeschützte Sheet eines importierten Trainings im
// Sport-Detailbildschirm und eines importierten Gewichts in der Messliste, mit dem echten Tracker-Modul über
// einer echten SQLite-Datei und dem `PlanReader`-Fake aus #104. Heute ist Mittwoch, der 14.10.2026, 12:00 in
// Berlin.

jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const goal: FakeGoalVersion = {
  id: EntityId.parse('5a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c41'),
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
  id: EntityId.parse('5a4c6e8f-1b3d-4f5a-9c7e-2b4d6f8a0c42'),
  personId: philipp,
  validFrom: LocalDate.parse('2026-09-01'),
  days: Object.fromEntries(weekdays.map((weekday) => [weekday, ['wasserziel', 'sporteinheit', 'gewogen'] as BausteinKey[]])) as FakeWeeklyPlanVersion['days'],
};
const planReader = fakePlanReader({ goals: [goal], weeklyPlans: [weeklyPlan] });

const user = userEvent.setup();
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const notBefore = Instant.parse('2026-10-01T00:00:00.000Z');
const fitbit = { id: 'com.fitbit.FitbitMobile', name: null } as const;

/** Ein Fitbit-Training heute um 07:00 in Berlin, 52 Minuten, von der Plattform als Radfahren erkannt. */
function importTraining(world: TrackerWorld, origin: ImportOrigin = 'apple_health') {
  world.trackers.importHealth(
    {
      origin,
      type: 'workout',
      upserts: [
        {
          type: 'workout',
          externalKey: 'training',
          sourceApp: fitbit,
          utcOffsetMinutes: 120,
          startedAt: Instant.parse('2026-10-14T05:00:00.000Z'),
          endedAt: Instant.parse('2026-10-14T05:52:00.000Z'),
          durationSeconds: 52 * 60,
          // HKWorkoutActivityType 13 ist Radfahren.
          platformActivityType: 13,
          activeMilliKcal: origin === 'apple_health' ? 412_000 : null,
        },
      ],
      deletedKeys: [],
      reconcileSince: null,
      notBefore,
    },
    () => {},
  );
}

/** Ein Waagenwert heute um 06:30 in Berlin, mit genauen Gramm, über eine Waage ohne bekannte Kennung. */
function importWeight(world: TrackerWorld) {
  world.trackers.importHealth(
    {
      origin: 'health_connect',
      type: 'weight',
      upserts: [
        {
          type: 'weight',
          externalKey: 'waage',
          sourceApp: { id: 'com.withings.wiScaleNG', name: 'Withings' },
          utcOffsetMinutes: 120,
          measuredAt: Instant.parse('2026-10-14T04:30:00.000Z'),
          weightG: 82_437,
        },
      ],
      deletedKeys: [],
      reconcileSince: null,
      notBefore,
    },
    () => {},
  );
}

async function open(route: 'sport' | 'weight', fill: (world: TrackerWorld) => void) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world: TrackerWorld = await createTrackerWorld(clock);
  cleanups.push(() => world.close());
  fill(world);
  cleanups.push(appTrackers.opened(world.trackers));
  cleanups.push(appSportWeeks.opened((day) => world.trackers.sportWeek(planReader, () => () => {}, day)));
  cleanups.push(appWeightDetail.opened(world.trackers.weightDetail(planReader, () => () => {})));
  const Layout = () => (
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <Slot />
      </MessageHostProvider>
    </ClockProvider>
  );
  await renderRouter(
    {
      _layout: Layout,
      index: () => null,
      'capture/sport': routeScreen('capture.sport', SportCaptureScreen),
      'capture/weight': routeScreen('capture.weight', WeightCaptureScreen),
    },
    { initialUrl: '/' },
  );
  await act(() => router.push(`/capture/${route}`));
  await act(async () => {});
  return world;
}

const settle = () => act(async () => {});
const trainingRow = (name = 'Radfahren') => screen.getByRole('button', { name: `${name}, 52 min, 07:00 · Google Health (Fitbit) · etwa 412 kcal, Apple Health` });
const weightRow = () => screen.getByRole('button', { name: '82,4 kg, heute · 06:30 · Tagesgewicht · Withings, Health Connect' });
const sheet = () => screen.getByTestId('sheet');

describe('Training', () => {
  test('zeigt Herkunft, Quell-App, Werte und den Hinweis; nichts lässt sich bearbeiten', async () => {
    await open('sport', importTraining);

    await user.press(trainingRow());

    const shown = within(sheet());
    expect(shown.getByRole('header', { name: 'Training aus Apple Health' })).toBeOnTheScreen();
    const rows: readonly (readonly [string, string])[] = [
      ['Art', 'Radfahren'],
      ['Dauer', '52 min'],
      ['Beginn', 'heute · 07:00'],
      ['Kalorien', '≈ 412 kcal'],
      ['Herkunft', 'Apple Health'],
      ['Quell-App', 'Google Health (Fitbit)'],
    ];
    for (const [label, value] of rows) {
      expect(shown.getByText(label)).toBeOnTheScreen();
      expect(shown.getByText(value)).toBeOnTheScreen();
    }
    // Kalorien zählen nirgends (#38), wie im Formular einer manuellen Einheit.
    expect(shown.getByText('wird nur angezeigt')).toBeOnTheScreen();
    expect(shown.getByText('Werte änderst du in der Quell-App.')).toBeOnTheScreen();
    expect(shown.queryByRole('textbox')).not.toBeOnTheScreen();
    expect(shown.queryByRole('adjustable')).not.toBeOnTheScreen();
    // Die Liste der acht Arten braucht Platz: volle Höhe, Werte scrollen über dem festen Fuß.
    expect(sheet().props.nativeID).toBe('sheet-full');
    // Nur die beiden Aktionen; die Wertzeilen sind keine Schaltflächen.
    expect(shown.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual(['Aktivitätsart ändern', '52 min Radfahren ausblenden']);
  });

  test('„Ausblenden“ blendet ohne Bestätigungsdialog aus; „Rückgängig“ holt das Training zurück', async () => {
    const world = await open('sport', importTraining);

    await user.press(trainingRow());
    await user.press(within(sheet()).getByRole('button', { name: '52 min Radfahren ausblenden' }));
    await settle();

    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
    expect(screen.getByText('52 min Radfahren ausgeblendet')).toBeOnTheScreen();
    expect(screen.getByText('Noch keine Einheit in dieser Woche.')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Sport in dieser Woche' }).props.accessibilityValue).toMatchObject({ now: 0 });
    expect(world.sports()[0]).toMatchObject({ hiddenAt: noon });

    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
    await settle();
    expect(world.sports()[0]).toMatchObject({ hiddenAt: null });
    expect(trainingRow()).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Sport in dieser Woche' }).props.accessibilityValue).toMatchObject({ now: 52 });
  });

  test('„Aktivitätsart ändern“ wählt die Art im selben Sheet; die Liste zeigt sie, das Sheet nennt die erkannte, „Rückgängig“ stellt sie zurück', async () => {
    const world = await open('sport', importTraining);

    await user.press(trainingRow());
    await user.press(within(sheet()).getByRole('button', { name: 'Aktivitätsart ändern' }));

    const choice = within(sheet());
    expect(choice.getByRole('header', { name: 'Aktivitätsart ändern' })).toBeOnTheScreen();
    expect(choice.getByText('Erkannt als Radfahren.')).toBeOnTheScreen();
    expect(choice.getAllByRole('radio')).toHaveLength(8);
    expect(choice.getByRole('radio', { name: 'Radfahren' }).props.accessibilityState).toMatchObject({ checked: true });
    await user.press(choice.getByRole('radio', { name: 'Krafttraining' }));
    await settle();

    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
    expect(screen.getByText('Jetzt Krafttraining statt Radfahren')).toBeOnTheScreen();
    expect(world.sports()[0]).toMatchObject({ activityType: 'radfahren', overrideActivityType: 'krafttraining' });
    await user.press(trainingRow('Krafttraining'));
    expect(within(sheet()).getByText('Krafttraining')).toBeOnTheScreen();
    expect(within(sheet()).getByText('erkannt als Radfahren')).toBeOnTheScreen();
    await user.press(within(sheet()).getByRole('button', { name: 'Aktivitätsart ändern' }));
    await user.press(within(sheet()).getByRole('button', { name: 'Zurück' }));
    expect(within(sheet()).getByRole('header', { name: 'Training aus Apple Health' })).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
    await settle();
    expect(world.sports()[0]).toMatchObject({ overrideActivityType: null });
  });

  test('die schon angezeigte Art zu wählen ändert nichts und führt zurück', async () => {
    const world = await open('sport', importTraining);
    const before = world.operations().length;

    await user.press(trainingRow());
    await user.press(within(sheet()).getByRole('button', { name: 'Aktivitätsart ändern' }));
    await user.press(within(sheet()).getByRole('radio', { name: 'Radfahren' }));

    expect(within(sheet()).getByRole('header', { name: 'Training aus Apple Health' })).toBeOnTheScreen();
    expect(world.operations()).toHaveLength(before);
  });

  test('Health Connect ohne Kalorien: Herkunft und Quell-App stimmen, die Kalorienzeile fehlt', async () => {
    await open('sport', (world) => importTraining(world, 'health_connect'));

    // Health Connect bildet seine Trainingsart 13 anders ab als HealthKit (Abbildungstabelle der Tracker-Regeln).
    await user.press(screen.getByRole('button', { name: 'Krafttraining, 52 min, 07:00 · Google Health (Fitbit), Health Connect' }));

    const shown = within(sheet());
    expect(shown.getByRole('header', { name: 'Training aus Health Connect' })).toBeOnTheScreen();
    expect(shown.getByText('Health Connect')).toBeOnTheScreen();
    expect(shown.queryByText('Kalorien')).not.toBeOnTheScreen();
  });
});

describe('Gewicht', () => {
  test('zeigt Herkunft, Quell-App, Wert, Messzeitpunkt und den Hinweis; nur „Ausblenden“', async () => {
    await open('weight', importWeight);

    await user.press(weightRow());

    const shown = within(sheet());
    expect(shown.getByRole('header', { name: 'Gewicht aus Health Connect' })).toBeOnTheScreen();
    for (const text of ['Gewicht', '82,4 kg', 'Tagesgewicht', 'Gemessen', 'heute · 06:30', 'Herkunft', 'Health Connect', 'Quell-App', 'Withings']) {
      expect(shown.getByText(text)).toBeOnTheScreen();
    }
    expect(shown.getByText('Werte änderst du in der Quell-App.')).toBeOnTheScreen();
    expect(shown.queryByRole('textbox')).not.toBeOnTheScreen();
    expect(shown.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual(['82,4 kg ausblenden']);
    // Wenige Zeilen: Das Sheet nimmt die Höhe seines Inhalts, „Ausblenden“ steht direkt darunter (Impeccable-Kritik).
    expect(sheet().props.nativeID).toBe('sheet-content');
    expect(shown.queryByTestId('sheet-scroll')).not.toBeOnTheScreen();
  });

  test('„Ausblenden“ eines Tagesgewichts leert die Messliste; „Rückgängig“ holt es zurück', async () => {
    const world = await open('weight', importWeight);

    await user.press(weightRow());
    await user.press(within(sheet()).getByRole('button', { name: '82,4 kg ausblenden' }));
    await settle();

    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
    expect(screen.getByText('82,4 kg ausgeblendet')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Gewicht eintragen' })).toBeOnTheScreen();
    expect(world.weights()[0]).toMatchObject({ hiddenAt: noon });

    await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
    await settle();
    expect(weightRow()).toBeOnTheScreen();
  });
});

test('alle Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp', async () => {
  await open('sport', importTraining);
  const fits = (name: string, role: 'button' | 'radio' = 'button') => {
    const area = hitArea(within(sheet()).getByRole(role, { name }));
    expect({ name, fits: area.width >= 48 && area.height >= 48 }).toEqual({ name, fits: true });
  };
  const rowArea = hitArea(trainingRow());
  expect(rowArea.height).toBeGreaterThanOrEqual(48);

  await user.press(trainingRow());
  fits('Aktivitätsart ändern');
  fits('52 min Radfahren ausblenden');
  await user.press(within(sheet()).getByRole('button', { name: 'Aktivitätsart ändern' }));
  for (const name of ['Gehen', 'Laufen', 'Radfahren', 'Schwimmen', 'Krafttraining', 'Yoga & Dehnen', 'Mannschaftssport', 'Sonstiges']) fits(name, 'radio');
  fits('Zurück');
});

describe('Schriftfaktor 2,0', () => {
  const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };
  beforeEach(() => Dimensions.set({ window: { ...initial.window, fontScale: 2 }, screen: { ...initial.screen, fontScale: 2 } }));
  afterEach(() => Dimensions.set(initial));

  test('Texte wachsen mit; Werte scrollen, die Aktionen stehen fest darunter und bleiben bedienbar', async () => {
    const world = await open('sport', importTraining);

    await user.press(trainingRow());

    const scroll = within(sheet()).getByTestId('sheet-scroll');
    for (const text of within(sheet()).queryAllByText(/[\s\S]+/, { includeHiddenElements: true })) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(textScale.max);
    }
    expect(within(scroll).getByText('Werte änderst du in der Quell-App.')).toBeOnTheScreen();
    for (const name of ['Aktivitätsart ändern', '52 min Radfahren ausblenden']) {
      expect(within(scroll).queryByRole('button', { name })).not.toBeOnTheScreen();
    }
    expect(StyleSheet.flatten(within(sheet()).getByText('Ausblenden').props.style as TextStyle)).not.toMatchObject({ numberOfLines: 1 });
    await user.press(within(sheet()).getByRole('button', { name: '52 min Radfahren ausblenden' }));
    expect(world.sports()[0]).toMatchObject({ hiddenAt: noon });
  });
});
