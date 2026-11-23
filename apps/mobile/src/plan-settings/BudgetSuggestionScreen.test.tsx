/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { Instant, LocalDate } from '@abnehm/contracts/base';
import { budgetSuggestionId, type BudgetSuggestionUpsert } from '@abnehm/contracts/plan';

import BudgetSuggestionRoute from '../app/plan/budget_suggestion';
import { hitArea } from '../design/testing/hit-area';
import { withDeviceConfig } from '../design/testing/device-config';
import { openTarget } from '../navigation';
import { writeBudgetSuggestion } from '../plan/budget-suggestion-repository';
import { readGoalVersionOn } from '../plan/plan-repository';
import { ScreenFrame } from '../shell/ScreenFrame';
import { berlin, philipp, wednesdayNoon } from '../plan/testing/today-world';
import { createGoalsWorld, type GoalsWorld } from './testing/goals-world';

// Nachweis für #151: das Sheet `plan.budget_suggestion` (Spezifikation 1, Abschnitt 7) mit der echten
// Routendatei und dem echten Plan-Modul über einer SQLite-Datei mit den Migrationen der App. Die Testuhr
// steht in Berlin am Mittwoch, 14.10.2026, 12:00; der Erstplan ist der Referenzfall der Recherche (Budget
// 1.620 kcal, entspannt). Den offenen Vorschlag legt der Test so an, wie ihn die Prüfung aus #150 schreibt.

const user = userEvent.setup();
const day = (value: string) => LocalDate.parse(value);
const suggestionId = budgetSuggestionId(philipp, day('2026-10-13'));
let world: GoalsWorld;
let clock: TestClock;

afterEach(() => world.close());

const lower: BudgetSuggestionUpsert = {
  periodFrom: day('2026-09-23'),
  periodTo: day('2026-10-13'),
  previousBudgetMilliKcal: 1_620_000,
  suggestedBudgetMilliKcal: 1_514_000,
  direction: 'senken',
  status: 'offen',
};
const raise: BudgetSuggestionUpsert = { ...lower, suggestedBudgetMilliKcal: 1_770_000, direction: 'anheben' };

async function open(suggestion: BudgetSuggestionUpsert | null = lower, plan: Parameters<GoalsWorld['saveInitialPlan']>[0] = {}) {
  clock = createTestClock({ instant: wednesdayNoon, timeZone: berlin });
  world = await createGoalsWorld(clock);
  await world.saveInitialPlan(plan);
  if (suggestion !== null) {
    world.database.transaction((tx) => writeBudgetSuggestion(tx, suggestionId, philipp, suggestion, Instant.parse(wednesdayNoon)));
  }
  await renderRouter({ _layout: world.Layout, index: Caller, 'plan/budget_suggestion': BudgetSuggestionRoute }, { initialUrl: '/' });
  await act(async () => openTarget({ type: 'plan.budget_suggestion', suggestionId }));
}

/** Der Aufrufer des Sheets, etwa „Heute“: Nach dem Schließen zeigt er die Meldung des Meldungs-Hosts. */
function Caller() {
  return <ScreenFrame title="Aufrufer" presentation="page">{null}</ScreenFrame>;
}

const button = (name: string) => screen.getByRole('button', { name });
const accept = () => button('Übernehmen ab morgen');
const decline = () => button('Nicht jetzt');
const status = () => world.plan.budgetSuggestion(suggestionId);
const goalTomorrow = () => world.database.read((tx) => readGoalVersionOn(tx, philipp, day('2026-10-15')))!.values;

