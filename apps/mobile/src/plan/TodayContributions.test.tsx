import { act, render, screen, userEvent } from '@testing-library/react-native';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant } from '@abnehm/contracts/base';
import { contractFixtures } from '@abnehm/contracts/fixtures';

import { ClockProvider } from '../clock/clock-context';
import { createDailyGoalRegistry, type DailyGoalRegistry } from '../daily-goals';
import { hitArea } from '../design/testing/hit-area';
import { withDeviceConfig } from '../design/testing/device-config';
import { openTarget } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { createTodayRegistry, type TodayRegistry, type TodayState } from '../shell/today-registry';
import { TodayContent } from '../shell/TodayScreen';
import { berlin, createPlanTodayWorld, wednesday, wednesdayNoon, type PlanTodayWorld, type PlanTodayWorldOptions } from './testing/today-world';

// Nachweis für #136 am gerenderten „Heute“: die Beiträge `momo.daily_goals` und `nutrition.budget` des
// echten Plan-Moduls über einer echten SQLite-Datei, ausgewertet mit den Test-Evaluatoren aus #104. Die
// Shell zeichnet sie; Texte entstehen aus `messageKey` und typisierten Werten.

jest.mock('../navigation', () => ({ ...jest.requireActual('../navigation'), openTarget: jest.fn() }));

const user = userEvent.setup();
const worlds: PlanTodayWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
  jest.mocked(openTarget).mockClear();
});

/** Ernährungsprotokoll ohne Aufnahme aus den Fixtures; die Ernährungskarte braucht beide Beiträge. */
function withNutritionLog(registry: TodayRegistry) {
  const log = contractFixtures.today!.NutritionLogReady!.valid['ohne Aufnahme'];
  registry.register('ernaehrung', 'nutrition.log', { subscribe(listener) { listener({ type: 'ready', data: log } as TodayState<'nutrition.log'>); return () => {}; } });
}

/** Welt über einer neuen Testuhr am Mittwoch, 12:00 in Berlin. */
async function createWorld(options?: PlanTodayWorldOptions): Promise<PlanTodayWorld & { clock: TestClock }> {
  const clock = createTestClock({ instant: wednesdayNoon, timeZone: berlin });
  const world = await createPlanTodayWorld(clock, options);
  worlds.push(world);
  return { ...world, clock };
}

async function renderToday(options?: PlanTodayWorldOptions & { plan?: boolean }) {
  const world = await createWorld(options);
  if (options?.plan !== false) await world.saveInitialPlan();
  withNutritionLog(world.registry);
  await render(
    <ClockProvider clock={world.clock}>
      <MessageHostProvider>
        <TodayContent registry={world.registry} />
      </MessageHostProvider>
    </ClockProvider>,
  );
  await act(async () => {});
  return world;
}

const goalRow = (name: string) => screen.getByRole('button', { name });

