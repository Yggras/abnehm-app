import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import { Dimensions, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import type { ImportOrigin } from '@abnehm/contracts/trackers';

import { color, textScale } from '../design';
import { hitArea } from '../design/testing/hit-area';
import { OnboardingStep } from '../shell/OnboardingStep';
import { createOnboardingRegistry } from '../shell/onboarding-registry';
import { berlin, createTrackerWorld, noon, type TrackerWorld } from '../trackers/testing/tracker-world';
import { appHealthImport } from './app-health';
import { createHealthImport, type HealthImport } from './health-import';
import { HealthStep } from './HealthStep';
import { applyHealthScenario, createFakeHealthPlatform, type FakeHealthPlatform, type HealthScenario } from './testing/fake-platform';

// Nachweis für #189: Onboarding-Schritt `health` (Spezifikation 3, Abschnitt 6) am Steckplatz der
// Onboarding-Registry aus #110. Er arbeitet ausschließlich über den Health-Import-Dienst aus #183, hier mit
// echtem Tracker-Modul, echter SQLite-Datei und der Health-Attrappe. Die Shell prüft jedes gemeldete
// Ergebnis gegen den Vertrag; „Überspringen“ zeichnet der Rahmen von Spezifikation 1
// (`src/onboarding/Onboarding.test.tsx`).

const user = userEvent.setup();
const explanation = 'Wir lesen nur Trainings und Gewicht. Wir schreiben nichts zurück.';
const empty = 'Noch keine Trainings oder Gewichte gefunden';
const guideTitle = 'Fitbit-Daten fehlen?';

type StepWorld = { world: TrackerWorld; clock: TestClock; fake: FakeHealthPlatform; health: HealthImport; onComplete: jest.Mock };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function renderStep({ origin = 'apple_health', scenario }: { origin?: ImportOrigin; scenario?: HealthScenario } = {}): Promise<StepWorld> {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world = await createTrackerWorld(clock);
  cleanups.push(() => world.close());
  const fake = createFakeHealthPlatform({ origin, clock });
  if (scenario !== undefined) await applyHealthScenario(fake, scenario, clock);
  const health = createHealthImport({ database: world.database, platform: fake, trackers: world.trackers, clock, onError: () => {} });
  cleanups.push(appHealthImport.opened(health));
  const registry = createOnboardingRegistry();
  registry.register('tracker', 'health', HealthStep);
  const onComplete = jest.fn();
  await render(<OnboardingStep stepKey="health" registry={registry} onComplete={onComplete} />);
  return { world, clock, fake, health, onComplete };
}

async function connect(step: StepWorld) {
  await user.press(screen.getByRole('button', { name: 'Verbinden' }));
  await act(() => step.health.idle());
  await checked();
}

/** Wartet, bis die Prüfung der Quell-Apps gelesen hat. */
async function checked() {
  await waitFor(() => expect(screen.queryByLabelText('Quell-Apps werden geprüft')).not.toBeOnTheScreen());
}

const sourceAppsHeader = 'Quell-Apps der letzten 30 Tage';

describe('vor dem Verbinden', () => {
  test('zeigt den Erklärtext und die Hauptaktion „Verbinden“, fragt aber noch nichts an', async () => {
    const step = await renderStep({ scenario: 'erstimport' });

    expect(screen.getByText(explanation)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Verbinden' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Überspringen' })).not.toBeOnTheScreen();
    expect(await step.fake.accessState()).toBe('nicht_angefragt');
    expect(step.health.connection()).toBeNull();
    expect(step.onComplete).not.toHaveBeenCalled();
  });
});

