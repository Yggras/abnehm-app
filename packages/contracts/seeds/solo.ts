import { buildSeedState, seedCreated as created, seedDay as day, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest } from './manifest.ts';

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
} as const;

const snapshot = (slot: 1 | 2 | 3) => ({
  personId: philipp,
  localDate: seedDays.heute,
  slot,
  timeZone: seedClock.timeZone,
  dayEndsAt: seedDayEnds.heute,
});

/** Ziele (Spezifikation 1): Zielversion, Wochenplan und die drei Tagesziele von heute (Mittwoch). */
const ziele: SeedPart = {
  area: 'ziele',
  entities: [
    {
      table: 'goal_version',
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
    {
      table: 'weekly_plan_version',
      ownerPersonId: philipp,
      row: { id: seedIds.weeklyPlanVersion.philipp, person_id: philipp, valid_from: seedDays.zielstart, ...created('2026-10-01T07:05:00.000Z') },
      children: {
        weekly_plan_day: Object.entries(weeklyPlan).map(([weekday, [baustein1, baustein2, baustein3]]) => ({
          weekly_plan_version_id: seedIds.weeklyPlanVersion.philipp,
          person_id: philipp,
          weekday,
          baustein_1: baustein1,
          baustein_2: baustein2,
          baustein_3: baustein3,
        })),
      },
    },
    ...weeklyPlan.mittwoch.map((baustein, index) => {
      const slot = (index + 1) as 1 | 2 | 3;
      const thresholds: Readonly<Record<string, number>> = {
        ernaehrung_erfasst: { minimumMealCategories: 3 },
        wasserziel: { targetMl: 2_500 },
        sporteinheit: { minimumSingleSessionMinutes: 20 },
      }[baustein];
      return {
        table: 'daily_goal',
        ownerPersonId: philipp,
        row: {
          id: seedIds.dailyGoal.philippHeute[index] as string,
          person_id: philipp,
          ...day(seedDays.heute),
          slot,
          baustein,
          snapshot: { type: baustein, ...snapshot(slot), ...thresholds },
          day_ends_at: seedDayEnds.heute,
          created_at: '2026-10-14T05:00:00.000Z',
        },
      };
    }),
  ],
};

/** Tracker (Spezifikation 3): zwei Gläser Wasser heute, eine Radtour gestern, zwei Wiegungen. */
const tracker: SeedPart = {
  area: 'tracker',
  entities: [
    ...[
      { id: seedIds.waterEntry.philippHeute[0], amount: 500, at: '2026-10-14T06:30:00.000Z' },
      { id: seedIds.waterEntry.philippHeute[1], amount: 750, at: '2026-10-14T10:15:00.000Z' },
    ].map(({ id, amount, at }) => ({
      table: 'water_entry',
      ownerPersonId: philipp,
      row: { id, person_id: philipp, amount_ml: amount, origin: 'manuell', logged_at: at, ...day(seedDays.heute), ...created(at) },
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
        origin: 'manuell',
        external_key: null,
        source_app_id: null,
        source_app_name: null,
        hidden_at: null,
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
        origin: 'manuell',
        external_key: null,
        source_app_id: null,
        source_app_name: null,
        hidden_at: null,
        ...day(localDate),
        ...created(at),
      },
    })),
  ],
};

/** Beiträge des Szenarios in Reihenfolge; ein Bereich ergänzt hier seinen Beitrag. */
export const soloParts: readonly SeedPart[] = [fundament, ziele, tracker];

const state = buildSeedState({
  parts: soloParts,
  createdAt: seedClock.instant,
  devices: { [seedInstallations.philippIphone.key]: { personId: philipp, cursor: 'latest' } },
});

export const soloManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'solo',
  revision: 1,
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
