import { buildSeedState, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedScenarioKey } from './manifest.ts';
import {
  seedBlsEntry,
  seedCreated as created,
  seedDailyGoals,
  seedDay as day,
  seedManualOrigin,
  seedOwnFood,
  seedSportEntry,
  seedWaterEntry,
  seedWeeklyPlan,
  type SeedWeeklyPlan,
} from './rows.ts';
import type { BausteinKey } from '../src/base.ts';

// Szenario `solo` (Spezifikation 0, Abschnitt 12): Philipp hat das Onboarding abgeschlossen, ist
// nicht gekoppelt (Momo ist noch ein Ei: ohne Kopplung gibt es weder Rolle noch Insel), hat
// vollständige Ziele samt Wochenplan und den drei Tageszielen von heute sowie eigene Wasser-, Sport-
// und Gewichtseinträge und ein Frühstück aus der Suche ohne Fotos. Das iPhone ist auf dem Stand des
// Servers, ohne offene Operationen; der Seed-Deep-Link führt direkt auf „Heute“, mit
// `ziel=/log` ins Protokoll. Alle Werte sind erfunden; die Zielwerte sind plausibel, aber nicht mit dem
// Zielrechner aus Spezifikation 1 berechnet. Nährwerte stammen aus dem BLS 4.0.

const philipp = seedIds.person.philipp;

/** Fundament: die fertige Person ohne Kopplung. */
export const soloFundament: SeedPart = {
  area: 'fundament',
  entities: [
    {
      table: 'person',
      entityType: 'person',
      ownerPersonId: philipp,
      row: {
        id: philipp,
        account_id: seedIds.account.philipp,
        display_name: 'Philipp',
        calculation_sex: 'maennlich',
        birth_date: '1990-05-17',
        height_cm: 182,
        activity_level: 'maessig_aktiv',
        pregnant_or_breastfeeding: false,
        known_eating_disorder: false,
        disclaimer_accepted_at: '2026-10-01T07:00:00.000Z',
        onboarding_status: 'abgeschlossen',
        onboarding_completed_at: '2026-10-01T07:05:00.000Z',
        goal_weight_reached_g: null,
        goal_weight_reached_at: null,
        time_zone: seedClock.timeZone,
        created_at: '2026-10-01T07:00:00.000Z',
        updated_at: '2026-10-01T07:05:00.000Z',
        deleted_at: null,
      },
    },
  ],
};

/** Wochenplan mit dem Tag von heute (Mittwoch), aus dem die drei Tagesziele von heute entstehen. */
export type SoloWeeklyPlan = SeedWeeklyPlan & Readonly<{ mittwoch: readonly [BausteinKey, BausteinKey, BausteinKey] }>;

/**
 * Schwellen der Tagesziele aus Philipps Zielversion. Das Kalorienbudget steht in ganzen kcal, abgeschnitten
 * aus den Milli-kcal der Zielversion; diese Rundung wählt der Seed, festgelegt wird sie mit der
 * Materialisierung der Tagesziele (#131).
 */
export const philippThresholds = {
  ernaehrung_erfasst: { minimumMealCategories: 3 },
  im_kalorienbudget: { budgetKcal: 2_417, lowerBoundKcal: 1_882 },
  wasserziel: { targetMl: 2_500 },
  sporteinheit: { minimumSingleSessionMinutes: 20 },
} as const;

/**
 * Wochenplan von `solo`: Wiegetage sind Montag, Mittwoch, Donnerstag und Sonntag. Heute (Mittwoch) ist
 * Wiegetag und noch offen (Spezifikation 3, Abschnitt 9; #175), daneben vier Sporttage.
 */
export const soloWeeklyPlan = {
  montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
  dienstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  mittwoch: ['gewogen', 'wasserziel', 'sporteinheit'],
  donnerstag: ['im_kalorienbudget', 'wasserziel', 'gewogen'],
  freitag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  samstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  sonntag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
} as const satisfies SoloWeeklyPlan;

/**
 * Randzustand „Wochenplan ohne Wiegetag“ (Spezifikation 3, Abschnitt 9; #175) als Plan-Daten: dieselben
 * Sporttage, statt Gewogen Ernährung erfasst bzw. Im Kalorienbudget. Dieselbe Wochenplanversion wie in
 * `solo` (ID aus Person und `valid_from`, #128), nur mit anderen Tagen; der `PlanReader` liest sie aus
 * der Gerätedatenbank des Szenarios.
 */
