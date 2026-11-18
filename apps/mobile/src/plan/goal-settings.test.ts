/** @jest-environment node */
import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { LocalDate } from '@abnehm/contracts/base';
import { goalVersionId } from '@abnehm/contracts/plan';
import type { LatestWeight } from '@abnehm/contracts/ports';

import { fakeWeightTrendReader } from '../area-ports/testing/fakes';
import type { GoalSettings, GoalSettingsState } from '.';
import { writeGoalVersion } from './plan-repository';
import { berlin, createPlanTodayWorld, draft, philipp, wednesdayNoon, type PlanTodayWorld } from './testing/today-world';

// Nachweis für #147: das Lesemodell der Einstellungsseite „Ziele“ (Spezifikation 1, Abschnitt 10) am
// echten Plan-Modul über einer SQLite-Datei mit den Migrationen der App, gesteuert über die Testuhr in
// Berlin (Mittwoch, 14.10.2026, 12:00). Das Basisgewicht der Prognose liefert der Fixture-Adapter des
// `WeightTrendReader` aus #104.

let world: PlanTodayWorld;
let clock: TestClock;

afterEach(() => world.close());

/** Der Referenzfall (Frau, 35, 168 cm, 80 kg, wenig aktiv, entspannt, Ziel 76 kg) hat dieses Gewicht. */
const trendOf = (trendG: number, lastDayWeightG = trendG): Record<string, LatestWeight> => ({
  [philipp]: { lastDayWeight: { localDate: LocalDate.parse('2026-10-13'), dayWeightG: lastDayWeightG }, dayWeightCount: 3, trend: { type: 'verfuegbar', trendG } },
});

async function setup(latest: Record<string, LatestWeight> = {}) {
  clock = createTestClock({ instant: wednesdayNoon, timeZone: berlin });
  world = await createPlanTodayWorld(clock);
  const states: GoalSettingsState[] = [];
  const updates = new Set<() => void>();
  const stop = world.plan
    .goalSettings(fakeWeightTrendReader({ latest }), (update) => {
      updates.add(update);
      return () => updates.delete(update);
    })
    .subscribe((state) => states.push(state));
  const settled = async () => {
    // Die Prognose wartet auf den `WeightTrendReader`; danach steht der jüngste Zustand fest.
    await new Promise((resolve) => setImmediate(resolve));
    const last = states.at(-1);
    if (last?.type !== 'ready') throw new Error(`Einstellungen nicht bereit: ${last?.type}`);
    return last.settings;
  };
  const refresh = () => {
    for (const update of updates) update();
  };
  return { states, settled, refresh, stop };
}

