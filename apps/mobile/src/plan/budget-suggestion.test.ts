/** @jest-environment node */
import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { Instant, LocalDate, localDateAfter, localDaysBetween } from '@abnehm/contracts/base';
import { budgetSuggestionId, goalVersionId, type BudgetSuggestionUpsert } from '@abnehm/contracts/plan';
import type { DailyIntakeSeries, WeightTrendSeries } from '@abnehm/contracts/ports';

import { fakeIntakeReader, fakeWeightTrendReader } from '../area-ports/testing/fakes';
import { budgetSuggestion } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { TodayState } from '../shell/today-registry';
import { pendingOperations } from '../sync/outbox';
import type { BudgetSuggestionCheck, BudgetSuggestionReaders, GoalDraft, NoBudgetSuggestionReason } from '.';
import { writeBudgetSuggestion } from './budget-suggestion-repository';
import { readGoalVersionOn, writeGoalVersion } from './plan-repository';
import { berlin, createPlanTodayWorld, philipp, type PlanTodayWorld } from './testing/today-world';

// Nachweis für #150: die Prüfung des Budgetvorschlags und sein Hinweis auf „Heute“ (Spezifikation 1,
// Abschnitte 6 und 7) am Plan-Modul. Plan-Modul und Persistenzdienst laufen echt über einer SQLite-Datei mit
// den Migrationen der App und der Testuhr. Gewichtstrend und Tagesaufnahme liefern die Fixture-Adapter der
// Ports aus #104 (`fakeWeightTrendReader`, `fakeIntakeReader`).
//
// Philipp (Referenzfall der Recherche, aber mäßig aktiv) speichert den Erstplan am Mittwoch, 16.09.2026:
// Grundumsatz 1.514 kcal, Gesamtumsatz 2.422 kcal, Budget 1.920 kcal bei „entspannt“. Geprüft wird am
// Mittwoch, 14.10.2026; das Fenster reicht vom 23.09. bis gestern, 13.10., in den Abschnitten 23.–29.09.,
// 30.09.–06.10. und 07.–13.10.

const day = (value: string) => LocalDate.parse(value);
/** 12:00 in Berlin an einem Tag vor dem Ende der Sommerzeit (UTC+2). */
const noonOn = (localDate: string) => Instant.parse(`${localDate}T10:00:00.000Z`);
const today = '2026-10-14';
const window = { periodFrom: '2026-09-23', periodTo: '2026-10-13' } as const;

/** Je Abschnitt genau zwei Tagesgewichte; vom ersten bis zum letzten liegen genau 14 Tage. */
const weighDays = ['2026-09-26', '2026-09-28', '2026-10-01', '2026-10-04', '2026-10-08', '2026-10-10'] as const;

/**
 * Gewichtsreihe des `WeightTrendReader`: der Trend fällt vom ersten bis zum letzten Tagesgewicht gleichmäßig
 * um `lossG` (negativ: steigt). Über genau 14 Tage ist der Trendverlust je Woche `lossG ÷ 2`.
 */
function trend(lossG: number, days: readonly string[] = weighDays): WeightTrendSeries {
  const offset = (value: string) => localDaysBetween(day(days[0]!), day(value));
  return days.map((localDate) => {
    const trendG = 80_000 - Math.round((lossG * offset(localDate)) / offset(days.at(-1)!));
    return { localDate: day(localDate), dayWeightG: trendG, trendG };
  });
}

type IntakeDay = Omit<DailyIntakeSeries[number], 'localDate'>;

/** Tagesaufnahme: je Tag kcal und erfasste Mahlzeitenkategorien; übrige Tage ohne Einträge. */
function intake(days: Readonly<Record<string, readonly [kcal: number, categories: number]>>): Record<string, IntakeDay> {
  return Object.fromEntries(Object.entries(days).map(([localDate, [kcal, categories]]) => [localDate, { intakeMilliKcal: kcal * 1_000, recordedMealCategories: categories }]));
}