const weeklyPlanOhneWiegetag = {
  montag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  dienstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  donnerstag: ['im_kalorienbudget', 'wasserziel', 'ernaehrung_erfasst'],
  freitag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  samstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  sonntag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
} as const satisfies SoloWeeklyPlan;

/**
 * Zielversion im Haltemodus für den Randzustand „Prognose im Haltemodus entfallen“ (Spezifikation 3,
 * Abschnitt 9; #176): dieselben Eingaben wie in `solo`, aber ohne Tempo. Die kcal-Werte stammen aus dem
 * Zielrechner (`calculateGoals` mit `pace: null`), sodass die Fassung zu ihren Eingaben passt.
 */
const haltemodus = {
  calorie_budget_milli_kcal: 3_010_000,
  basal_metabolic_rate_milli_kcal: 1_883_000,
  total_energy_expenditure_milli_kcal: 3_012_000,
  lower_bound_milli_kcal: 1_883_000,
  deficit_milli_kcal: null,
  maintenance_reason: 'gewaehlt',
  pace: null,
} as const;

/** Tempo der Zielversion: wie in `solo` „entspannt“ oder der Haltemodus (#176). */
type SoloGoal = 'tempo' | 'haltemodus';

/** Ziele (Spezifikation 1): Zielversion, Wochenplan und die drei Tagesziele von heute (Mittwoch). */
export const soloZieleOf = (plan: SoloWeeklyPlan, goal: SoloGoal = 'tempo'): SeedPart => ({
  area: 'ziele',
  entities: [
    {
      table: 'goal_version',
      // Seit #128 beim Sync angemeldet: Die Fassung steht im Änderungsprotokoll.
      entityType: 'goal_version',
      ownerPersonId: philipp,
      row: {
        id: seedIds.goalVersion.philipp,
        person_id: philipp,
        valid_from: seedDays.zielstart,
        calorie_budget_milli_kcal: 2_417_875,
        basal_metabolic_rate_milli_kcal: 1_882_500,
        total_energy_expenditure_milli_kcal: 2_917_875,
        lower_bound_milli_kcal: 1_882_500,
        deficit_milli_kcal: 500_000,
        budget_source: 'berechnet',
        calculation_sex: 'maennlich',
        age_years: 36,
        height_cm: 182,
        weight_g: 92_000,
        activity_level: 'maessig_aktiv',
        maintenance_reason: null,
        pace: 'entspannt',
        goal_weight_g: 84_000,
        water_target_ml: 2_500,
        weekly_sport_target_minutes: 150,
        ...(goal === 'haltemodus' ? haltemodus : {}),
        ...created('2026-10-01T07:05:00.000Z'),
      },
    },
    seedWeeklyPlan({
      id: seedIds.weeklyPlanVersion.philipp,
      personId: philipp,
      validFrom: seedDays.zielstart,
      createdAt: '2026-10-01T07:05:00.000Z',
      plan,
    }),
    ...seedDailyGoals({
      personId: philipp,
      ids: seedIds.dailyGoal.philippHeute,
      localDate: seedDays.heute,
      dayEndsAt: seedDayEnds.heute,
      createdAt: '2026-10-14T05:00:00.000Z',
      bausteine: plan.mittwoch,
      // Gewogen hat keine Schwelle.
      thresholds: philippThresholds,
    }),
  ],
});

/** Wasser heute, ohne Importe (Spezifikation 3, Abschnitt 9): Menge und Zeitpunkt je Eintrag. */
export type WaterToday = readonly (readonly [amountMl: number, loggedAt: string])[];

/**
 * Wasser heute in `solo` und seinen Varianten; das Wasserziel ist 2500 ml. `solo` steht im Status
 * `teil`, die Varianten zeigen die übrigen Status des Mini-Trackers (`trackerStatus` der Tracker-Regeln).
 */
