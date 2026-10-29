import { buildSeedState, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedScenarioKey } from './manifest.ts';
import { seedCreated as created, seedDailyGoals, seedDay as day, seedManualOrigin, seedWeeklyPlan, type SeedWeeklyPlan } from './rows.ts';

// Szenario `solo` (Spezifikation 0, Abschnitt 12): Philipp hat das Onboarding abgeschlossen, ist
// nicht gekoppelt (Momo ist noch ein Ei: ohne Kopplung gibt es weder Rolle noch Insel), hat
// vollständige Ziele samt Wochenplan und den drei Tageszielen von heute sowie eigene Wasser-, Sport-
// und Gewichtseinträge. Das iPhone ist auf dem Stand des Servers, ohne offene Operationen; der
// Seed-Deep-Link führt direkt auf „Heute“. Alle Werte sind erfunden; die Zielwerte sind
// plausibel, aber nicht mit dem Zielrechner aus Spezifikation 1 berechnet.

const philipp = seedIds.person.philipp;

/** Fundament: die fertige Person ohne Kopplung. */
const fundament: SeedPart = {
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

const weeklyPlan = {
  montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
  dienstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  donnerstag: ['im_kalorienbudget', 'wasserziel', 'gewogen'],
  freitag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  samstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  sonntag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
} as const satisfies SeedWeeklyPlan;

/** Ziele (Spezifikation 1): Zielversion, Wochenplan und die drei Tagesziele von heute (Mittwoch). */
const ziele: SeedPart = {
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
        ...created('2026-10-01T07:05:00.000Z'),
      },
    },
    seedWeeklyPlan({
      id: seedIds.weeklyPlanVersion.philipp,
      personId: philipp,
      validFrom: seedDays.zielstart,
      createdAt: '2026-10-01T07:05:00.000Z',
      plan: weeklyPlan,
    }),
    ...seedDailyGoals({
      personId: philipp,
      ids: seedIds.dailyGoal.philippHeute,
      localDate: seedDays.heute,
      dayEndsAt: seedDayEnds.heute,
      createdAt: '2026-10-14T05:00:00.000Z',
      bausteine: weeklyPlan.mittwoch,
      thresholds: {
        ernaehrung_erfasst: { minimumMealCategories: 3 },
        wasserziel: { targetMl: 2_500 },
        sporteinheit: { minimumSingleSessionMinutes: 20 },
      },
    }),
  ],
};

/** Wasser heute, ohne Importe (Spezifikation 3, Abschnitt 9): Menge und Zeitpunkt je Eintrag. */
type WaterToday = readonly (readonly [amountMl: number, loggedAt: string])[];

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

type SoloScenario = keyof typeof waterToday;

/** Tracker (Spezifikation 3): Wasser heute je Szenario, eine Radtour gestern, zwei Wiegungen. */
const trackerOf = (water: WaterToday): SeedPart => ({
  area: 'tracker',
  entities: [
    ...water.map(([amount, at], index) => ({
      table: 'water_entry',
      // Seit #171 beim Sync angemeldet: Die Einträge stehen im Änderungsprotokoll.
      entityType: 'water_entry',
      ownerPersonId: philipp,
      row: { id: seedIds.waterEntry.philippHeute[index] as string, person_id: philipp, amount_ml: amount, origin: 'manuell', logged_at: at, ...day(seedDays.heute), ...created(at) },
    })),
    {
      table: 'sport_entry',
      ownerPersonId: philipp,
      row: {
        id: seedIds.sportEntry.philippGestern,
        person_id: philipp,
        activity_type: 'radfahren',
        override_activity_type: null,
        started_at: '2026-10-13T16:00:00.000Z',
        duration_minutes: 35,
        active_milli_kcal: null,
        ...seedManualOrigin,
        replaced_by_entry_id: null,
        reactivated_at: null,
        ...day(seedDays.gestern),
        ...created('2026-10-13T16:40:00.000Z'),
      },
    },
    ...[
      { id: seedIds.weightEntry.philippVorgestern, weight: 92_400, at: '2026-10-12T05:30:00.000Z', localDate: seedDays.vorgestern },
      { id: seedIds.weightEntry.philippHeute, weight: 91_800, at: '2026-10-14T05:45:00.000Z', localDate: seedDays.heute },
    ].map(({ id, weight, at, localDate }) => ({
      table: 'weight_entry',
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

/** Beiträge des Szenarios in Reihenfolge; ein Bereich ergänzt hier seinen Beitrag. */
const soloPartsWith = (water: WaterToday): readonly SeedPart[] => [fundament, ziele, trackerOf(water)];

/** Beiträge von `solo`; `gekoppelt` übernimmt sie als Philipps Daten. */
export const soloParts = soloPartsWith(waterToday.solo);

/** `solo` oder eine seiner Varianten; sie unterscheiden sich nur im Wasser von heute. */
function soloScenario(scenario: SoloScenario): SeedManifest {
  const state = buildSeedState({
    parts: soloPartsWith(waterToday[scenario]),
    createdAt: seedClock.instant,
    devices: { [seedInstallations.philippIphone.key]: { personId: philipp, cursor: 'latest' } },
  });
  return SeedManifest.parse({
    formatVersion: 1,
    scenario,
    // Revision 2: Wassereinträge stehen seit #171 im Änderungsprotokoll.
    revision: 2,
    clock: seedClock,
    localDates: seedDays,
    catalogVersion: null,
    accounts: [seedAccounts.philipp],
    installations: [seedInstallations.philippIphone],
    initial: state,
    // Ein Sync ändert nichts: Das iPhone ist schon auf dem Stand des Servers.
    steps: [{ type: 'sync', installation: seedInstallations.philippIphone.key }],
    target: state,
  });
}

/** `solo` und seine Varianten für jeden Status des Wasser-Mini-Trackers (#171). */
export const soloManifests = Object.fromEntries(
  (Object.keys(waterToday) as SoloScenario[]).map((scenario) => [scenario, soloScenario(scenario)]),
) as Readonly<Record<SoloScenario, SeedManifest>>;