/** `count` Tage ab dem 01.10. mit derselben Aufnahme und zwei Mahlzeitenkategorien. */
function sameDays(count: number, kcal: number, start = '2026-10-01'): Record<string, readonly [number, number]> {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => [localDateAfter(day(start), index), [kcal, 2] as const]));
}

/** Zehn erfasste Tage unter dem Budget von 1.920 kcal: Senken scheitert nie an der Aufnahme. */
const disciplined = intake(sameDays(10, 1_700));

function readers(lossG: number, days: Record<string, IntakeDay> = disciplined, weights: readonly string[] = weighDays): BudgetSuggestionReaders {
  return {
    weightTrendReader: fakeWeightTrendReader({ series: { [philipp]: trend(lossG, weights) } }),
    intakeReader: fakeIntakeReader({ [philipp]: days }),
  };
}

/** Deutlich unter 0,5 × Soll: Senken, sofern die Aufnahme passt. */
const stalled = 0;
/** Deutlich über 1,5 × Soll (entspannt: 0,75 kg/Woche über zwei Wochen = 1,5 kg). */
const rapid = 2_000;

const worlds: PlanTodayWorld[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const world of worlds.splice(0)) world.close();
});

type Setup = Readonly<{ start?: string; plan?: Parameters<PlanTodayWorld['saveInitialPlan']>[0]; person?: boolean }>;

/** Erstplan am Tag `start`, danach steht die Uhr auf heute, Mittwoch, 14.10. */
async function setup({ start = '2026-09-16', plan = {}, person = true }: Setup = {}) {
  const clock: TestClock = createTestClock({ instant: noonOn(start), timeZone: berlin });
  const world = await createPlanTodayWorld(clock, { person });
  worlds.push(world);
  if (person) await world.saveInitialPlan({ activityLevel: 'maessig_aktiv', waterTargetMl: 1_500, ...plan });
  const budget: TodayState<'nutrition.budget'>[] = [];
  stops.push(world.registry.subscribe('nutrition.budget', (state) => budget.push(state)));
  clock.set(noonOn(today));
  world.refresh();
  return {
    ...world,
    clock,
    /** Ändert die Ziele an einem früheren Tag; die Fassung gilt ab dem Folgetag. Danach steht die Uhr wieder auf jetzt. */
    changeGoalsOn(localDate: string, changes: Partial<GoalDraft>) {
      const now = clock.read().instant;
      clock.set(noonOn(localDate));
      const goal = world.database.read((tx) => readGoalVersionOn(tx, philipp, day(localDate)))!.values;
      const result = world.plan.changeGoals({
        calculationSex: 'weiblich',
        birthDate: day('1991-03-02'),
        heightCm: goal.heightCm,
        weightG: goal.weightG,
        activityLevel: goal.activityLevel,
        pregnantOrBreastfeeding: false,
        knownEatingDisorder: false,
        goalWeightG: goal.goalWeightG,
        pace: goal.pace,
        manualBudgetKcal: null,
        waterTargetMl: goal.waterTargetMl,
        weeklySportTargetMinutes: goal.weeklySportTargetMinutes,
        ...changes,
      });
      clock.set(now);
      if (result.type !== 'gespeichert') throw new Error(`Ziele nicht geändert: ${result.type}`);
    },
    /** Überschreibt das Budget der Fassung aus dem Erstplan, wie es ein angenommener Vorschlag tun kann (#151). */
    setBudget(milliKcal: number) {
      world.database.transaction((tx) => {
        const { values } = readGoalVersionOn(tx, philipp, day(start))!;
        writeGoalVersion(tx, goalVersionId(philipp, day(start)), philipp, { ...values, calorieBudgetMilliKcal: milliKcal, budgetSource: 'budgetvorschlag' }, noonOn(start));
      });
    },
    /** Ein Vorschlag aus einem früheren Zeitraum, entschieden oder überholt zum Zeitpunkt `at`. */
    pastSuggestion(status: BudgetSuggestionUpsert['status'], at: string) {
      world.database.transaction((tx) =>
        writeBudgetSuggestion(tx, budgetSuggestionId(philipp, day('2026-09-15')), philipp, {
          periodFrom: day('2026-08-26'),
          periodTo: day('2026-09-15'),
          previousBudgetMilliKcal: 1_920_000,
          suggestedBudgetMilliKcal: 1_770_000,
          direction: 'senken',
          status,
        }, Instant.parse(at)),
      );
    },
    suggestions: () => world.database.read((tx) => sqliteOf(tx).select().from(budgetSuggestion).all()),
    upserts: () =>
      world.database.read((tx) => pendingOperations(tx, 100)).filter((operation) => operation.type === 'upsert_entity' && operation.entityType === 'budget_suggestion'),
    notice() {
      world.refresh();
      const state = budget.at(-1);
      return state?.type === 'ready' ? state.data.notice : `kein ready: ${state?.type}`;
    },
  };
}

