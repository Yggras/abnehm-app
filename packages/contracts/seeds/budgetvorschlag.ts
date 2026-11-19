import { EntityId, LocalDate } from '../src/base.ts';
import { budgetSuggestionId, weeklyPlanVersionId } from '../src/plan.ts';
import { currentSyncSchemaVersion, OutboxOperation } from '../src/sync.ts';
import { buildSeedState, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedRow, type SeedScenarioKey, type SeedState } from './manifest.ts';
import { seedBlsEntry, seedWeeklyPlan } from './rows.ts';
import { soloFundament, soloTrackerOf, soloWeeklyPlan, type SeedWeighing } from './solo.ts';
import { calculatedGoalVersion } from './ziele-einstellungen.ts';

// Szenarien „Budgetvorschlag fällig“ aus Spezifikation 1, Abschnitt 12 (#150), zum Senken und zum Anheben.
// Philipp ist allein, hat das Onboarding am Mittwoch, 16.09.2026, abgeschlossen und seitdem dieselbe
// Zielversion: dieselben Eingaben wie in `solo` (männlich, 36, 182 cm, 92 kg, mäßig aktiv, entspannt), aber
// aus dem Zielrechner, also Budget 2.510 kcal, Untergrenze 1.883 kcal und Gesamtumsatz 3.012 kcal. Heute
// (14.10.) gilt sie seit 28 Tagen. In den letzten 21 Tagen bis gestern (23.09.–13.10.) hat er je Abschnitt
// dreimal gewogen und an zwölf Tagen Frühstück und Abendessen erfasst, zehnmal im Budget.
// - `budgetvorschlag-senken`: Das Gewicht stagniert (Trendverlust etwa 0,05 kg/Woche, unter 0,25 kg/Woche).
// - `budgetvorschlag-anheben`: Das Gewicht fällt schnell (Trendverlust etwa 1,02 kg/Woche, über 0,75 kg/Woche).
// Der Schritt `budgetvorschlag_pruefen` ist die App-Öffnung: Der Sollzustand nennt den offenen Vorschlag samt
// Upsert in der Outbox und den Tag der Prüfung im Gerätezustand. Den Server erreicht er erst mit dem nächsten
// Sync. Die Beträge stehen ausgeschrieben im Manifest, damit der Sollzustand nicht mit derselben Rechnung
// entsteht, die er prüft. Gewichte und Aufnahme sind erfunden, die Nährwerte je 100 g stammen aus dem BLS 4.0
// wie im Testkatalog der App (`apps/mobile/src/nutrition/testing/test-catalog.ts`).

const philipp = seedIds.person.philipp;
const iphone = seedInstallations.philippIphone.key;
const now = seedClock.instant;
/** Onboarding und Startgewicht: Mittwoch, 16.09.2026. */
const onboarding = { day: '2026-09-16', disclaimerAt: '2026-09-16T07:00:00.000Z', completedAt: '2026-09-16T07:05:00.000Z' } as const;
/** Geprüfter Zeitraum: die letzten 21 lokalen Tage bis gestern. */
const period = { from: '2026-09-23', to: seedDays.gestern } as const;

/** Die Person aus `solo`, aber seit dem 16.09. im Onboarding fertig. */
const fundament: SeedPart = {
  area: 'fundament',
  entities: soloFundament.entities.map((entity) => ({
    ...entity,
    row: {
      ...entity.row,
      disclaimer_accepted_at: onboarding.disclaimerAt,
      onboarding_completed_at: onboarding.completedAt,
      created_at: onboarding.disclaimerAt,
      updated_at: onboarding.completedAt,
    },
  })),
};

/** Zielversion und Wochenplanversion aus dem Onboarding am 16.09.; Tagesziele legt die App-Öffnung an. */
const ziele: SeedPart = {
  area: 'ziele',
  entities: [
    calculatedGoalVersion(LocalDate.parse(onboarding.day), onboarding.completedAt, {}),
    seedWeeklyPlan({
      id: weeklyPlanVersionId(EntityId.parse(philipp), LocalDate.parse(onboarding.day)),
      personId: philipp,
      validFrom: onboarding.day,
      createdAt: onboarding.completedAt,
      plan: soloWeeklyPlan,
    }),
  ],
};