const waterToday = {
  solo: [[500, '2026-10-14T06:30:00.000Z'], [750, '2026-10-14T10:15:00.000Z']],
  'solo-wasser-leer': [],
  'solo-wasser-erreicht': [[500, '2026-10-14T06:30:00.000Z'], [750, '2026-10-14T10:15:00.000Z'], [750, '2026-10-14T11:00:00.000Z'], [500, '2026-10-14T11:30:00.000Z']],
  'solo-wasser-ueber-ziel': [
    [500, '2026-10-14T06:30:00.000Z'], [750, '2026-10-14T10:15:00.000Z'], [750, '2026-10-14T11:00:00.000Z'],
    [500, '2026-10-14T11:30:00.000Z'], [250, '2026-10-14T11:45:00.000Z'],
  ],
} as const satisfies Partial<Record<SeedScenarioKey, WaterToday>>;

/** Ein manueller Sporteintrag, ohne Importe. */
type SportUnit = Readonly<{ id: string; activity: string; startedAt: string; minutes: number; localDate: string; createdAt: string }>;

/** Montag: Spaziergang am Abend; Dienstag: Radtour am Abend. */
const sportWeekSolo: readonly SportUnit[] = [
  { id: seedIds.sportEntry.philippVorgestern, activity: 'gehen', startedAt: '2026-10-12T16:00:00.000Z', minutes: 40, localDate: seedDays.vorgestern, createdAt: '2026-10-12T16:45:00.000Z' },
  { id: seedIds.sportEntry.philippGestern, activity: 'radfahren', startedAt: '2026-10-13T16:00:00.000Z', minutes: 35, localDate: seedDays.gestern, createdAt: '2026-10-13T16:40:00.000Z' },
];

/** Dazu ein Lauf am Montagmorgen und Krafttraining am Dienstagmorgen. */
const sportWeekErreicht: readonly SportUnit[] = [
  ...sportWeekSolo,
  { id: seedIds.sportEntry.philippWoche[0], activity: 'laufen', startedAt: '2026-10-12T05:00:00.000Z', minutes: 45, localDate: seedDays.vorgestern, createdAt: '2026-10-12T05:50:00.000Z' },
  { id: seedIds.sportEntry.philippWoche[1], activity: 'krafttraining', startedAt: '2026-10-13T05:00:00.000Z', minutes: 30, localDate: seedDays.gestern, createdAt: '2026-10-13T05:35:00.000Z' },
];

/**
 * Sportwoche in `solo` und seinen Varianten; das Sportwochenziel ist 150 min. `solo` steht mit 75 min im
 * Status `teil`, `solo-sport-erreicht` genau auf dem Ziel, `solo-sport-ueber-ziel` mit Yoga am Dienstagabend
 * darüber (`trackerStatus` der Tracker-Regeln). Heute (Mittwoch) gibt es noch keine Einheit, damit die
 * Sporteinheit von heute offen bleibt.
 */
const sportWeek = {
  solo: sportWeekSolo,
  'solo-sport-erreicht': sportWeekErreicht,
  'solo-sport-ueber-ziel': [
    ...sportWeekErreicht,
    { id: seedIds.sportEntry.philippWoche[2], activity: 'yoga_dehnen', startedAt: '2026-10-13T18:30:00.000Z', minutes: 20, localDate: seedDays.gestern, createdAt: '2026-10-13T18:55:00.000Z' },
  ],
} as const satisfies Partial<Record<SeedScenarioKey, readonly SportUnit[]>>;

/**
 * Philipps Vorwoche (5. bis 11.10.) in `solo` und seinen Varianten, für den Wochenwechsel des
 * Sport-Detailbildschirms (#174): Montag ein Lauf, Donnerstag zwei Einheiten (Krafttraining morgens, Yoga
 * abends), zusammen 80 Minuten. Die laufende Woche und damit Mini-Tracker und Tagesziele bleiben unberührt.
 */
const sportVorwoche: SeedPart = {
  area: 'tracker',
  entities: [
    { id: seedIds.sportEntry.philippVorwoche[0], activity: 'laufen', startedAt: '2026-10-05T16:00:00.000Z', minutes: 30, localDate: '2026-10-05', createdAt: '2026-10-05T16:35:00.000Z' },
    { id: seedIds.sportEntry.philippVorwoche[1], activity: 'krafttraining', startedAt: '2026-10-08T05:00:00.000Z', minutes: 30, localDate: '2026-10-08', createdAt: '2026-10-08T05:35:00.000Z' },
    { id: seedIds.sportEntry.philippVorwoche[2], activity: 'yoga_dehnen', startedAt: '2026-10-08T17:30:00.000Z', minutes: 20, localDate: '2026-10-08', createdAt: '2026-10-08T17:55:00.000Z' },
  ].map(({ id, activity, startedAt, minutes, localDate, createdAt }) => seedSportEntry({ id, personId: philipp, activity, startedAt, minutes, createdAt, localDate })),
};