const none = (reason: NoBudgetSuggestionReason): BudgetSuggestionCheck => ({ type: 'kein_vorschlag', reason });
const id = budgetSuggestionId(philipp, day(window.periodTo));

describe('Budgetvorschlag: Senken', () => {
  it('legt bei stagnierendem Trend und Aufnahme im Budget einen offenen Vorschlag um 150 kcal weniger an, samt Upsert', async () => {
    const world = await setup();

    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toEqual({
      type: 'vorgeschlagen',
      suggestionId: id,
      direction: 'senken',
      previousBudgetMilliKcal: 1_920_000,
      suggestedBudgetMilliKcal: 1_770_000,
    });
    const payload = { ...window, previousBudgetMilliKcal: 1_920_000, suggestedBudgetMilliKcal: 1_770_000, direction: 'senken', status: 'offen' };
    expect(world.suggestions()).toEqual([
      { id, personId: philipp, ...payload, createdAt: noonOn(today), updatedAt: noonOn(today), deletedAt: null, serverVersion: null },
    ]);
    expect(world.upserts()).toEqual([
      expect.objectContaining({ type: 'upsert_entity', entityType: 'budget_suggestion', entityId: id, payload, knownServerVersion: null }),
    ]);
  });

  it('zeigt den offenen Vorschlag als neutralen Hinweis der Ernährungskarte mit vorgeschlagenem Budget und Aktion zum Sheet', async () => {
    const world = await setup();
    expect(world.notice()).toBeUndefined();

    await world.plan.checkBudgetSuggestion(readers(stalled));

    expect(world.notice()).toEqual({
      type: 'budget_suggestion',
      suggestionId: id,
      suggestedBudgetKcal: 1_770,
      action: { actionId: 'plan.open_budget_suggestion', target: { type: 'plan.budget_suggestion', suggestionId: id } },
    });
  });

  it.each([
    ['knapp unter 0,5 × Soll', 499, 'vorgeschlagen'],
    ['genau auf 0,5 × Soll', 500, 'kein_vorschlag'],
    ['über 0,5 × Soll', 501, 'kein_vorschlag'],
    ['bei Zunahme', -300, 'vorgeschlagen'],
  ] as const)('Trendverlust %s (entspannt, 0,25 kg/Woche): %s', async (_case, lossG, expected) => {
    const world = await setup();
    const check = await world.plan.checkBudgetSuggestion(readers(lossG));
    expect(check.type).toBe(expected);
    if (check.type === 'kein_vorschlag') expect(check.reason).toBe('im_tempo');
  });

  it('misst bei „zügiger“ am Soll von 0,75 kg/Woche', async () => {
    const world = await setup({ plan: { pace: 'zuegiger' } });
    // Budget 2.422 − 750 = 1.672 kcal, auf 1.670 gerundet; 0,5 × Soll über zwei Wochen sind 750 g.
    await expect(world.plan.checkBudgetSuggestion(readers(749, intake(sameDays(10, 1_600))))).resolves.toMatchObject({
      type: 'vorgeschlagen',
      direction: 'senken',
      previousBudgetMilliKcal: 1_670_000,
      suggestedBudgetMilliKcal: 1_520_000,
    });

    const exact = await setup({ plan: { pace: 'zuegiger' } });
    await expect(exact.plan.checkBudgetSuggestion(readers(750, intake(sameDays(10, 1_600))))).resolves.toEqual(none('im_tempo'));
  });

  it.each([
    ['9 erfasste Tage', intake(sameDays(9, 1_700)), none('zu_wenige_erfasste_tage')],
    ['10 erfasste Tage', intake(sameDays(10, 1_700)), { type: 'vorgeschlagen' }],
    ['11 erfasste Tage', intake(sameDays(11, 1_700)), { type: 'vorgeschlagen' }],
    ['10 Tage, einer davon mit nur einer Mahlzeitenkategorie', intake({ ...sameDays(10, 1_700), '2026-10-10': [1_700, 1] }), none('zu_wenige_erfasste_tage')],
    ['7 von 10 Tagen im Budget (70 %)', intake({ ...sameDays(7, 1_700), ...sameDays(3, 2_100, '2026-10-08') }), { type: 'vorgeschlagen' }],
    ['6 von 10 Tagen im Budget', intake({ ...sameDays(6, 1_700), ...sameDays(4, 2_100, '2026-10-07') }), none('zu_selten_im_budget')],
    ['7 von 10 Tagen genau auf dem Budget', intake({ ...sameDays(7, 1_920), ...sameDays(3, 1_921, '2026-10-08') }), { type: 'vorgeschlagen' }],
  ] as const)('Aufnahme laut IntakeReader: %s', async (_case, days, expected) => {
    const world = await setup();
    await expect(world.plan.checkBudgetSuggestion(readers(stalled, days))).resolves.toMatchObject(expected);
  });

  it('vergleicht jeden Tag mit dem an diesem Tag gültigen Budget', async () => {
    // 1.920 kcal bis 29.09., danach 1.990 kcal. 1.950 kcal liegen erst ab dem 30.09. im Budget.
    const days = intake({ ...sameDays(4, 1_950, '2026-09-23'), ...sameDays(6, 1_950, '2026-10-01') });
    const changed = await setup();
    changed.changeGoalsOn('2026-09-29', { manualBudgetKcal: 1_990 });
    await expect(changed.plan.checkBudgetSuggestion(readers(stalled, days))).resolves.toEqual(none('zu_selten_im_budget'));

    const later = intake({ ...sameDays(3, 1_950, '2026-09-23'), ...sameDays(7, 1_950, '2026-10-01') });
    const enough = await setup();
    enough.changeGoalsOn('2026-09-29', { manualBudgetKcal: 1_990 });
    await expect(enough.plan.checkBudgetSuggestion(readers(stalled, later))).resolves.toMatchObject({ type: 'vorgeschlagen', previousBudgetMilliKcal: 1_990_000 });
  });

  it('begrenzt den Vorschlag auf die Untergrenze und schlägt an der Untergrenze nichts vor', async () => {
    // Wenig aktiv: Budget 1.620 kcal, Untergrenze 1.514 kcal.
    const near = await setup({ plan: { activityLevel: 'wenig_aktiv' } });
    await expect(near.plan.checkBudgetSuggestion(readers(stalled, intake(sameDays(10, 1_500))))).resolves.toMatchObject({
      type: 'vorgeschlagen',
      previousBudgetMilliKcal: 1_620_000,
      suggestedBudgetMilliKcal: 1_514_000,
    });

    const at = await setup({ plan: { activityLevel: 'wenig_aktiv' } });
    at.setBudget(1_514_000);
    await expect(at.plan.checkBudgetSuggestion(readers(stalled, intake(sameDays(10, 1_500))))).resolves.toEqual(none('an_untergrenze'));
    expect(at.suggestions()).toEqual([]);
  });
});

