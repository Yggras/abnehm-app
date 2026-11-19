import { EntityId, LocalDate } from '../src/base.ts';
import { weeklyPlanVersionId } from '../src/plan.ts';
import { buildSeedState, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedRow, type SeedScenarioKey, type SeedState } from './manifest.ts';
import { seedWeeklyPlan, type SeedWeeklyPlan } from './rows.ts';
import { calculatedGoalVersion } from './ziele-einstellungen.ts';

// Szenarien zum Fortsetzen des Onboardings aus Spezifikation 1, Abschnitt 12 (#146). Philipp mit den IDs
// und Körperdaten aus `solo` (männlich, geboren 17.05.1990, 182 cm, 92 kg, mäßig aktiv), aber mitten im
// Onboarding: `onboarding_status = begonnen`, den Hinweis aus Schritt 1 hat er heute bestätigt. Alles ist
// erfunden.
// - `onboarding-unterbrochen`: Auf dem iPhone hat er die Schritte 3–5 ausgefüllt und dann abgebrochen. Der
//   Server kennt nur die Person; Eingaben und Schritt stehen im Gerätezustand (`device_state`), wie ihn das
//   Onboarding-Modul ablegt (`onboarding_draft`, `onboarding_step` in `apps/mobile/src/onboarding/`). Die App
//   setzt bei Schritt 6 „Zielgewicht und Tempo“ fort.
// - `zweites-geraet`: Auf dem iPhone hat er heute den Plan gespeichert (Schritt 8) und dann aufgehört. Der
//   Server kennt die Person mit allen Angaben, die Zielversion und die Wochenplanversion ab heute. Er meldet
//   sich auf dem iPad an, das noch nichts hat; nach dem ersten Pull setzt die App dort bei Schritt 9 fort.
//   Tagesziele von heute legt das iPad selbst an (deterministische IDs, Spezifikation 1, Abschnitt 5).

const philipp = seedIds.person.philipp;
const disclaimerAt = '2026-10-14T11:30:00.000Z';

/** Die Person im Onboarding; nach Schritt 8 trägt sie die Körperdaten, davor nur Anzeigename und Bestätigung. */
function person(planSavedAt: string | null): SeedPart {
  const body = planSavedAt === null
    ? { calculation_sex: null, birth_date: null, height_cm: null, activity_level: null, pregnant_or_breastfeeding: null, known_eating_disorder: null }
    : { calculation_sex: 'maennlich', birth_date: '1990-05-17', height_cm: 182, activity_level: 'maessig_aktiv', pregnant_or_breastfeeding: false, known_eating_disorder: false };
  return {
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
          ...body,
          disclaimer_accepted_at: disclaimerAt,
          onboarding_status: 'begonnen',
          onboarding_completed_at: null,
          goal_weight_reached_g: null,
          goal_weight_reached_at: null,
          time_zone: seedClock.timeZone,
          created_at: '2026-10-14T11:28:00.000Z',
          updated_at: planSavedAt ?? disclaimerAt,
          deleted_at: null,
        },
      },
    ],
  };
}

/** Lokaler Entwurf nach Schritt 5: Körperdaten samt `entryId` des Startgewichts, Sicherheits-Check und Aktivitätsstufe. */
const draftAfterStepFive = {
  calculationSex: 'maennlich',
  birthDate: '1990-05-17',
  heightCm: 182,
  weightG: 92_000,
  startWeightEntryId: seedIds.weightEntry.philippOnboardingEntwurf,
  pregnantOrBreastfeeding: false,
  knownEatingDisorder: false,
  activityLevel: 'maessig_aktiv',
} as const;

/** Der Gerätezustand des iPhones: Entwurf und der Schritt, an dem er abgebrochen hat. */
const interruptedDeviceState: readonly SeedRow[] = [
  { key: 'onboarding_draft', value: draftAfterStepFive, updated_at: '2026-10-14T11:56:00.000Z' },
  { key: 'onboarding_step', value: 'zielgewicht', updated_at: '2026-10-14T11:56:00.000Z' },
];

function withDeviceState(state: SeedState, installation: string, rows: readonly SeedRow[]): SeedState {
  const device = state.devices[installation]!;
  return { server: state.server, devices: { ...state.devices, [installation]: { ...device, rows: { ...device.rows, device_state: [...rows] } } } };
}

const iphone = seedInstallations.philippIphone.key;
const interrupted = withDeviceState(
  buildSeedState({ parts: [person(null)], createdAt: seedClock.instant, devices: { [iphone]: { personId: philipp, cursor: 'latest' } } }),
  iphone,
  interruptedDeviceState,
);

/** Der Standard-Wochenplan aus Schritt 8 mit der Vorauswahl: Sport Di/Do/Sa, Wiegetag Montag. */
const standardWeek = {
  montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
  dienstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  donnerstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  freitag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  samstag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  sonntag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
} as const satisfies SeedWeeklyPlan;

const planSavedAt = '2026-10-14T11:40:00.000Z';
const ipad = seedInstallations.philippIpad.key;
const heute = LocalDate.parse(seedDays.heute);

/** Zielversion und Wochenplanversion ab heute aus Schritt 8 auf dem iPhone. */
const ziele: SeedPart = {
  area: 'ziele',
  entities: [
    calculatedGoalVersion(heute, planSavedAt, {}),
    seedWeeklyPlan({ id: weeklyPlanVersionId(EntityId.parse(philipp), heute), personId: philipp, validFrom: seedDays.heute, createdAt: planSavedAt, plan: standardWeek }),
  ],
};

const secondDevice = buildSeedState({
  parts: [person(planSavedAt), ziele],
  createdAt: seedClock.instant,
  devices: { [ipad]: { personId: philipp, cursor: 'latest' } },
});

function manifest(scenario: SeedScenarioKey, installation: typeof iphone | typeof ipad, state: SeedState): SeedManifest {
  return SeedManifest.parse({
    formatVersion: 1,
    scenario,
    revision: 1,
    clock: seedClock,
    localDates: seedDays,
    catalogVersion: null,
    accounts: [seedAccounts.philipp],
    installations: [installation === iphone ? seedInstallations.philippIphone : seedInstallations.philippIpad],
    initial: state,
    // Ein Sync ändert nichts: Das Gerät ist schon auf dem Stand des Servers, Entwurf und Schritt bleiben Gerätezustand.
    steps: [{ type: 'sync', installation }],
    target: state,
  });
}

/** „Onboarding unterbrochen“ und „zweites Gerät“ (Spezifikation 1, Abschnitt 12; #146). */
export const onboardingManifests = {
  'onboarding-unterbrochen': manifest('onboarding-unterbrochen', iphone, interrupted),
  'zweites-geraet': manifest('zweites-geraet', ipad, secondDevice),
} as const satisfies Partial<Record<SeedScenarioKey, SeedManifest>>;
