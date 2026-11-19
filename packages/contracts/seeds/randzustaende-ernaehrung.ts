import type { MealKey } from '../src/base.ts';
import { minimumMealCategoriesPerDay } from '../src/plan.ts';
import { changedOnServer, pulledBy, type SeedPart } from './build.ts';
import { seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import type { SeedManifest, SeedScenarioKey } from './manifest.ts';
import { evaluate, evaluatedOnDevice, randzustandManifest, randzustandPlan, stateOf, type Randzustand } from './randzustaende.ts';
import { seedCompletion, seedKiEntry } from './rows.ts';
import { philippThresholds, soloErnaehrung, soloFundament, soloTrackerOf, soloZieleOf, type SoloWeeklyPlan } from './solo.ts';

// Randzustände der Ernährung (Spezifikation 2, Abschnitt 13; #166). Sie ergänzen die Randzustände der
// Tagesziele (#113, `randzustaende.ts`) mit derselben Person, denselben IDs und derselben Uhr:
//
// - „Ernährung erfasst“ offen, teilweise und erfüllt;
// - „Im Kalorienbudget“ unter der Untergrenze, innerhalb und über dem Budget, jeweils vor und nach dem
//   Tagesende: Der Ausgangszustand liegt vor dem Tagesende (14:00 Uhr), der Schritt ist der
//   Tagesabschluss danach, und der Sollzustand zeigt, was er anlegt;
// - „Ernährung erfasst“ nach Erfüllung korrigiert.
//
// Erfüllungen und Gutschriften entstehen wie in `randzustaende.ts` erst in den Schritten über den echten
// Persistenzdienst der Tagesziele mit den echten Evaluatoren der Ernährung. Heute gibt es weder Wasser
// noch Sport, damit nur die Ernährung etwas erfüllen kann. Alle Werte sind erfunden.

const philipp = seedIds.person.philipp;
const iphone = seedInstallations.philippIphone.key;
const goals = seedIds.dailyGoal.philippHeute;

/**
 * Wochenplan der Ernährungs-Randzustände: wie in `randzustaende.ts`, aber heute (Mittwoch) „Ernährung
 * erfasst“ auf Platz 1. Die Schwelle ist die der Materialisierung (`minimumMealCategoriesPerDay`, 2).
 */
const ernaehrungPlan = {
  ...randzustandPlan,
  mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
} as const satisfies SoloWeeklyPlan;
const ernaehrungThresholds = { ...philippThresholds, ernaehrung_erfasst: { minimumMealCategories: minimumMealCategoriesPerDay } };

/** Philipp mit Zielen und Wochenplan, ohne Wasser und Sport von heute; die Mahlzeiten ergänzen die Szenarien. */
const ernaehrungBasis: readonly SeedPart[] = [soloFundament, soloZieleOf(ernaehrungPlan, 'tempo', ernaehrungThresholds), soloTrackerOf([])];
/** Wie `ernaehrungBasis`, heute aber mit „Im Kalorienbudget“ auf Platz 1 (`randzustandPlan`). */
const budgetBasis: readonly SeedPart[] = [soloFundament, soloZieleOf(randzustandPlan), soloTrackerOf([])];

/** Eine erfundene Mahlzeit von heute mit `kcalPer100g` bei 600 g bzw. `grams`. */
const meal = (id: string, mealKey: MealKey, at: string, name: string, kcalPer100g: number, grams = 600) =>
  seedKiEntry({
    id, personId: philipp, at, localDate: seedDays.heute, meal: mealKey, name, grams,
    per100g: { milliKcal: kcalPer100g * 1_000, proteinMg: 5_000, carbsMg: 20_000, fatMg: 4_000 },
  });

/** Mittagessen von heute um 11:00 UTC (13:00 Uhr): 400 g Linsensuppe, 440 kcal. */
const mittagessenAt = '2026-10-14T11:00:00.000Z';
const mittagessen: SeedPart = {
  area: 'ernaehrung',
  entities: [meal(seedIds.nutritionEntry.philippRandzustand.mittag, 'mittagessen', mittagessenAt, 'Linsensuppe', 110, 400)],
};

/** Erfüllung von „Ernährung erfasst“ (Platz 1) zu `at`. */
const mealsCompletion = (at: string) =>
  seedCompletion({ personId: philipp, dailyGoalId: goals[0], localDate: seedDays.heute, slot: 1, baustein: 'ernaehrung_erfasst', at });

/** Die App-Öffnung wertet heute aus und legt nichts an. */
const unchanged = (parts: readonly SeedPart[]): Randzustand => {
  const state = stateOf(parts);
  return { initial: state, steps: [evaluate('heute', 'app_oeffnung', [])], target: state };
};

/** Heute noch keine Mahlzeit: „Ernährung erfasst“ offen. */
const ernaehrungOffen = (): Randzustand => unchanged(ernaehrungBasis);

/** Heute nur das Frühstück aus `solo`: „Ernährung erfasst“ teilweise (1 von 2). */
const ernaehrungTeilweise = (): Randzustand => unchanged([...ernaehrungBasis, soloErnaehrung]);

/** Frühstück und Mittagessen: Die App-Öffnung erfüllt „Ernährung erfasst“ (2 von 2) und bucht `+1`. */
function ernaehrungErfuellt(): Randzustand {
  const initial = stateOf([...ernaehrungBasis, soloErnaehrung, mittagessen]);
  const operationIds = seedIds.operation.ernaehrungErfuellt;
  return {
    initial,
    steps: [evaluate('heute', 'app_oeffnung', operationIds)],
    target: evaluatedOnDevice(initial, mealsCompletion(seedClock.instant), operationIds),
  };
}

/** Ein anderes Gerät löscht das Mittagessen um 11:50 UTC. */
const korrekturAt = '2026-10-14T11:50:00.000Z';

/**
 * Wie `ernaehrung-erfuellt` nach dem Sync: Mit dem Mittagessen um 11:00 UTC ist „Ernährung erfasst“
 * erfüllt und gutgeschrieben. Danach hat Philipp das Mittagessen auf einem anderen Gerät gelöscht; der
 * Server kennt die Löschmarkierung, das iPhone noch nicht. Der Sync übernimmt sie, und der
 * Persistenzdienst wertet den Tag neu aus: „Ernährung erfasst“ ist wieder `teilweise` (1 von 2), die
 * Erfüllung bleibt, keine Gegenbuchung (Spezifikation 0, Abschnitte 3 und 4).
 */
function ernaehrungNachErfuellungKorrigiert(): Randzustand {
  const synced = stateOf([...ernaehrungBasis, soloErnaehrung, mittagessen, { area: 'fundament', entities: mealsCompletion(mittagessenAt) }]);
  const lunch = synced.server.nutrition_entry!.find((row) => row.id === seedIds.nutritionEntry.philippRandzustand.mittag)!;
  const initial = changedOnServer(synced, {
    createdAt: korrekturAt,
    changes: [{ table: 'nutrition_entry', entityType: 'nutrition_entry', ownerPersonId: philipp, row: { ...lunch, updated_at: korrekturAt, deleted_at: korrekturAt } }],
  });
  return { initial, steps: [{ type: 'sync', installation: iphone }], target: pulledBy(initial, iphone, philipp) };
}

/** Tagesabschluss eine halbe Stunde nach dem Ende von heute (`dayEndsAt` 22:00 UTC). */
const nachTagesende = '2026-10-14T22:30:00.000Z';
if (Date.parse(nachTagesende) <= Date.parse(seedDayEnds.heute)) throw new Error('Seed: Tagesabschluss vor dem Tagesende');

/**
 * Heute Frühstück (600 g Müsli, 900 kcal) und ein Mittagessen mit `lunchKcalPer100g` bei 600 g. Vor dem
 * Tagesende ist „Im Kalorienbudget“ `tagesende`; der Tagesabschluss danach entscheidet gegen Budget
 * (2417 kcal) und Untergrenze (1882 kcal).
 */
function kalorienbudget(lunchKcalPer100g: number, completes: boolean): Randzustand {
  const initial = stateOf([
    ...budgetBasis,
    {
      area: 'ernaehrung',
      entities: [
        meal(seedIds.nutritionEntry.philippRandzustand.fruehstueck, 'fruehstueck', '2026-10-14T06:30:00.000Z', 'Müsli mit Joghurt', 150),
        meal(seedIds.nutritionEntry.philippRandzustand.mittag, 'mittagessen', mittagessenAt, 'Nudeln mit Tomatensoße', lunchKcalPer100g),
      ],
    },
  ]);
  const operationIds = completes ? seedIds.operation.kalorienbudgetInnerhalb : [];
  const created = completes
    ? seedCompletion({ personId: philipp, dailyGoalId: goals[0], localDate: seedDays.heute, slot: 1, baustein: 'im_kalorienbudget', at: nachTagesende })
    : [];
  return {
    initial,
    steps: [evaluate('heute', 'tagesabschluss', operationIds, nachTagesende)],
    target: completes ? evaluatedOnDevice(initial, created, operationIds, nachTagesende) : initial,
  };
}

const ernaehrungRandzustaende = {
  'ernaehrung-offen': ernaehrungOffen,
  'ernaehrung-teilweise': ernaehrungTeilweise,
  'ernaehrung-erfuellt': ernaehrungErfuellt,
  'ernaehrung-nach-erfuellung-korrigiert': ernaehrungNachErfuellungKorrigiert,
  // 900 + 981 = 1881 kcal: eine kcal unter der Untergrenze.
  'kalorienbudget-unter-untergrenze': () => kalorienbudget(163.5, false),
  // 900 + 1110 = 2010 kcal: im Budget.
  'kalorienbudget-im-budget': () => kalorienbudget(185, true),
  // 900 + 1518 = 2418 kcal: eine kcal über dem Budget.
  'kalorienbudget-ueber-budget': () => kalorienbudget(253, false),
} as const satisfies Partial<Record<SeedScenarioKey, () => Randzustand>>;

type ErnaehrungRandzustandKey = keyof typeof ernaehrungRandzustaende;

/** Die Randzustände der Ernährung (#166). */
export const ernaehrungRandzustandManifests = Object.fromEntries(
  (Object.keys(ernaehrungRandzustaende) as ErnaehrungRandzustandKey[]).map((scenario) => [
    scenario,
    randzustandManifest(scenario, ernaehrungRandzustaende[scenario]()),
  ]),
) as Readonly<Record<ErnaehrungRandzustandKey, SeedManifest>>;