describe('Budgetvorschlag: Anheben', () => {
  it.each([
    ['knapp unter 1,5 × Soll', 1_499, 'kein_vorschlag'],
    ['genau auf 1,5 × Soll', 1_500, 'kein_vorschlag'],
    ['knapp über 1,5 × Soll', 1_501, 'vorgeschlagen'],
  ] as const)('Trendverlust %s (entspannt, 0,75 kg/Woche): %s', async (_case, lossG, expected) => {
    const world = await setup();
    const check = await world.plan.checkBudgetSuggestion(readers(lossG));
    expect(check.type).toBe(expected);
    if (check.type === 'kein_vorschlag') expect(check.reason).toBe('im_tempo');
  });

  it('legt einen Vorschlag um 150 kcal mehr an und braucht dafür keine erfassten Tage', async () => {
    const world = await setup();

    await expect(world.plan.checkBudgetSuggestion(readers(rapid, {}))).resolves.toEqual({
      type: 'vorgeschlagen',
      suggestionId: id,
      direction: 'anheben',
      previousBudgetMilliKcal: 1_920_000,
      suggestedBudgetMilliKcal: 2_070_000,
    });
    expect(world.suggestions()).toEqual([expect.objectContaining({ direction: 'anheben', status: 'offen', suggestedBudgetMilliKcal: 2_070_000 })]);
  });

  it('begrenzt den Vorschlag auf den Gesamtumsatz und schlägt am Gesamtumsatz nichts vor', async () => {
    const near = await setup();
    near.changeGoalsOn('2026-09-20', { manualBudgetKcal: 2_350 });
    await expect(near.plan.checkBudgetSuggestion(readers(rapid))).resolves.toMatchObject({
      type: 'vorgeschlagen',
      previousBudgetMilliKcal: 2_350_000,
      suggestedBudgetMilliKcal: 2_422_000,
    });

    const at = await setup();
    at.setBudget(2_422_000);
    await expect(at.plan.checkBudgetSuggestion(readers(rapid))).resolves.toEqual(none('am_gesamtumsatz'));
  });
});

