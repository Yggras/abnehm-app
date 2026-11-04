import { buildSeedState, type SeedPart } from './build.ts';
import { gekoppeltExtensions, vorDemSchluepfenParts } from './gekoppelt.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedExtensions, SeedManifest } from './manifest.ts';
import { seedCompletion, seedCreated as created, seedDailyGoals } from './rows.ts';
import { soloParts } from './solo.ts';

// Szenarien von Spezifikation 4, Abschnitt 13 (#180), mit denselben IDs, derselben Uhr und derselben
// Zone wie die übrigen Manifeste:
//
// - `solo-energie` („Laichkugel solo mit gesammelter Energie“): `solo`, dazu Philipps Tagesziele von
//   vorgestern und gestern mit je einer Erfüllung samt Gutschrift. Ohne Kopplung wartet Momo im Ei;
//   die zwei Energie aus den Tageszielen bleiben bei Philipp.
// - `rollenwahl-offen`: `gekoppelt` vor dem Schlüpfen. Die Insel wartet auf die Rollen, und Anna hat
//   vorgeschlagen, sich um die Natur zu kümmern; Philipp muss antworten.
//
// Alle Werte sind erfunden. Die Erfüllungen passen zu Philipps Einträgen aus `solo`: Gewogen hat er
// vorgestern (Montag), eine Radtour von 35 Minuten gestern (Dienstag) erfüllt die Sporteinheit.

const philipp = seedIds.person.philipp;
const anna = seedIds.person.anna;
const couplingId = seedIds.coupling.philippAnna;

/** Schwellen der Tagesziele wie in `solo`; das Kalorienbudget aus Philipps Zielversion, gerundet. */
const thresholds = {
  ernaehrung_erfasst: { minimumMealCategories: 3 },
  im_kalorienbudget: { budgetKcal: 2_418, lowerBoundKcal: 1_500 },
  wasserziel: { targetMl: 2_500 },
  sporteinheit: { minimumSingleSessionMinutes: 20 },
} as const;

/** Spiel: Tagesziele von vorgestern und gestern samt je einer Erfüllung mit Gutschrift (#105). */
const gesammelteEnergie: SeedPart = {
  area: 'spiel',
  entities: [
    ...seedDailyGoals({
      personId: philipp,
      ids: seedIds.dailyGoal.philippVorgestern,
      localDate: seedDays.vorgestern,
      dayEndsAt: seedDayEnds.vorgestern,
      createdAt: '2026-10-12T05:00:00.000Z',
      bausteine: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
      thresholds,
    }),
    ...seedCompletion({
      personId: philipp,
      dailyGoalId: seedIds.dailyGoal.philippVorgestern[2],
      localDate: seedDays.vorgestern,
      slot: 3,
      baustein: 'gewogen',
      at: '2026-10-12T05:30:00.000Z',
    }),
    ...seedDailyGoals({
      personId: philipp,
      ids: seedIds.dailyGoal.philippGestern,
      localDate: seedDays.gestern,
      dayEndsAt: seedDayEnds.gestern,
      createdAt: '2026-10-13T05:00:00.000Z',
      bausteine: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
      thresholds,
    }),
    ...seedCompletion({
      personId: philipp,
      dailyGoalId: seedIds.dailyGoal.philippGestern[2],
      localDate: seedDays.gestern,
      slot: 3,
      baustein: 'sporteinheit',
      at: '2026-10-13T16:35:00.000Z',
    }),
  ],
};

const soloEnergieState = buildSeedState({
  parts: [...soloParts, gesammelteEnergie],
  createdAt: seedClock.instant,
  devices: { [seedInstallations.philippIphone.key]: { personId: philipp, cursor: 'latest' } },
});

export const soloEnergieManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'solo-energie',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp],
  installations: [seedInstallations.philippIphone],
  initial: soloEnergieState,
  // Ein Sync ändert nichts: Das iPhone ist schon auf dem Stand des Servers.
  steps: [{ type: 'sync', installation: seedInstallations.philippIphone.key }],
  target: soloEnergieState,
});

/** Annas Vorschlag am Morgen: Sie kümmert sich um die Natur, Philipp baut. */
const proposedAt = '2026-10-14T07:00:00.000Z';

/** Spiel: Annas offene Rollenwahl (Spezifikation 4, Abschnitt 7). */
const offeneRollenwahl: SeedPart = {
  area: 'spiel',
  entities: [
    {
      table: 'shared_action',
      entityType: 'shared_action',
      couplingId,
      row: {
        id: seedIds.sharedAction.annasRollenwahl,
        coupling_id: couplingId,
        kind: 'rollenwahl',
        requester_person_id: anna,
        payload: { proposerRole: 'natur' },
        status: 'offen',
        decided_at: null,
        ...created(proposedAt),
      },
    },
  ],
};

const rollenwahlOffenState = buildSeedState({
  parts: [...vorDemSchluepfenParts, offeneRollenwahl],
  createdAt: seedClock.instant,
  devices: {
    [seedInstallations.philippIphone.key]: { personId: philipp, cursor: 'latest' },
    [seedInstallations.annaAndroid.key]: { personId: anna, cursor: 'latest' },
  },
});

export const rollenwahlOffenManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'rollenwahl-offen',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  initial: rollenwahlOffenState,
  // Ein Sync ändert nichts: Beide Geräte sind auf dem Stand, und die Projektionen sind zur festen Uhr frisch.
  steps: [
    { type: 'sync', installation: seedInstallations.philippIphone.key },
    { type: 'sync', installation: seedInstallations.annaAndroid.key },
  ],
  target: rollenwahlOffenState,
  // Vor dem Schlüpfen gibt es kein Deko-Geschenk; die Mahlzeitenfotos gelten wie in `gekoppelt`.
  extensions: SeedExtensions.parse({ mealPhotos: gekoppeltExtensions.mealPhotos }),
});
