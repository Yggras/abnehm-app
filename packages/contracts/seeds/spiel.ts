import { EntityId, LocalDate } from '../src/base.ts';
import { BuildObject, buildObjectKey } from '../src/island.ts';
import { currentSyncSchemaVersion, OutboxOperation } from '../src/sync.ts';
import { buildSeedState, changedOnServer, type SeedEntity, type SeedPart } from './build.ts';
import { gekoppeltExtensions, gekoppeltParts, gekoppeltPartsBuilt, vorDemSchluepfenParts } from './gekoppelt.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedExtensions, SeedManifest, type SeedState } from './manifest.ts';
import { seedCompletion, seedCreated as created, seedDailyGoals } from './rows.ts';
import { soloParts } from './solo.ts';
import { buildEntities, fieldIdOf, gekoppeltBauten, haelfteVollBauten, progressOf, type SeedBuild } from './spielverlauf.ts';
import { afterSync, changedOffline, processed, type OfflineChange } from './sync-szenarien.ts';

// Szenarien von Spezifikation 4, Abschnitt 13 (#180), mit denselben IDs, derselben Uhr und derselben
// Zone wie die übrigen Manifeste:
//
// - `solo-energie` („Laichkugel solo mit gesammelter Energie“): `solo`, dazu Philipps Tagesziele von
//   vorgestern und gestern mit je einer Erfüllung samt Gutschrift. Ohne Kopplung wartet Momo im Ei;
//   die zwei Energie aus den Tageszielen bleiben bei Philipp.
// - `rollenwahl-offen`: `gekoppelt` vor dem Schlüpfen. Die Insel wartet auf die Rollen, und Anna hat
//   vorgeschlagen, sich um die Natur zu kümmern; Philipp muss antworten.
// - `haelfte-voll` („eigene Hälfte voll, Momo wartet“, #191): `gekoppelt`, dazu hat Philipp heute zwei
//   Laternen mehr gebaut. Mit 36 verbaut ist seine Hälfte auf Level 3 voll, Annas mit 29 nicht: Momo wartet
//   auf Anna. Philipp hat noch 17 Energie.
// - `doppelausgabe` („Doppelausgabe auf zwei Geräten“, #191): `gekoppelt` mit iPhone und iPad von Philipp,
//   beide mit 23 Energie. Offline baut jedes Gerät vier Laternen, zusammen 24. Der Server nimmt alle acht
//   an, denn die Schutzgrenze liegt bei −30. Danach steht Philipp bei −1, beide Geräte zeigen 0 Energie.
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
  // Revision 2: Mahlzeitenfotos seit #162 im Änderungsprotokoll, mit Bilddaten und abgelaufenem Fotoentwurf.
  revision: 2,
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

const iphone = seedInstallations.philippIphone.key;
const ipad = seedInstallations.philippIpad.key;
const android = seedInstallations.annaAndroid.key;

const haelfteVollState = buildSeedState({
  parts: gekoppeltPartsBuilt(haelfteVollBauten),
  createdAt: seedClock.instant,
  devices: {
    [iphone]: { personId: philipp, cursor: 'latest' },
    [android]: { personId: anna, cursor: 'latest' },
  },
});

export const haelfteVollManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'haelfte-voll',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  initial: haelfteVollState,
  // Ein Sync ändert nichts: Beide Geräte sind auf dem Stand, und die Projektionen sind zur festen Uhr frisch.
  steps: [
    { type: 'sync', installation: iphone },
    { type: 'sync', installation: android },
  ],
  target: haelfteVollState,
  extensions: gekoppeltExtensions,
});

/** Die Geräte gehen zur Uhr des Manifests online; zu ihr nimmt der Server alles an. */
const now = seedClock.instant;
const today = LocalDate.parse(seedDays.heute);

/** Je Gerät vier Laternen in Philipps Ecke, die in `gekoppelt` noch frei ist: das iPhone ab 11:00, das iPad ab 11:10. */
const doppelBauten = {
  iphone: [0, 1, 2, 3].map((x): SeedBuild => ({ personId: philipp, fieldKey: `grundinsel:${x}:3`, blueprintKey: 'laterne', at: `2026-10-14T11:0${x}:00.000Z` })),
  ipad: [0, 1, 2, 3].map((x): SeedBuild => ({ personId: philipp, fieldKey: `grundinsel:${x}:4`, blueprintKey: 'laterne', at: `2026-10-14T11:1${x}:00.000Z` })),
};
/** Laufende Nummern der Bauten nach denen aus `gekoppelt` und `haelfte-voll`. */
const firstBuild = haelfteVollBauten.length + 1;
const numberOf = (device: 'iphone' | 'ipad', index: number) => firstBuild + (device === 'ipad' ? doppelBauten.iphone.length : 0) + index;