/** Budget der Zielversion und die erwarteten Vorschläge (± 150 kcal), ausgeschrieben. */
export const budgetvorschlagBudget = { previousMilliKcal: 2_510_000, senkenMilliKcal: 2_360_000, anhebenMilliKcal: 2_660_000 } as const;

/** Wiegetage: das Startgewicht, dann je Abschnitt Mittwoch/Freitag/Montag bzw. Montag/Mittwoch/Freitag. */
const weighDays = ['2026-09-16', '2026-09-23', '2026-09-25', '2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-07', '2026-10-09', '2026-10-12'] as const;

/** Gewichte in g je Wiegetag; das erste ist das Startgewicht aus dem Onboarding. */
const weights = {
  'budgetvorschlag-senken': [92_000, 92_200, 91_900, 92_100, 91_800, 92_000, 92_200, 91_900, 92_100, 91_800],
  'budgetvorschlag-anheben': [92_000, 91_000, 90_600, 90_000, 89_600, 89_200, 88_600, 88_200, 87_800, 87_200],
} as const;

type Scenario = keyof typeof weights;

function weighingsOf(scenario: Scenario): SeedWeighing[] {
  return weighDays.map((localDate, index) => ({
    id: seedIds.weightEntry.philippBudgetvorschlag[index]!,
    weight: weights[scenario][index]!,
    // 07:30 in Berlin (Sommerzeit, UTC+2); das Startgewicht beim Onboarding.
    at: index === 0 ? onboarding.completedAt : `${localDate}T05:30:00.000Z`,
    localDate,
  }));
}

/** BLS 4.0, je 100 g (Testkatalog der App). */
const knuspermuesli = { key: 'C514300', name: 'Knuspermüslimischung, klassisch, gesüßt, angereichert mit Vitaminen und Mineralstoffen', milliKcal: 421_000, proteinMg: 9_000, carbsMg: 56_400, fatMg: 15_950 };
const kartoffelkloss = { key: 'K240400', name: 'Kartoffelkloß (aus rohen Kartoffeln) Trockenprodukt', milliKcal: 320_000, proteinMg: 6_030, carbsMg: 70_700, fatMg: 227 };
const nussplaetzchen = { key: 'D701700', name: 'Haferflocken-Nussplätzchen', milliKcal: 517_000, proteinMg: 9_699, carbsMg: 37_900, fatMg: 35_161 };

/**
 * Zwölf erfasste Tage im Zeitraum, je Frühstück (200 g Knuspermüsli, 842 kcal) und Abendessen. An zehn Tagen
 * 400 g Kartoffelkloß (zusammen 2.122 kcal, im Budget), an den beiden Sonntagen 400 g Nussplätzchen (zusammen
 * 2.910 kcal, darüber). Zehn von zwölf Tagen sind 83 %.
 */
const intakeDays = [
  '2026-09-24', '2026-09-26', '2026-09-27', '2026-09-29', '2026-10-01', '2026-10-03',
  '2026-10-04', '2026-10-06', '2026-10-08', '2026-10-10', '2026-10-11', '2026-10-13',
] as const;
const overBudgetDays: readonly string[] = ['2026-09-27', '2026-10-04'];

const ernaehrung: SeedPart = {
  area: 'ernaehrung',
  entities: intakeDays.flatMap((localDate, index) => [
    seedBlsEntry({
      id: seedIds.nutritionEntry.philippBudgetvorschlag[2 * index]!, personId: philipp, at: `${localDate}T04:30:00.000Z`, localDate, meal: 'fruehstueck',
      food: knuspermuesli, grams: 200,
    }),
    seedBlsEntry({
      id: seedIds.nutritionEntry.philippBudgetvorschlag[2 * index + 1]!, personId: philipp, at: `${localDate}T16:30:00.000Z`, localDate, meal: 'abendessen',
      food: overBudgetDays.includes(localDate) ? nussplaetzchen : kartoffelkloss, grams: 400,
    }),
  ]),
};