describe('Budgetvorschlag: Voraussetzungen', () => {
  it.each([
    ['genau 2 Tagesgewichte je Abschnitt', weighDays, { type: 'vorgeschlagen' }],
    ['3 Tagesgewichte im zweiten Abschnitt', [...weighDays.slice(0, 3), '2026-10-02', ...weighDays.slice(3)], { type: 'vorgeschlagen' }],
    ['nur 1 Tagesgewicht im zweiten Abschnitt', weighDays.filter((value) => value !== '2026-10-04'), none('zu_wenige_tagesgewichte')],
    ['nur 1 Tagesgewicht im ersten Abschnitt, eines davor', ['2026-09-22', ...weighDays.slice(1)], none('zu_wenige_tagesgewichte')],
  ] as const)('%s', async (_case, weights, expected) => {
    const world = await setup();
    await expect(world.plan.checkBudgetSuggestion(readers(stalled, disciplined, weights))).resolves.toMatchObject(expected);
  });

  it.each([
    ['seit 21 Tagen', '2026-09-23', { type: 'vorgeschlagen' }],
    ['seit 20 Tagen', '2026-09-24', none('zielversion_zu_neu')],
  ] as const)('die erste Zielversion gilt %s', async (_case, start, expected) => {
    const world = await setup({ start });
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toMatchObject(expected);
  });

  it.each([
    ['seit 14 Tagen', '2026-09-29', { type: 'vorgeschlagen' }],
    ['seit 13 Tagen', '2026-09-30', none('budget_zu_neu')],
  ] as const)('das aktuelle Kalorienbudget gilt %s', async (_case, changedOn, expected) => {
    const world = await setup();
    world.changeGoalsOn(changedOn, { manualBudgetKcal: 1_900 });
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toMatchObject(expected);
  });

  it('eine Zielversion mit demselben Budget setzt die 14-Tage-Sperre nicht zurück', async () => {
    const world = await setup();
    world.changeGoalsOn('2026-10-10', { waterTargetMl: 2_000 });
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toMatchObject({ type: 'vorgeschlagen', previousBudgetMilliKcal: 1_920_000 });
  });

  it.each([
    ['vor 14 Tagen abgelehnt', 'abgelehnt', '2026-09-30T21:30:00.000Z', { type: 'vorgeschlagen' }],
    ['vor 13 Tagen abgelehnt (00:30 in Berlin)', 'abgelehnt', '2026-09-30T22:30:00.000Z', none('entscheidung_zu_neu')],
    ['vor 13 Tagen angenommen', 'angenommen', '2026-10-01T10:00:00.000Z', none('entscheidung_zu_neu')],
    ['gestern überholt, ohne Entscheidung', 'ueberholt', '2026-10-13T10:00:00.000Z', { type: 'vorgeschlagen' }],
  ] as const)('der letzte Vorschlag wurde %s', async (_case, status, at, expected) => {
    const world = await setup();
    world.pastSuggestion(status, at);
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toMatchObject(expected);
  });

  it.each([
    ['gewählten Haltemodus', { pace: null, goalWeightG: null }],
    ['erzwungenen Haltemodus', { knownEatingDisorder: true }],
  ] as const)('schlägt im %s nichts vor, auch bei deutlicher Abweichung', async (_case, plan) => {
    const world = await setup({ plan });
    await expect(world.plan.checkBudgetSuggestion(readers(rapid))).resolves.toEqual(none('haltemodus'));
    expect(world.suggestions()).toEqual([]);
  });

  it('prüft ohne Zielversion nicht weiter und tut ohne eigene Person nichts', async () => {
    const withoutPerson = await setup({ person: false });
    await expect(withoutPerson.plan.checkBudgetSuggestion(readers(stalled))).resolves.toEqual(none('ohne_person'));

    const clock = createTestClock({ instant: noonOn(today), timeZone: berlin });
    const withoutPlan = await createPlanTodayWorld(clock);
    worlds.push(withoutPlan);
    await expect(withoutPlan.plan.checkBudgetSuggestion(readers(stalled))).resolves.toEqual(none('ohne_zielversion'));
  });

  it('legt neben einem offenen Vorschlag keinen weiteren an', async () => {
    const world = await setup();
    await world.plan.checkBudgetSuggestion(readers(stalled));

    world.clock.set(noonOn('2026-10-15'));
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toEqual(none('offener_vorschlag'));
    expect(world.suggestions()).toHaveLength(1);
  });
});