/** Eine manuelle Messung: ID, Gewicht in g, Zeitpunkt und lokaler Tag in Berlin. */
type SeedWeighing = Readonly<{ id: string; weight: number; at: string; localDate: string }>;

/** Zwei Wiegungen bis gestern: unter drei Tagesgewichten, also noch ohne Trend (#175, #176). */
const weighingsSolo: readonly SeedWeighing[] = [
  { id: seedIds.weightEntry.philippVorgestern, weight: 92_400, at: '2026-10-12T05:30:00.000Z', localDate: seedDays.vorgestern },
  { id: seedIds.weightEntry.philippGestern, weight: 91_800, at: '2026-10-13T05:45:00.000Z', localDate: seedDays.gestern },
];

/**
 * Messungen je Szenario. `solo` ist zugleich der Randzustand „unter drei Tagesgewichten“; die Varianten
 * zeigen die übrigen Randzustände des Gewichtstrends aus Spezifikation 3, Abschnitt 9 (#176):
 * - `solo-gewicht-steigend`: steigender Trend, Veränderung in 2 Wochen +0,2 kg;
 * - `solo-gewicht-ohne-14-tage`: Trend, aber kein Tagesgewicht in den letzten 14 Tagen;
 * - `solo-haltemodus`: drei Tagesgewichte über dem Zielgewicht, die Prognose entfällt im Haltemodus.
 */
const weighings = {
  solo: weighingsSolo,
  'solo-gewicht-steigend': [
    { id: seedIds.weightEntry.philippVerlauf[0], weight: 91_400, at: '2026-10-09T05:30:00.000Z', localDate: '2026-10-09' },
    { id: seedIds.weightEntry.philippVerlauf[1], weight: 91_600, at: '2026-10-10T05:30:00.000Z', localDate: '2026-10-10' },
    { id: seedIds.weightEntry.philippVorgestern, weight: 92_000, at: '2026-10-12T05:30:00.000Z', localDate: seedDays.vorgestern },
    { id: seedIds.weightEntry.philippGestern, weight: 92_400, at: '2026-10-13T05:45:00.000Z', localDate: seedDays.gestern },
  ],
  'solo-gewicht-ohne-14-tage': [
    { id: seedIds.weightEntry.philippVerlauf[0], weight: 92_800, at: '2026-09-24T05:30:00.000Z', localDate: '2026-09-24' },
    { id: seedIds.weightEntry.philippVerlauf[1], weight: 92_600, at: '2026-09-26T05:30:00.000Z', localDate: '2026-09-26' },
    { id: seedIds.weightEntry.philippVerlauf[2], weight: 92_400, at: '2026-09-29T05:30:00.000Z', localDate: '2026-09-29' },
  ],
  'solo-haltemodus': [
    { id: seedIds.weightEntry.philippVerlauf[0], weight: 92_600, at: '2026-10-11T05:30:00.000Z', localDate: '2026-10-11' },
    ...weighingsSolo,
  ],
} as const satisfies Partial<Record<SeedScenarioKey, readonly SeedWeighing[]>>;

/** Was `solo` und seine Varianten unterscheidet: Wasser von heute, Sportwoche, Wochenplan, Messungen und Tempo. */
type SoloVariant = Readonly<{ water: WaterToday; sport: readonly SportUnit[]; plan: SoloWeeklyPlan; weights?: readonly SeedWeighing[]; goal?: SoloGoal }>;

/**
 * `solo` und seine Varianten: `solo-wasser-*` zeigen die übrigen Status des Wasser-Mini-Trackers
 * (#171), `solo-sport-*` die des Sport-Mini-Trackers (#173), `solo-ohne-wiegetag` den
 * Gewichts-Mini-Tracker ohne Wiegetag im Wochenplan (#175), `solo-gewicht-*` und `solo-haltemodus` die
 * Randzustände des Gewichtstrends (#176).
 */