/** Ein Offline-Bau, wie ihn der Spieldienst schreibt: Objekt und Buchung ohne Serverversion, dazu `buildObject`. */
function offlineBuild(build: SeedBuild, n: number, operationId: string): OfflineChange {
  const [object, debit] = buildEntities(build, n, today);
  const payload = BuildObject.parse({
    commandId: seedIds.buildCommand(n),
    islandObjectId: seedIds.islandObject(n),
    fieldId: fieldIdOf(build.fieldKey),
    blueprintKey: build.blueprintKey,
    localDate: today,
  });
  return {
    rows: [object!, debit!].map(({ table, row }) => ({ table, row: { ...row, server_version: null } })),
    operation: OutboxOperation.parse({
      type: 'buildObject',
      operationId,
      businessKey: buildObjectKey(EntityId.parse(payload.commandId)),
      payload,
      knownServerVersion: null,
      schemaVersion: currentSyncSchemaVersion,
      createdAt: build.at,
    }),
  };
}

/**
 * Was der Server je Bau schreibt, in Eingangsreihenfolge: Objekt und Buchung zu seiner Uhr, dann den neu
 * berechneten Inselfortschritt. Dessen Anlagezeit bleibt die aus `gekoppelt`.
 */
function serverBuild(state: SeedState, build: SeedBuild, n: number, accepted: readonly SeedBuild[]): SeedEntity[] {
  const [object, debit] = buildEntities({ ...build, at: now }, n, today);
  const current = state.server.island_progress?.find((row) => row.id === seedIds.islandProgress.philippAnna);
  if (current === undefined) throw new Error('Seed: Inselfortschritt fehlt');
  const { level, levelNeed, members } = progressOf(accepted);
  const content = { ...(current.content as Record<string, unknown>), members };
  // Die Serverversion vergibt `changedOnServer`.
  const row = Object.fromEntries(Object.entries(current).filter(([column]) => column !== 'server_version'));
  return [object!, debit!, {
    table: 'island_progress',
    entityType: 'island_progress',
    couplingId: seedIds.coupling.philippAnna,
    row: { ...row, level, level_need: levelNeed, content, data_as_of: now, updated_at: now },
  }];
}

function doppelausgabe() {
  const ops = seedIds.operation.doppelausgabe;
  const synced = buildSeedState({
    parts: gekoppeltParts,
    createdAt: now,
    devices: { [iphone]: { personId: philipp, cursor: 'latest' }, [ipad]: { personId: philipp, cursor: 'latest' } },
  });
  const initial = changedOffline(
    changedOffline(synced, iphone, doppelBauten.iphone.map((build, index) => offlineBuild(build, numberOf('iphone', index), ops.iphone[index]!))),
    ipad,
    doppelBauten.ipad.map((build, index) => offlineBuild(build, numberOf('ipad', index), ops.ipad[index]!)),
  );
  // Erst der Batch des iPhones, dann der des iPads; jeder Bau berechnet den Fortschritt aus allen bisherigen.
  const arrivals = [
    ...doppelBauten.iphone.map((build, index) => ({ build, n: numberOf('iphone', index), operationId: ops.iphone[index]! })),
    ...doppelBauten.ipad.map((build, index) => ({ build, n: numberOf('ipad', index), operationId: ops.ipad[index]! })),
  ];
  const changes = arrivals.flatMap(({ build, n }, index) =>
    serverBuild(initial, build, n, [...gekoppeltBauten, ...arrivals.slice(0, index + 1).map((arrival) => arrival.build)]),
  );
  const server = changedOnServer(initial, { createdAt: now, changes });
  const target = afterSync(
    server,
    arrivals.map(({ n, operationId }) => processed(operationId, 'applied', { command: 'buildObject', businessKey: buildObjectKey(EntityId.parse(seedIds.buildCommand(n))) })),
    [iphone, ipad],
  );
  return { initial, target };
}

const doppelausgabeStates = doppelausgabe();

export const doppelausgabeManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'doppelausgabe',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.philippIpad],
  initial: doppelausgabeStates.initial,
  // Erst das iPhone, dann das iPad, zuletzt noch einmal das iPhone: Danach kennen beide alle acht Bauten.
  steps: [
    { type: 'sync', installation: iphone },
    { type: 'sync', installation: ipad },
    { type: 'sync', installation: iphone },
  ],
  target: doppelausgabeStates.target,
  extensions: gekoppeltExtensions,
});