/**
 * Eingaben der Fixture-Adapter aus #104 für den Nachweis des Sollzustands (#150): die Tagesgewichte, aus denen
 * der `WeightTrendReader` nach den Tracker-Regeln den Trend rechnet, und die Tagesaufnahme je erfasstem Tag,
 * wie der `IntakeReader` sie liefert. Mit den echten Readern prüft die Seed-Welt des Backends denselben Stand.
 */
export function budgetvorschlagReadings(scenario: Scenario) {
  return {
    dayWeights: weighDays.map((localDate, index) => ({ localDate, weightG: weights[scenario][index]! })),
    intake: Object.fromEntries(
      intakeDays.map((localDate) => [localDate, { intakeMilliKcal: overBudgetDays.includes(localDate) ? 2_910_000 : 2_122_000, recordedMealCategories: 2 }]),
    ) as Readonly<Record<string, { intakeMilliKcal: number; recordedMealCategories: number }>>,
  };
}

/** Schlüssel des Gerätezustands, unter dem das Plan-Modul den Tag der letzten Prüfung merkt (`plan/budget-suggestion.ts`). */
const checkedOnKey = 'plan.budgetvorschlag_geprueft_am';

function target(initial: SeedState, scenario: Scenario): SeedState {
  const id = budgetSuggestionId(EntityId.parse(philipp), LocalDate.parse(period.to));
  const direction = scenario === 'budgetvorschlag-senken' ? 'senken' : 'anheben';
  const payload = {
    periodFrom: period.from,
    periodTo: period.to,
    previousBudgetMilliKcal: budgetvorschlagBudget.previousMilliKcal,
    suggestedBudgetMilliKcal: direction === 'senken' ? budgetvorschlagBudget.senkenMilliKcal : budgetvorschlagBudget.anhebenMilliKcal,
    direction,
    status: 'offen',
  } as const;
  const suggestion: SeedRow = {
    id,
    person_id: philipp,
    period_from: payload.periodFrom,
    period_to: payload.periodTo,
    previous_budget_milli_kcal: payload.previousBudgetMilliKcal,
    suggested_budget_milli_kcal: payload.suggestedBudgetMilliKcal,
    direction: payload.direction,
    status: payload.status,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    // Lokal angelegt und noch nicht synchronisiert.
    server_version: null,
  };
  const upsert = OutboxOperation.parse({
    type: 'upsert_entity',
    operationId: seedIds.operation.budgetvorschlag[direction],
    entityType: 'budget_suggestion',
    entityId: id,
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: now,
    payload,
  });
  const device = initial.devices[iphone]!;
  return {
    server: initial.server,
    devices: {
      [iphone]: {
        ...device,
        rows: {
          ...device.rows,
          budget_suggestion: [...(device.rows.budget_suggestion ?? []), suggestion],
          device_state: [...(device.rows.device_state ?? []), { key: checkedOnKey, value: seedDays.heute, updated_at: now }],
        },
        outbox: [...device.outbox, upsert],
      },
    },
  };
}

function manifest(scenario: Scenario): SeedManifest {
  const initial = buildSeedState({
    parts: [fundament, ziele, soloTrackerOf([], [], weighingsOf(scenario)), ernaehrung],
    createdAt: now,
    devices: { [iphone]: { personId: philipp, cursor: 'latest' } },
  });
  const direction = scenario === 'budgetvorschlag-senken' ? 'senken' : 'anheben';
  return SeedManifest.parse({
    formatVersion: 1,
    scenario,
    revision: 1,
    clock: seedClock,
    localDates: seedDays,
    catalogVersion: null,
    accounts: [seedAccounts.philipp],
    installations: [seedInstallations.philippIphone],
    initial,
    steps: [{ type: 'budgetvorschlag_pruefen', installation: iphone, operationIds: [EntityId.parse(seedIds.operation.budgetvorschlag[direction])] }],
    target: target(initial, scenario),
  });
}

/** „Budgetvorschlag fällig“ zum Senken und zum Anheben (Spezifikation 1, Abschnitt 12; #150). */
export const budgetvorschlagManifests = {
  'budgetvorschlag-senken': manifest('budgetvorschlag-senken'),
  'budgetvorschlag-anheben': manifest('budgetvorschlag-anheben'),
} as const satisfies Partial<Record<SeedScenarioKey, SeedManifest>>;