describe('Tagesziele', () => {
  test('zeigt die drei Tagesziele nach Platz mit Wert und Zustand und öffnet den Bereich', async () => {
    await renderToday();

    const rows = screen.getAllByRole('button', { name: /\. Öffnen$/ }).map((row) => row.props.accessibilityLabel);
    expect(rows).toEqual([
      'Ernährung erfasst · 0 von 2 Mahlzeiten, offen. Öffnen',
      'Wasserziel · 0,0 von 1,5 l, offen. Öffnen',
      'Im Kalorienbudget · am Tagesende. Öffnen',
    ]);
    expect(screen.getByText('Wasserziel · 0,0 von 1,5 l')).toBeOnTheScreen();
    expect(screen.getByText('Im Kalorienbudget · am Tagesende')).toBeOnTheScreen();

    await user.press(goalRow('Wasserziel · 0,0 von 1,5 l, offen. Öffnen'));
    expect(openTarget).toHaveBeenLastCalledWith({ type: 'capture.water' });
    await user.press(goalRow('Ernährung erfasst · 0 von 2 Mahlzeiten, offen. Öffnen'));
    expect(openTarget).toHaveBeenLastCalledWith({ type: 'log' });
  });

  test('folgt Eingaben und zeigt nach einer Korrektur „offen · bereits gutgeschrieben“', async () => {
    const { enter } = await renderToday();

    await act(async () => enter(wednesday, { countedMl: 1000 }));
    expect(screen.getByText('Wasserziel · 1,0 von 1,5 l')).toBeOnTheScreen();
    expect(screen.getByText('teilweise')).toBeOnTheScreen();

    await act(async () => enter(wednesday, { countedMl: 1500 }));
    expect(screen.getByText('erfüllt')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-check', { includeHiddenElements: true })).toBeOnTheScreen();

    await act(async () => enter(wednesday, { countedMl: 0 }));
    expect(screen.getByText('offen · bereits gutgeschrieben')).toBeOnTheScreen();
  });

  test('lädt, bis der Tag materialisiert ist, und ist ohne Plan leer', async () => {
    const { clock, refresh, plan } = await renderToday();
    await act(async () => {
      clock.set(Instant.parse('2026-10-15T05:00:00.000Z'));
      refresh();
    });
    expect(screen.getByText('Tagesziele laden …')).toBeOnTheScreen();
    await act(async () => plan.ensureDailyGoals());
    expect(screen.getByText('Sporteinheit · 0 von 50 min')).toBeOnTheScreen();

    worlds.splice(0).forEach((world) => world.close());
    screen.unmount();
    await renderToday({ plan: false });
    expect(screen.getAllByText('Noch kein Ziel festgelegt.')).toHaveLength(2);
  });

  test('zeigt einen Vertragsfehler mit „Erneut versuchen“, das den Beitrag neu liest', async () => {
    const broken = createDailyGoalRegistry({ bausteine: [], checkIns: [] });
    let failing = true;
    const evaluator = (registry: DailyGoalRegistry) => ({
      evaluateDailyGoal: (...args: Parameters<DailyGoalRegistry['evaluateDailyGoal']>) => (failing ? broken : registry).evaluateDailyGoal(...args),
    });
    await renderToday({ evaluator });

    expect(screen.getByText('Tagesziele sind gerade nicht verfügbar. Versuch es erneut.')).toBeOnTheScreen();
    failing = false;
    await user.press(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(screen.getByText('Wasserziel · 0,0 von 1,5 l')).toBeOnTheScreen();
    expect(openTarget).not.toHaveBeenCalled();
  });
});

describe('Kalorienbudget', () => {
  test('zeigt das Budget des Tags und den Haltemodus in Worten', async () => {
    await renderToday({ plan: false });
    expect(screen.queryByText(/kcal übrig/)).not.toBeOnTheScreen();

    worlds.splice(0).forEach((world) => world.close());
    screen.unmount();
    const { plan } = await renderToday();
    const budget = Math.floor(plan.settings().goal.current!.calorieBudgetMilliKcal / 1_000).toLocaleString('de-DE');
    expect(screen.getByText(`${budget} kcal übrig`)).toBeOnTheScreen();
    expect(screen.getByText(`0 von ${budget} kcal · Kalorienbudget`)).toBeOnTheScreen();

    worlds.splice(0).forEach((world) => world.close());
    screen.unmount();
    const maintenance = await createWorld();
    await maintenance.saveInitialPlan({ pace: null, goalWeightG: null });
    withNutritionLog(maintenance.registry);
    await render(<ClockProvider clock={maintenance.clock}><MessageHostProvider><TodayContent registry={maintenance.registry} /></MessageHostProvider></ClockProvider>);
    await act(async () => {});
    expect(screen.getByText(/· Haltemodus$/)).toBeOnTheScreen();
  });

  test('zeigt höchstens einen neutralen Hinweis mit Symbol und Text; „Zielgewicht erreicht“ geht vor', async () => {
    const suggestionId = EntityId.parse('7d2c9e41-3b5a-4f8e-9c1d-2a6b8e0f4c11');
    const shown = { goalWeightReached: false };
    const { database } = await renderToday({
      notices: {
        goalWeightReached: () => (shown.goalWeightReached ? { type: 'goal_weight_reached', action: { actionId: 'plan.open_goal_reached', target: { type: 'plan.goal_reached' } } } : null),
        budgetSuggestion: () => ({
          type: 'budget_suggestion',
          suggestionId: suggestionId,
          suggestedBudgetKcal: 1470,
          action: { actionId: 'plan.open_budget_suggestion', target: { type: 'plan.budget_suggestion', suggestionId: suggestionId } },
        }),
      },
    });

    expect(screen.getByText('Vorschlag für dein Kalorienbudget: 1.470 kcal')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-info', { includeHiddenElements: true })).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Ansehen' }));
    expect(openTarget).toHaveBeenLastCalledWith({ type: 'plan.budget_suggestion', suggestionId: suggestionId });

    shown.goalWeightReached = true;
    await act(async () => database.transaction(() => {}));
    expect(screen.getByText('Zielgewicht erreicht')).toBeOnTheScreen();
    expect(screen.queryByText(/Vorschlag für dein Kalorienbudget/)).not.toBeOnTheScreen();
    expect(screen.getByTestId('icon-flag', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('icon-alert', { includeHiddenElements: true })).not.toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Ansehen' }));
    expect(openTarget).toHaveBeenLastCalledWith({ type: 'plan.goal_reached' });
  });
});

test('veraltete Daten beider Beiträge zeigen ihren Stand', async () => {
  const registry = createTodayRegistry();
  const dataAsOf = Instant.parse('2026-10-14T08:30:00.000Z');
  registry.register('ziele', 'momo.daily_goals', { subscribe(listener) {
    listener({ type: 'stale', data: contractFixtures.today!.MomoDailyGoalsReady!.valid['drei Plätze'], dataAsOf } as TodayState<'momo.daily_goals'>);
    return () => {};
  } });
  registry.register('ziele', 'nutrition.budget', { subscribe(listener) {
    listener({ type: 'stale', data: contractFixtures.today!.NutritionBudgetReady!.valid['Zielgewicht erreicht'], dataAsOf } as TodayState<'nutrition.budget'>);
    return () => {};
  } });
  withNutritionLog(registry);
  const world = await createWorld();
  await render(<ClockProvider clock={world.clock}><MessageHostProvider><TodayContent registry={registry} /></MessageHostProvider></ClockProvider>);

  expect(screen.getAllByText('Stand: 14.10.2026 · 08:30 UTC')).toHaveLength(2);
  expect(screen.getAllByText('Wasserziel · 0,8 von 1,5 l')).toHaveLength(3);
  expect(screen.getByText('Zielgewicht erreicht')).toBeOnTheScreen();
});

test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp', async () => {
  await renderToday({
    notices: {
      goalWeightReached: () => ({ type: 'goal_weight_reached', action: { actionId: 'plan.open_goal_reached', target: { type: 'plan.goal_reached' } } }),
      budgetSuggestion: () => null,
    },
  });

  for (const name of ['Ernährung erfasst · 0 von 2 Mahlzeiten, offen. Öffnen', 'Wasserziel · 0,0 von 1,5 l, offen. Öffnen', 'Im Kalorienbudget · am Tagesende. Öffnen', 'Ansehen']) {
    const area = hitArea(screen.getByRole('button', { name }));
    expect({ name, height: area.height >= 48, width: area.width >= 48 }).toEqual({ name, height: true, width: true });
  }
});

describe('Schriftfaktor 2,0', () => {
  withDeviceConfig('schriftfaktor-2');

  test('Tagesziele, Budget und Hinweis bleiben vollständig lesbar und bedienbar', async () => {
    await renderToday({
      notices: {
        goalWeightReached: () => ({ type: 'goal_weight_reached', action: { actionId: 'plan.open_goal_reached', target: { type: 'plan.goal_reached' } } }),
        budgetSuggestion: () => null,
      },
    });

    for (const text of ['Ernährung erfasst · 0 von 2 Mahlzeiten', 'Wasserziel · 0,0 von 1,5 l', 'Im Kalorienbudget · am Tagesende', 'Zielgewicht erreicht']) {
      const node = screen.getByText(text);
      expect(node).toBeOnTheScreen();
      // Kein Abschneiden: Die Zeilen dürfen umbrechen.
      expect(node.props.numberOfLines).toBeUndefined();
    }
    await user.press(screen.getByRole('button', { name: 'Wasserziel · 0,0 von 1,5 l, offen. Öffnen' }));
    expect(openTarget).toHaveBeenLastCalledWith({ type: 'capture.water' });
  });
});