describe('Budgetvorschlag: höchstens eine Prüfung je lokalem Tag', () => {
  it('prüft am selben Tag nicht noch einmal, auch wenn die Daten inzwischen reichen; am nächsten Tag wieder', async () => {
    const world = await setup();
    const thin = readers(stalled, disciplined, weighDays.slice(1));

    await expect(world.plan.checkBudgetSuggestion(thin)).resolves.toEqual(none('zu_wenige_tagesgewichte'));
    world.clock.set(Instant.parse('2026-10-14T21:59:00.000Z'));
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toEqual({ type: 'bereits_geprueft' });
    expect(world.suggestions()).toEqual([]);

    world.clock.set(Instant.parse('2026-10-14T22:00:00.000Z'));
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toMatchObject({
      type: 'vorgeschlagen',
      suggestionId: budgetSuggestionId(philipp, day('2026-10-14')),
    });
  });

  it('zählt auch eine Prüfung, die an einer Voraussetzung scheitert', async () => {
    const world = await setup({ start: '2026-09-24' });
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toEqual(none('zielversion_zu_neu'));
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toEqual({ type: 'bereits_geprueft' });
  });

  it('lässt gleichzeitige Auslöser (App-Start und Vordergrund) genau eine Prüfung ausführen', async () => {
    const world = await setup();
    const [first, second] = await Promise.all([world.plan.checkBudgetSuggestion(readers(stalled)), world.plan.checkBudgetSuggestion(readers(stalled))]);
    expect(first).toMatchObject({ type: 'vorgeschlagen' });
    expect(second).toEqual(first);
    expect(world.upserts()).toHaveLength(1);
  });

  it('zählt eine Prüfung nicht, deren Port scheitert', async () => {
    const world = await setup();
    const failing: BudgetSuggestionReaders = { ...readers(stalled), weightTrendReader: { series: async () => Promise.reject(new Error('Port defekt')) } };
    await expect(world.plan.checkBudgetSuggestion(failing)).rejects.toThrow('Port defekt');
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toMatchObject({ type: 'vorgeschlagen' });
  });
});