describe('Anzeige', () => {
  test('bisheriges und vorgeschlagenes Budget und eine neutrale Begründung: Trend im Vergleich zum gewählten Tempo', async () => {
    await open();

    expect(screen.getByLabelText('Bisheriges Budget: 1.620 kcal pro Tag')).toBeOnTheScreen();
    expect(screen.getByLabelText('Vorschlag ab morgen: 1.514 kcal pro Tag')).toBeOnTheScreen();
    expect(
      screen.getByText('In den letzten drei Wochen hast du laut Gewichtstrend langsamer abgenommen als mit deinem Tempo „entspannt“ (etwa 0,5 kg pro Woche).'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Mit 106 kcal weniger am Tag kommst du näher an dieses Tempo.')).toBeOnTheScreen();
    expect(screen.getByText('Dein Budget ändert sich nur, wenn du den Vorschlag übernimmst.')).toBeOnTheScreen();
    expect(accept()).toBeOnTheScreen();
    expect(decline()).toBeOnTheScreen();
  });

  test('beim Anheben ebenso neutral, ohne Bewertung', async () => {
    await open(raise);

    expect(screen.getByLabelText('Vorschlag ab morgen: 1.770 kcal pro Tag')).toBeOnTheScreen();
    expect(
      screen.getByText('In den letzten drei Wochen hast du laut Gewichtstrend schneller abgenommen als mit deinem Tempo „entspannt“ (etwa 0,5 kg pro Woche).'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Mit 150 kcal mehr am Tag kommst du näher an dieses Tempo.')).toBeOnTheScreen();
  });

  test.each([
    ['abgelehnt', 'Diesen Vorschlag hast du abgelehnt.'],
    ['angenommen', 'Diesen Vorschlag hast du übernommen.'],
    ['ueberholt', 'Dieser Vorschlag gilt nicht mehr, weil sich deine Ziele inzwischen geändert haben.'],
  ] as const)('ein Vorschlag im Status %s öffnet kein Sheet mit Aktionen', async (decided, text) => {
    await open({ ...lower, status: decided });

    expect(screen.getByText(text)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Übernehmen ab morgen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nicht jetzt' })).toBeNull();
  });

  test('ein unbekannter Vorschlag ebenso nicht', async () => {
    await open(null);

    expect(screen.getByText('Diesen Vorschlag gibt es nicht mehr.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Übernehmen ab morgen' })).toBeNull();
  });
});

describe('Entscheidung', () => {
  test('„Übernehmen ab morgen“ legt die Zielversion ab morgen an, schließt das Sheet und bestätigt es', async () => {
    await open();

    await user.press(accept());

    expect(goalTomorrow()).toMatchObject({ validFrom: '2026-10-15', calorieBudgetMilliKcal: 1_514_000, budgetSource: 'budgetvorschlag' });
    expect(status()).toEqual({ type: 'entschieden', status: 'angenommen' });
    expect(screen).toHavePathname('/');
    expect(screen.getByText('Budget übernommen · gilt ab morgen')).toBeOnTheScreen();
  });

  test('„Nicht jetzt“ lehnt ab, ohne die Ziele zu ändern, und schließt das Sheet', async () => {
    await open();

    await user.press(decline());

    expect(status()).toEqual({ type: 'entschieden', status: 'abgelehnt' });
    expect(goalTomorrow().validFrom).toBe('2026-10-14');
    expect(screen).toHavePathname('/');
  });

  test('ohne Bestätigung ändert sich nichts: Schließen lässt den Vorschlag offen', async () => {
    await open();

    await user.press(button('Fertig'));

    expect(status()).toMatchObject({ type: 'offen' });
    expect(goalTomorrow().validFrom).toBe('2026-10-14');
  });
});

describe('Zugänglichkeit und Sprache', () => {
  test('Aktionen haben mindestens 48 × 48 dp', async () => {
    await open();

    for (const action of [accept(), decline()]) {
      const { width, height } = hitArea(action);
      expect(width).toBeGreaterThanOrEqual(48);
      expect(height).toBeGreaterThanOrEqual(48);
    }
  });

  describe('mit Schriftfaktor 2,0', () => {
    withDeviceConfig('schriftfaktor-2');

    test('bleiben Werte, Begründung und beide Aktionen erreichbar', async () => {
      await open();

      expect(screen.getByLabelText('Vorschlag ab morgen: 1.514 kcal pro Tag')).toBeOnTheScreen();
      expect(accept()).toBeOnTheScreen();
      expect(decline()).toBeOnTheScreen();
    });
  });
});
