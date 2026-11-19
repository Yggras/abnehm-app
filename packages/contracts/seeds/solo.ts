import { buildSeedState, type SeedEntity, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedScenarioKey } from './manifest.ts';
import {
  seedBlsEntry,
  seedCreated as created,
  seedDailyGoals,
  seedDay as day,
  seedGoalVersion,
  seedManualOrigin,
  seedOwnFood,
  seedSportEntry,
  seedWaterEntry,
  seedWeeklyPlan,
  type SeedWeeklyPlan,
} from './rows.ts';
import type { BausteinKey } from '../src/base.ts';
import { goalSettingsVariants, type GoalSettingsVariant } from './ziele-einstellungen.ts';

// Szenario `solo` (Spezifikation 0, Abschnitt 12): Philipp hat das Onboarding abgeschlossen, ist
// nicht gekoppelt (Momo ist noch ein Ei: ohne Kopplung gibt es weder Rolle noch Insel), hat
// vollständige Ziele samt Wochenplan und den drei Tageszielen von heute sowie eigene Wasser-, Sport-
// und Gewichtseinträge und ein Frühstück aus der Suche ohne Fotos. Das iPhone ist auf dem Stand des
// Servers, ohne offene Operationen; der Seed-Deep-Link führt direkt auf „Heute“, mit
// `ziel=/log` ins Protokoll. Alle Werte sind erfunden; die Zielwerte sind plausibel, aber nicht mit dem
// Zielrechner aus Spezifikation 1 berechnet. Nährwerte stammen aus dem BLS 4.0.

const philipp = seedIds.person.philipp;

/** Fundament: die fertige Person ohne Kopplung; Varianten ändern einzelne Angaben (#147). */
const soloFundamentWith = (person: GoalSettingsVariant['person'] = {}): SeedPart => ({
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
        ...person,
      },
    },
  ],
});

export const soloFundament: SeedPart = soloFundamentWith();

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

/** Schwellen der Tagesziele je Baustein, wie sie `seedDailyGoals` in die Snapshots schreibt. */
export type SeedThresholds = Parameters<typeof seedDailyGoals>[0]['thresholds'];

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
  calorieBudgetMilliKcal: 3_010_000,
  basalMetabolicRateMilliKcal: 1_883_000,
  totalEnergyExpenditureMilliKcal: 3_012_000,
  lowerBoundMilliKcal: 1_883_000,
  deficitMilliKcal: null,
  maintenanceReason: 'gewaehlt',
  pace: null,
} as const;

/** Tempo der Zielversion: wie in `solo` „entspannt“ oder der Haltemodus (#176). */
type SoloGoal = 'tempo' | 'haltemodus';

/**
 * Ziele (Spezifikation 1): Zielversion, Wochenplan und die drei Tagesziele von heute (Mittwoch). Ohne
 * `thresholds` gelten Philipps Schwellen (`philippThresholds`).
 */