describe('Lesemodell „Ziele“', () => {
  it('ohne Plan: keine Fassung und kein Ausgangsentwurf', async () => {
    const { settled } = await setup();

    expect(await settled()).toMatchObject({ today: '2026-10-14', current: null, upcoming: null, draft: null });
  });

  it('zeigt die heute gültige Fassung samt Herleitung, Prognose und Ausgangsentwurf der Bearbeitung', async () => {
    const { settled } = await setup();
    await world.saveInitialPlan();

    const settings = await settled();
    expect(settings.current).toEqual({
      values: expect.objectContaining({
        validFrom: '2026-10-14',
        calorieBudgetMilliKcal: 1_620_000,
        basalMetabolicRateMilliKcal: 1_514_000,
        totalEnergyExpenditureMilliKcal: 2_120_000,
        deficitMilliKcal: 500_000,
        activityLevel: 'wenig_aktiv',
        pace: 'entspannt',
        maintenanceReason: null,
        goalWeightG: 76_000,
        waterTargetMl: 1_500,
        weeklySportTargetMinutes: 150,
      }),
      activityFactor: 1.4,
      budgetRaisedToLowerBound: false,
      safetyTriggers: [],
      // Ohne Tagesgewicht ist das Basisgewicht das der Berechnung: 4 kg bei 0,5 kg pro Woche, also 8 Wochen.
      forecast: expect.objectContaining({ type: 'schaetzung', weeks: 8, year: 2026, month: 12 }),
    });
    expect(settings.upcoming).toBeNull();
    expect(settings.draft).toEqual({
      calculationSex: 'weiblich',
      birthDate: '1991-03-02',
      heightCm: 168,
      weightG: 80_000,
      activityLevel: 'wenig_aktiv',
      pregnantOrBreastfeeding: false,
      knownEatingDisorder: false,
      goalWeightG: 76_000,
      pace: 'entspannt',
      manualBudgetKcal: null,
      waterTargetMl: 1_500,
      weeklySportTargetMinutes: 150,
    });
  });

  it('rechnet die Prognose vom Gewichtstrend, sonst vom letzten Tagesgewicht', async () => {
    const { settled } = await setup(trendOf(79_000));
    await world.saveInitialPlan();

    // 3 kg bei 0,5 kg pro Woche: 6 Wochen ab heute, also Ende November 2026.
    expect((await settled()).current?.forecast).toMatchObject({ weeks: 6, year: 2026, month: 11 });
  });

  it('nimmt ohne Trend das letzte Tagesgewicht als Basis', async () => {
    const latest = { [philipp]: { lastDayWeight: { localDate: LocalDate.parse('2026-10-13'), dayWeightG: 78_000 }, dayWeightCount: 1, trend: { type: 'noch_nicht_verfuegbar' } } } as const;
    const { settled } = await setup(latest);
    await world.saveInitialPlan();

    expect((await settled()).current?.forecast).toMatchObject({ weeks: 4 });
  });

  it('zeigt eine Änderung als bevorstehende Fassung „ab morgen“ mit den geänderten Werten; sie ist der neue Ausgangsentwurf', async () => {
    const { settled } = await setup();
    await world.saveInitialPlan();

    world.plan.changeGoals({ ...draft, pace: 'zuegiger', waterTargetMl: 2_000, weeklySportTargetMinutes: 150 });

    const settings = await settled();
    expect(settings.current?.values).toMatchObject({ validFrom: '2026-10-14', waterTargetMl: 1_500, pace: 'entspannt' });
    expect(settings.upcoming?.view.values).toMatchObject({ validFrom: '2026-10-15', waterTargetMl: 2_000, pace: 'zuegiger', calorieBudgetMilliKcal: 1_520_000 });
    expect([...settings.upcoming!.changed].sort()).toEqual(['calorieBudgetMilliKcal', 'deficitMilliKcal', 'pace', 'waterTargetMl']);
    expect(settings.draft).toMatchObject({ pace: 'zuegiger', waterTargetMl: 2_000 });
  });

  it('meldet das angehobene Budget mit der Untergrenze', async () => {
    const { settled } = await setup();
    // Frau, 35, 155 cm, 60 kg, wenig aktiv, zügiger: Die Rechnung ergäbe weniger als den Grundumsatz.
    await world.saveInitialPlan({ heightCm: 155, weightG: 60_000, goalWeightG: 57_000, pace: 'zuegiger' });

    const { current } = await settled();
    expect(current?.budgetRaisedToLowerBound).toBe(true);
    expect(current?.values.calorieBudgetMilliKcal).toBe(1_240_000);
    expect(current?.values.lowerBoundMilliKcal).toBe(1_233_000);
  });

  it.each([
    ['Schwangerschaft oder Stillzeit', { pregnantOrBreastfeeding: true }, ['schwanger_oder_stillend']],
    ['bekannte Essstörung', { knownEatingDisorder: true }, ['essstoerung']],
    ['BMI unter 18,5', { weightG: 52_000, goalWeightG: 52_300 }, ['untergewicht']],
  ] as const)('erzwungener Haltemodus wegen %s: Grund ohne Tempo, Defizit und Prognose', async (_, changes, triggers) => {
    const { settled } = await setup();
    await world.saveInitialPlan({ ...changes, pace: 'entspannt' });

    const { current, draft: base } = await settled();
    expect(current).toMatchObject({ values: { maintenanceReason: 'sicherheits_check', pace: null, deficitMilliKcal: null }, safetyTriggers: triggers, forecast: null });
    expect(base?.pace).toBeNull();
  });

  it('Vorschau einer Änderung: gerechnet ab morgen, mit Prognose vom Basisgewicht', async () => {
    const { settled } = await setup(trendOf(79_000));
    await world.saveInitialPlan();

    const settings: GoalSettings = await settled();
    const check = settings.check({ ...settings.draft!, pace: 'zuegiger' }, { holding: false });

    // 3 kg bei 0,75 kg pro Woche: 4 Wochen ab morgen.
    expect(check.result).toMatchObject({ type: 'berechnet', pace: 'zuegiger', calorieBudget: { kcal: 1_520 }, forecast: { weeks: 4, year: 2026, month: 11 } });
    expect(check).toMatchObject({ valid: true, forced: false, paceMissing: false, goalWeightNotBelowCurrent: false, goalWeightProblem: null, manualBudgetInvalid: false });
    expect(settings.check({ ...settings.draft!, waterTargetMl: 400 }, { holding: false })).toMatchObject({
      result: { type: 'ungueltig', errors: ['water_target_out_of_range'] },
      valid: false,
    });
  });

  describe('Prüfung einer Änderung', () => {
    async function base(changes: Parameters<PlanTodayWorld['saveInitialPlan']>[0] = {}) {
      const { settled } = await setup();
      await world.saveInitialPlan(changes);
      return settled();
    }

    it('ein Zielgewicht unter BMI 18,5 nennt die Grenze, bleibt aber in der Referenzrechnung sichtbar', async () => {
      const settings = await base();
      const check = settings.check({ ...settings.draft!, goalWeightG: 50_000 }, { holding: false });

      expect(check).toMatchObject({ goalWeightProblem: 'below_limit', valid: false, reference: { goalWeight: { range: { min: 52_300 } } } });
    });

    it('ein eigenes Budget außerhalb von Untergrenze und Gesamtumsatz ist ungültig, die Grenzen stehen in der Referenz', async () => {
      const settings = await base();
      const check = settings.check({ ...settings.draft!, manualBudgetKcal: 2_500 }, { holding: false });

      expect(check).toMatchObject({ manualBudgetInvalid: true, valid: false, reference: { manualBudgetRange: { min: 1_520, max: 2_120 } } });
    });

    it('den Haltemodus beenden verlangt ein Tempo und ein Zielgewicht unter dem Gewicht', async () => {
      const settings = await base({ pace: null, goalWeightG: 80_000 });

      expect(settings.check(settings.draft!, { holding: false })).toMatchObject({ paceMissing: true, valid: false });
      expect(settings.check({ ...settings.draft!, pace: 'entspannt' }, { holding: false })).toMatchObject({ goalWeightNotBelowCurrent: true, valid: false });
      expect(settings.check({ ...settings.draft!, pace: 'entspannt', goalWeightG: 76_000 }, { holding: false })).toMatchObject({ valid: true });
      expect(settings.check(settings.draft!, { holding: true })).toMatchObject({ paceMissing: false, goalWeightNotBelowCurrent: false, valid: true });
    });

    it('im erzwungenen Haltemodus braucht es kein Tempo', async () => {
      const settings = await base({ knownEatingDisorder: true });

      expect(settings.check(settings.draft!, { holding: false })).toMatchObject({ forced: true, paceMissing: false, valid: true, reference: { safetyTriggers: ['essstoerung'] } });
    });
  });

  it('ein Budget aus einem angenommenen Budgetvorschlag bleibt bei anderen Änderungen erhalten, auch außerhalb des Rasters', async () => {
    const { settled } = await setup();
    await world.saveInitialPlan();
    const { current } = await settled();
    // Wie `acceptBudgetSuggestion` (#151): eine Fassung ab morgen mit dem Budget des Vorschlags.
    const { validFrom: _validFrom, ...values } = current!.values;
    const tomorrow = LocalDate.parse('2026-10-15');
    world.database.transaction((tx) =>
      writeGoalVersion(tx, goalVersionId(philipp, tomorrow), philipp, { ...values, validFrom: tomorrow, calorieBudgetMilliKcal: 1_773_000, budgetSource: 'budgetvorschlag' }, wednesdayNoon),
    );

    const settings = await settled();
    expect(settings.suggestedBudgetKcal).toBe(1_773);
    expect(settings.draft?.manualBudgetKcal).toBe(1_773);
    const change = { ...settings.draft!, waterTargetMl: 2_000 };
    expect(settings.check(change, { holding: false })).toMatchObject({ valid: true, result: { calorieBudget: { kcal: 1_773 } } });
    expect(settings.check({ ...change, manualBudgetKcal: 1_774 }, { holding: false })).toMatchObject({ manualBudgetInvalid: true, valid: false });

    expect(world.plan.changeGoals(change)).toMatchObject({ type: 'gespeichert' });
    expect((await settled()).upcoming?.view.values).toMatchObject({ calorieBudgetMilliKcal: 1_773_000, budgetSource: 'budgetvorschlag', waterTargetMl: 2_000 });
  });

  it('folgt jeder Änderung der Kontodatenbank und dem Tageswechsel', async () => {
    const { settled, refresh } = await setup();
    await world.saveInitialPlan();
    world.plan.changeGoals({ ...draft, waterTargetMl: 2_000 });
    expect((await settled()).upcoming).not.toBeNull();

    clock.advanceBy(24 * 60 * 60 * 1_000);
    refresh();

    const settings = await settled();
    expect(settings).toMatchObject({ today: '2026-10-15', current: { values: { validFrom: '2026-10-15', waterTargetMl: 2_000 } }, upcoming: null });
  });

  it('meldet einen Fehler, wenn der `WeightTrendReader` scheitert', async () => {
    clock = createTestClock({ instant: wednesdayNoon, timeZone: berlin });
    world = await createPlanTodayWorld(clock);
    await world.saveInitialPlan();
    const states: GoalSettingsState[] = [];
    world.plan
      .goalSettings({ latest: () => Promise.reject(new Error('kaputt')) }, () => () => {})
      .subscribe((state) => states.push(state));
    await new Promise((resolve) => setImmediate(resolve));

    expect(states.at(-1)).toEqual({ type: 'error' });
  });

  it('lädt ohne eigene Person', async () => {
    clock = createTestClock({ instant: wednesdayNoon, timeZone: berlin });
    world = await createPlanTodayWorld(clock, { person: false });
    const states: GoalSettingsState[] = [];
    world.plan.goalSettings(fakeWeightTrendReader(), () => () => {}).subscribe((state) => states.push(state));

    expect(states).toEqual([{ type: 'loading' }]);
  });
});