describe('„Verbinden“ bei verfügbarer Plattform', () => {
  test('fragt Lesezugriff an, startet direkt den Import und zeigt danach die Prüfung der Quell-Apps', async () => {
    const step = await renderStep({ scenario: 'erstimport' });

    await connect(step);

    expect(await step.fake.accessState()).toBe('erteilt');
    expect(step.health.connection()).not.toBeNull();
    // Der Erstimport ist gelaufen: Gewichte der letzten 30 Tage, Trainings ab dem Verbindungstag.
    expect(step.world.weights().map((row) => row.externalKey).sort()).toEqual(['gewicht-2-tage', 'gewicht-29-tage', 'gewicht-heute']);
    expect(step.world.sports().map((row) => row.externalKey)).toEqual(['training-heute']);
    expect(screen.getByText('Google Health (Fitbit)')).toBeOnTheScreen();
    expect(step.onComplete).not.toHaveBeenCalled();
  });

  test.each(['erteilt', 'angefragt', 'verweigert'] as const)(
    'meldet `health_connected`, sobald die Anfrage abgeschlossen ist, auch bei Zugriff „%s“',
    async (access) => {
      const step = await renderStep({ scenario: 'fitbit_vorhanden' });
      step.fake.setAccess(access);

      await connect(step);
      await user.press(screen.getByRole('button', { name: 'Weiter' }));

      expect(step.onComplete).toHaveBeenCalledTimes(1);
      expect(step.onComplete).toHaveBeenCalledWith({ type: 'health_connected' });
    },
  );

  test('ist das Gerät schon verbunden, zeigt der Schritt beim erneuten Öffnen gleich die Prüfung mit „Weiter“', async () => {
    const step = await renderStep({ scenario: 'fitbit_vorhanden' });
    await connect(step);

    // Neu geöffnet, etwa nach „Zurück“ aus Schritt 10: Der Schlüssel erzwingt einen frischen Beitrag.
    const registry = createOnboardingRegistry();
    registry.register('tracker', 'health', HealthStep);
    const onComplete = jest.fn();
    await screen.rerender(<OnboardingStep key="erneut" stepKey="health" registry={registry} onComplete={onComplete} />);
    await checked();

    expect(screen.getByText('Google Health (Fitbit)')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Weiter' }));
    expect(onComplete).toHaveBeenCalledWith({ type: 'health_connected' });
  });
});

describe('Verfügbarkeit', () => {
  test('Installation nötig: Hinweis auf den Play Store, kein Ergebnis, „Verbinden“ bleibt für danach', async () => {
    const step = await renderStep({ origin: 'health_connect', scenario: 'installation_noetig' });

    await connect(step);

    expect(screen.getByText('Health Connect ist noch nicht installiert. Installiere es aus dem Play Store und tippe dann noch einmal auf „Verbinden“.')).toBeOnTheScreen();
    expect(step.onComplete).not.toHaveBeenCalled();
    expect(step.health.connection()).toBeNull();

    step.fake.setAvailability('verfuegbar');
    await connect(step);
    expect(step.health.connection()).not.toBeNull();
    expect(screen.queryByText(/Play Store/)).not.toBeOnTheScreen();
  });

  test('nicht verfügbar: Ergebnis `health_unavailable`, ohne Anfrage', async () => {
    const step = await renderStep({ scenario: 'nicht_verfuegbar' });

    await connect(step);

    expect(step.onComplete).toHaveBeenCalledWith({ type: 'health_unavailable' });
    expect(await step.fake.accessState()).toBe('nicht_angefragt');
    expect(step.health.connection()).toBeNull();
  });

  test('scheitert die Anfrage, bleibt der Schritt neutral und lässt es noch einmal versuchen', async () => {
    const step = await renderStep({ scenario: 'fitbit_vorhanden' });
    const requestReadAccess = jest.spyOn(step.fake, 'requestReadAccess').mockRejectedValueOnce(new Error('Systemdialog nicht erreichbar'));

    await connect(step);

    expect(screen.getByText('Das Verbinden hat gerade nicht geklappt. Versuch es noch einmal oder später unter Einstellungen › Gesundheitsdaten.')).toBeOnTheScreen();
    expect(step.onComplete).not.toHaveBeenCalled();
    expect(problemColors()).toEqual([]);

    requestReadAccess.mockRestore();
    await connect(step);
    expect(screen.getByText('Google Health (Fitbit)')).toBeOnTheScreen();
  });
});

describe('Prüfung der Quell-Apps', () => {
  test('gruppiert die Trainings und Gewichte der letzten 30 Tage nach Quell-App; mit Google Health (Fitbit) keine Anleitung', async () => {
    const step = await renderStep({ scenario: 'fitbit_vorhanden' });

    await connect(step);

    expect(screen.getByText('Google Health (Fitbit)')).toBeOnTheScreen();
    expect(screen.getByText('1 Training')).toBeOnTheScreen();
    expect(screen.getByText('Withings')).toBeOnTheScreen();
    expect(screen.getByText('1 Gewicht')).toBeOnTheScreen();
    expect(screen.queryByText(guideTitle)).not.toBeOnTheScreen();
  });

  test('zählt mehrere Einträge einer Quell-App im Plural', async () => {
    const step = await renderStep({ scenario: 'erstimport' });

    await connect(step);

    // Gewichte vor 29 und 2 Tagen sowie heute, Trainings gestern und heute; das Gewicht vor 40 Tagen fällt heraus.
    expect(screen.getByText('2 Trainings · 3 Gewichte')).toBeOnTheScreen();
  });

  test.each([
    [
      'apple_health',
      'Die Kopplung von Uhr und Google Health genügt nicht. Richte zusätzlich in Google Health unter Profil › Partner apps › Apple Health die Verbindung ein. Ist Apple Health dort schon verbunden, trenne die Verbindung und verbinde neu.',
    ],
    ['health_connect', 'Schalte in Google Health unter Connections › Partner apps › Sync your favorite health apps die Freigabe nach Health Connect ein.'],
  ] as const)('fehlt Google Health (Fitbit), erscheint die Anleitung für %s als nicht blockierender Hinweis', async (origin, guide) => {
    const step = await renderStep({ origin, scenario: 'fitbit_fehlt' });

    await connect(step);

    expect(screen.getByText('Apple Watch')).toBeOnTheScreen();
    expect(screen.getByText('Withings')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: guideTitle })).toBeOnTheScreen();
    expect(screen.getByText(guide)).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Weiter' }));
    expect(step.onComplete).toHaveBeenCalledWith({ type: 'health_connected' });
  });

  test('ohne Daten erscheint neutral „Noch keine Trainings oder Gewichte gefunden“ samt Anleitung, ohne problem-Farbe', async () => {
    const step = await renderStep({ scenario: 'keine_daten' });

    await connect(step);

    expect(screen.getByText(empty)).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: sourceAppsHeader })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: guideTitle })).toBeOnTheScreen();
    expect(problemColors()).toEqual([]);
  });

  test('lässt sich die Quelle nicht prüfen, sagt der Schritt es neutral und bleibt abschließbar', async () => {
    const step = await renderStep({ scenario: 'fitbit_vorhanden' });
    jest.spyOn(step.fake, 'recentOrigins').mockRejectedValue(new Error('Health Connect antwortet nicht'));

    await connect(step);

    expect(screen.getByText('Die Quell-Apps lassen sich gerade nicht prüfen.')).toBeOnTheScreen();
    expect(problemColors()).toEqual([]);
    await user.press(screen.getByRole('button', { name: 'Weiter' }));
    expect(step.onComplete).toHaveBeenCalledWith({ type: 'health_connected' });
  });
});