const soloVariants = {
  solo: { water: waterToday.solo, sport: sportWeek.solo, plan: soloWeeklyPlan },
  'solo-wasser-leer': { water: waterToday['solo-wasser-leer'], sport: sportWeek.solo, plan: soloWeeklyPlan },
  'solo-wasser-erreicht': { water: waterToday['solo-wasser-erreicht'], sport: sportWeek.solo, plan: soloWeeklyPlan },
  'solo-wasser-ueber-ziel': { water: waterToday['solo-wasser-ueber-ziel'], sport: sportWeek.solo, plan: soloWeeklyPlan },
  'solo-sport-erreicht': { water: waterToday.solo, sport: sportWeek['solo-sport-erreicht'], plan: soloWeeklyPlan },
  'solo-sport-ueber-ziel': { water: waterToday.solo, sport: sportWeek['solo-sport-ueber-ziel'], plan: soloWeeklyPlan },
  'solo-ohne-wiegetag': { water: waterToday.solo, sport: sportWeek.solo, plan: weeklyPlanOhneWiegetag },
  'solo-gewicht-steigend': { water: waterToday.solo, sport: sportWeek.solo, plan: soloWeeklyPlan, weights: weighings['solo-gewicht-steigend'] },
  'solo-gewicht-ohne-14-tage': { water: waterToday.solo, sport: sportWeek.solo, plan: soloWeeklyPlan, weights: weighings['solo-gewicht-ohne-14-tage'] },
  'solo-haltemodus': { water: waterToday.solo, sport: sportWeek.solo, plan: soloWeeklyPlan, weights: weighings['solo-haltemodus'], goal: 'haltemodus' },
} as const satisfies Partial<Record<SeedScenarioKey, SoloVariant>>;

type SoloScenario = keyof typeof soloVariants;

/** Tracker (Spezifikation 3): Wasser heute, Sportwoche und Messungen je Szenario, ohne Messung von heute. */
export const soloTrackerOf = (water: WaterToday, sport: readonly SportUnit[] = sportWeek.solo, weights: readonly SeedWeighing[] = weighings.solo): SeedPart => ({
  area: 'tracker',
  entities: [
    ...water.map(([amountMl, loggedAt], index) =>
      seedWaterEntry({ id: seedIds.waterEntry.philippHeute[index] as string, personId: philipp, amountMl, loggedAt, localDate: seedDays.heute })),
    ...sport.map(({ id, activity, startedAt, minutes, localDate, createdAt }) =>
      seedSportEntry({ id, personId: philipp, activity, startedAt, minutes, createdAt, localDate })),
    // Heute (Mittwoch, Wiegetag) hat Philipp noch nicht gewogen (#175).
    ...weights.map(({ id, weight, at, localDate }) => ({
      table: 'weight_entry',
      // Seit #175 beim Sync angemeldet: Die Einträge stehen im Änderungsprotokoll.
      entityType: 'weight_entry',
      ownerPersonId: philipp,
      row: {
        id,
        person_id: philipp,
        weight_g: weight,
        measured_at: at,
        ...seedManualOrigin,
        ...day(localDate),
        ...created(at),
      },
    })),
  ],
});

/**
 * Ernährung (Spezifikation 2): heute ein Frühstück aus der Suche, ohne Mahlzeitenfoto und damit ohne
 * Fotofreigabe (#155). Mittagessen, Abendessen und Snacks bleiben leer, damit das Protokoll seine
 * Leerzustände zeigt. Mit nur einer Mahlzeit bleibt „Ernährung erfasst“ (mindestens 3) offen.
 */
export const soloErnaehrung: SeedPart = {
  area: 'ernaehrung',
  entities: [
    seedBlsEntry({
      id: seedIds.nutritionEntry.philippFruehstueck[0], personId: philipp, at: '2026-10-14T06:40:00.000Z', localDate: seedDays.heute, meal: 'fruehstueck',
      food: { key: 'C133000', name: 'Hafer Flocken', milliKcal: 348_000, proteinMg: 13_220, carbsMg: 53_300, fatMg: 6_650 },
      grams: 60,
    }),
    seedBlsEntry({
      id: seedIds.nutritionEntry.philippFruehstueck[1], personId: philipp, at: '2026-10-14T06:41:00.000Z', localDate: seedDays.heute, meal: 'fruehstueck',
      food: { key: 'F110100', name: 'Apfel roh', milliKcal: 58_000, proteinMg: 424, carbsMg: 11_700, fatMg: 500 },
      grams: 150,
    }),
  ],
};