export const soloZieleOf = (plan: SoloWeeklyPlan, goal: SoloGoal = 'tempo', thresholds: SeedThresholds = philippThresholds): SeedPart => ({
  area: 'ziele',
  entities: [
    seedGoalVersion({
      id: seedIds.goalVersion.philipp,
      personId: philipp,
      createdAt: '2026-10-01T07:05:00.000Z',
      values: {
        validFrom: seedDays.zielstart,
        calorieBudgetMilliKcal: 2_417_875,
        basalMetabolicRateMilliKcal: 1_882_500,
        totalEnergyExpenditureMilliKcal: 2_917_875,
        lowerBoundMilliKcal: 1_882_500,
        deficitMilliKcal: 500_000,
        budgetSource: 'berechnet',
        calculationSex: 'maennlich',
        ageYears: 36,
        heightCm: 182,
        weightG: 92_000,
        activityLevel: 'maessig_aktiv',
        maintenanceReason: null,
        pace: 'entspannt',
        goalWeightG: 84_000,
        waterTargetMl: 2_500,
        weeklySportTargetMinutes: 150,
        ...(goal === 'haltemodus' ? haltemodus : {}),
      },
    }),
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
      thresholds,
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

/** Philipps Wasser von heute in `solo`; die Partner-Szenarien übernehmen es (#181). */
export const soloWaterToday: WaterToday = waterToday.solo;

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
export type SeedWeighing = Readonly<{ id: string; weight: number; at: string; localDate: string }>;

/** Zwei Wiegungen bis gestern: unter drei Tagesgewichten, also noch ohne Trend (#175, #176). Die Partner-Szenarien ergänzen frühere (#181). */
export const weighingsSolo: readonly SeedWeighing[] = [
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

/**
 * Was `solo` und seine Varianten unterscheidet: Wasser von heute, Sportwoche, Wochenplan, Messungen und Tempo;
 * die Varianten der Einstellungsseite „Ziele“ (#147) bringen Personenangaben, Zielversionen und Messungen mit.
 */
type SoloVariant = Readonly<{
  water: WaterToday;
  sport: readonly SportUnit[];
  plan: SoloWeeklyPlan;
  weights?: readonly SeedWeighing[];
  goal?: SoloGoal;
  goalSettings?: GoalSettingsVariant;
}>;

/** Eine Variante der Einstellungsseite „Ziele“ (#147) über `solo`. */
const goalSettingsVariant = (variant: GoalSettingsVariant): SoloVariant => ({
  water: waterToday.solo,
  sport: sportWeek.solo,
  plan: soloWeeklyPlan,
  weights: variant.weights,
  goalSettings: variant,
});

/**
 * `solo` und seine Varianten: `solo-wasser-*` zeigen die übrigen Status des Wasser-Mini-Trackers
 * (#171), `solo-sport-*` die des Sport-Mini-Trackers (#173), `solo-ohne-wiegetag` den
 * Gewichts-Mini-Tracker ohne Wiegetag im Wochenplan (#175), `solo-gewicht-*` und `solo-haltemodus` die
 * Randzustände des Gewichtstrends (#176). Die Varianten der Einstellungsseite „Ziele“ (#147) stehen in
 * `ziele-einstellungen.ts`.
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
  ...Object.fromEntries(Object.entries(goalSettingsVariants).map(([key, variant]) => [key, goalSettingsVariant(variant)])) as Record<
    keyof typeof goalSettingsVariants,
    SoloVariant
  >,
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
 * Leerzustände zeigt. Mit nur einer Mahlzeit bleibt „Ernährung erfasst“ (mindestens 3) offen. Die
 * Einträge am Vortag stehen in `soloErnaehrungVortag`.
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
 * Ernährung am Vortag (Spezifikation 2, Abschnitt 6; #156), nur in `solo` und seinen Varianten: Frühstück,
 * Mittagessen und Snacks, das Abendessen fehlt, damit die Person es im Protokoll nachtragen kann. Mit 423 kcal
 * liegt der Tag unter der Untergrenze; „Im Kalorienbudget“ von gestern bliebe damit offen. Ohne Fotofreigabe.
 * Werte je 100 g aus dem BLS 4.0 wie im Testkatalog der App (`apps/mobile/src/nutrition/testing/test-catalog.ts`).
 * Die Randzustände bauen ihren Vortag selbst und nutzen diesen Teil nicht.
 */
export const soloErnaehrungVortag: SeedPart = {
  area: 'ernaehrung',
  entities: [
    seedBlsEntry({
      id: seedIds.nutritionEntry.philippVortag[0], personId: philipp, at: '2026-10-13T06:15:00.000Z', localDate: seedDays.gestern, meal: 'fruehstueck',
      food: { key: 'C512600', name: 'Müslimischung Bircher Art (mit Trockenfrüchten und Nüssen) ungesüßt', milliKcal: 366_000, proteinMg: 11_800, carbsMg: 49_400, fatMg: 11_000 },
      grams: 60,
    }),
    seedBlsEntry({
      id: seedIds.nutritionEntry.philippVortag[1], personId: philipp, at: '2026-10-13T10:45:00.000Z', localDate: seedDays.gestern, meal: 'mittagessen',
      food: { key: 'X537063', name: 'Rotkohl mit Apfel gedünstet', milliKcal: 62_000, proteinMg: 1_010, carbsMg: 4_900, fatMg: 3_740 },
      grams: 200,
    }),
    seedBlsEntry({
      id: seedIds.nutritionEntry.philippVortag[2], personId: philipp, at: '2026-10-13T14:00:00.000Z', localDate: seedDays.gestern, meal: 'snacks',
      food: { key: 'F506100', name: 'Granatapfel roh', milliKcal: 79_000, proteinMg: 700, carbsMg: 16_100, fatMg: 600 },
      grams: 100,
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
const soloPartsWith = ({ water, sport, plan, weights, goal, goalSettings }: SoloVariant): readonly SeedPart[] => [
  goalSettings === undefined ? soloFundament : soloFundamentWith(goalSettings.person),
  goalSettings === undefined ? soloZieleOf(plan, goal) : withGoalVersions(soloZieleOf(plan), goalSettings.goals),
  soloTrackerOf(water, sport, weights),
  soloErnaehrung,
  soloErnaehrungVortag,
];

/** Die Ziele von `solo` mit anderen Zielversionen; Wochenplan und Tagesziele von heute bleiben. */
function withGoalVersions(part: SeedPart, goals: readonly SeedEntity[]): SeedPart {
  return { area: part.area, entities: [...goals, ...part.entities.filter((entity) => entity.table !== 'goal_version')] };
}

/** Beiträge von `solo`; `gekoppelt` übernimmt sie als Philipps Daten. */
export const soloParts = soloPartsWith(soloVariants.solo);

/** `solo` oder eine seiner Varianten (`SoloVariant`). */
function soloScenario(scenario: SoloScenario): SeedManifest {
  const state = buildSeedState({
    parts: [...soloPartsWith(soloVariants[scenario]), soloEigeneLebensmittel, sportVorwoche],
    createdAt: seedClock.instant,
    devices: { [seedInstallations.philippIphone.key]: { personId: philipp, cursor: 'latest' } },
  });
  return SeedManifest.parse({
    formatVersion: 1,
    scenario,
    // Revision 9: Ernährungseinträge am Vortag ohne Abendessen seit #156.
    // Revision 8: Sporteinträge der Vorwoche samt einem Tag mit zwei Einheiten seit #174.
    // Revision 7: unentschiedene Erlaubnis für Mitteilungen auf dem iPhone seit #125.
    // Revision 6: eigene Lebensmittel seit #157 (ein eigenes mit Portion, eine BLS-Korrektur).
    // Revision 5: Sporteinträge seit #173 im Änderungsprotokoll, eine Einheit mehr am Montag.
    // Revision 4: Gewichtseinträge seit #175 im Änderungsprotokoll, heute ist Wiegetag. Revision 3:
    // Philipps Frühstück aus der Suche seit #155; Revision 2: Wassereinträge seit #171 im Änderungsprotokoll.
    revision: 9,
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

/** `solo` und seine Varianten (#171, #173, #175, #176, #147). */
export const soloManifests = Object.fromEntries(
  (Object.keys(soloVariants) as SoloScenario[]).map((scenario) => [scenario, soloScenario(scenario)]),
) as Readonly<Record<SoloScenario, SeedManifest>>;