describe('Budgetvorschlag: überholt', () => {
  it('jede andere neue Zielversion setzt den offenen Vorschlag in derselben Transaktion auf ueberholt, samt Upsert; der Hinweis verschwindet', async () => {
    const world = await setup();
    await world.plan.checkBudgetSuggestion(readers(stalled));
    world.clock.set(Instant.parse('2026-10-14T15:00:00.000Z'));

    const before = world.database.read((tx) => pendingOperations(tx, 100)).length;
    world.changeGoalsOn(today, { waterTargetMl: 2_000 });

    expect(world.suggestions()).toEqual([expect.objectContaining({ id, status: 'ueberholt', updatedAt: noonOn(today), suggestedBudgetMilliKcal: 1_770_000 })]);
    const operations = world.database.read((tx) => pendingOperations(tx, 100)).slice(before);
    // Zielversion und Statuswechsel entstehen zusammen, in der Reihenfolge der Transaktion.
    expect(operations.map((operation) => ('entityType' in operation ? operation.entityType : operation.type))).toEqual(['budget_suggestion', 'createGoalVersion']);
    expect(world.upserts().at(-1)).toMatchObject({ entityId: id, payload: { status: 'ueberholt' } });
    expect(world.notice()).toBeUndefined();
  });

  it('eine Änderung ohne neue Fassung lässt den Vorschlag offen', async () => {
    const world = await setup();
    await world.plan.checkBudgetSuggestion(readers(stalled));
    const goal = world.database.read((tx) => readGoalVersionOn(tx, philipp, day(today)))!.values;

    expect(world.plan.changeGoals({
      calculationSex: 'weiblich', birthDate: day('1991-03-02'), heightCm: goal.heightCm, weightG: goal.weightG, activityLevel: goal.activityLevel,
      pregnantOrBreastfeeding: false, knownEatingDisorder: false, goalWeightG: goal.goalWeightG, pace: goal.pace, manualBudgetKcal: null,
      waterTargetMl: goal.waterTargetMl, weeklySportTargetMinutes: goal.weeklySportTargetMinutes,
    })).toMatchObject({ type: 'unveraendert' });
    expect(world.suggestions()).toEqual([expect.objectContaining({ status: 'offen' })]);
    expect(world.notice()).toMatchObject({ type: 'budget_suggestion', suggestionId: id });
  });

  it('nach dem Überholen entsteht am selben Tag kein neuer Vorschlag, und der überholte zählt nicht als Entscheidung', async () => {
    const world = await setup();
    await world.plan.checkBudgetSuggestion(readers(stalled));
    world.changeGoalsOn(today, { waterTargetMl: 2_000 });
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toEqual({ type: 'bereits_geprueft' });

    world.clock.set(noonOn('2026-10-15'));
    await expect(world.plan.checkBudgetSuggestion(readers(stalled))).resolves.toMatchObject({ type: 'vorgeschlagen', suggestionId: budgetSuggestionId(philipp, day('2026-10-14')) });
  });
});