/**
 * Eigene Lebensmittel (Spezifikation 2, Abschnitt 3; #157), nur in `solo` und seinen Varianten: ein
 * selbst gemachtes Bircher-Müsli mit der Portion „1 Glas“ und eine Korrektur des BLS-Lebensmittels
 * „Apfel roh“ (F110100) um ein Stück von 180 g. Die Korrektur behält die BLS-Werte und überdeckt die
 * Quelle in der Suche. Die Werte des Müslis und das Stückgewicht sind erfunden.
 */
export const soloEigeneLebensmittel: SeedPart = {
  area: 'ernaehrung',
  entities: [
    seedOwnFood({
      id: seedIds.ownFood.philippBircher, personId: philipp, at: '2026-10-10T06:00:00.000Z',
      food: {
        name: 'Bircher-Müsli, selbst gemacht', baseUnit: 'g', referenceAmount: 100_000, milliKcal: 150_000, proteinMg: 4_500, carbsMg: 21_000, fatMg: 5_200,
        portions: [{ unit: 'portion', label: '1 Glas', baseAmount: 250_000 }], origin: null,
      },
    }),
    seedOwnFood({
      id: seedIds.ownFood.philippApfel, personId: philipp, at: '2026-10-11T15:00:00.000Z',
      food: {
        name: 'Apfel roh', baseUnit: 'g', referenceAmount: 100_000, milliKcal: 58_000, proteinMg: 424, carbsMg: 11_700, fatMg: 500,
        portions: [{ unit: 'stueck', label: '1 mittelgroßer', baseAmount: 180_000 }], origin: { type: 'bls', key: 'F110100' },
      },
    }),
  ],
};

/** Beiträge des Szenarios in Reihenfolge; ein Bereich ergänzt hier seinen Beitrag. */
const soloPartsWith = ({ water, sport, plan, weights, goal }: SoloVariant): readonly SeedPart[] => [
  soloFundament,
  soloZieleOf(plan, goal),
  soloTrackerOf(water, sport, weights),
  soloErnaehrung,
];

/** Beiträge von `solo`; `gekoppelt` übernimmt sie als Philipps Daten. */
export const soloParts = soloPartsWith(soloVariants.solo);

/** `solo` oder eine seiner Varianten; sie unterscheiden sich nur im Wasser von heute, in der Sportwoche oder im Wochenplan. */
function soloScenario(scenario: SoloScenario): SeedManifest {
  const state = buildSeedState({
    parts: [...soloPartsWith(soloVariants[scenario]), soloEigeneLebensmittel, sportVorwoche],
    createdAt: seedClock.instant,
    devices: { [seedInstallations.philippIphone.key]: { personId: philipp, cursor: 'latest' } },
  });
  return SeedManifest.parse({
    formatVersion: 1,
    scenario,
    // Revision 8: Sporteinträge der Vorwoche samt einem Tag mit zwei Einheiten seit #174.
    // Revision 7: unentschiedene Erlaubnis für Mitteilungen auf dem iPhone seit #125.
    // Revision 6: eigene Lebensmittel seit #157 (ein eigenes mit Portion, eine BLS-Korrektur).
    // Revision 5: Sporteinträge seit #173 im Änderungsprotokoll, eine Einheit mehr am Montag.
    // Revision 4: Gewichtseinträge seit #175 im Änderungsprotokoll, heute ist Wiegetag. Revision 3:
    // Philipps Frühstück aus der Suche seit #155; Revision 2: Wassereinträge seit #171 im Änderungsprotokoll.
    revision: 8,
    clock: seedClock,
    localDates: seedDays,
    catalogVersion: null,
    accounts: [seedAccounts.philipp],
    installations: [{ ...seedInstallations.philippIphone, notificationPermission: 'undetermined' }],
    initial: state,
    // Ein Sync ändert nichts: Das iPhone ist schon auf dem Stand des Servers.
    steps: [{ type: 'sync', installation: seedInstallations.philippIphone.key }],
    target: state,
  });
}

/** `solo` und seine Varianten (#171, #173, #175, #176). */
export const soloManifests = Object.fromEntries(
  (Object.keys(soloVariants) as SoloScenario[]).map((scenario) => [scenario, soloScenario(scenario)]),
) as Readonly<Record<SoloScenario, SeedManifest>>;