describe('Bedienbarkeit', () => {
  test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp', async () => {
    const step = await renderStep({ scenario: 'fitbit_fehlt' });
    const connectButton = screen.getByRole('button', { name: 'Verbinden' });
    expectTouchable(connectButton);

    await connect(step);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.props.accessibilityLabel)).toEqual(['Weiter']);
    for (const button of buttons) expectTouchable(button);
  });

  describe('Schriftfaktor 2,0', () => {
    const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };

    beforeEach(() => {
      Dimensions.set({ window: { ...initial.window, fontScale: 2 }, screen: { ...initial.screen, fontScale: 2 } });
    });

    afterEach(() => {
      Dimensions.set(initial);
    });

    test('Texte wachsen mit, und der Schritt lässt sich abschließen', async () => {
      const step = await renderStep({ origin: 'health_connect', scenario: 'fitbit_fehlt' });

      await connect(step);

      for (const text of screen.queryAllByText(/[\s\S]*/, { includeHiddenElements: true })) {
        expect(text.props.allowFontScaling).not.toBe(false);
        expect(text.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(textScale.max);
      }
      await user.press(screen.getByRole('button', { name: 'Weiter' }));
      expect(step.onComplete).toHaveBeenCalledWith({ type: 'health_connected' });
    });
  });
});

function expectTouchable(control: { props: { accessibilityLabel?: unknown; style?: unknown; hitSlop?: unknown } }) {
  const name = String(control.props.accessibilityLabel);
  expect(name).toMatch(/^[\p{Lu}\d][\p{L}\p{N} &]+$/u);
  const area = hitArea(control);
  expect({ name, fits: area.width >= 48 && area.height >= 48 }).toEqual({ name, fits: true });
}

/** Alle Text- und Flächenfarben in `problem`; Gesundheitsdaten und fehlende Verbindungen sind nie ein Problem. */
function problemColors(): string[] {
  const problem: string[] = [color.problem, color.problemSoft];
  const found: string[] = [];
  for (const node of screen.container.queryAll(() => true)) {
    const style = (StyleSheet.flatten(node.props.style as ViewStyle & TextStyle) ?? {}) as ViewStyle & TextStyle;
    for (const value of [style.color, style.backgroundColor, node.props.fill, node.props.stroke, node.props.color]) {
      if (typeof value === 'string' && problem.includes(value)) found.push(value);
    }
  }
  return found;
}
