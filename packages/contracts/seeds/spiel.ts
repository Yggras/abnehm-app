import { areaOccasionKey, areaUnlockAt, discoveryStatus } from '@abnehm/game-rules/areas';
import { gameCatalog } from '@abnehm/game-rules/content';
import { openVisitFacts, planVisitors, visitorSlotOf } from '@abnehm/game-rules/events';
import { levelOccasionKey } from '@abnehm/game-rules/unlocks';

import { EntityId, LocalDate } from '../src/base.ts';
import { BuildObject, buildObjectKey, PlaceObject, placeObjectKey } from '../src/island.ts';
import { DiscoveryEventDetails, islandContentId, islandEventId, islandEventStateId } from '../src/island-records.ts';
import { notificationIntentId } from '../src/notifications.ts';
import { currentSyncSchemaVersion, OutboxOperation } from '../src/sync.ts';
import { buildSeedState, changedOnServer, pulledBy, withDeviceState, type SeedEntity, type SeedPart } from './build.ts';
import { visitEntities, visitWish, type SeedVisit } from './ereignisse.ts';
import { gekoppeltExtensions, gekoppeltParts, gekoppeltPartsBuilt, gekoppeltPartsVisited, vorDemSchluepfenParts } from './gekoppelt.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedExtensions, SeedManifest, type SeedRow, type SeedState } from './manifest.ts';
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
// - `feldkonflikt` („Feldkonflikt mit Verdrängung ins Lager“, #194): `gekoppelt` mit iPhone und iPad von
//   Philipp. Offline stellt das iPhone seine erste Laterne auf das freie Feld `grundinsel:2:2`, das iPad
//   die zweite auf dasselbe Feld. Der Server nimmt beide an, in Eingangsreihenfolge: Die zuerst platzierte
//   Laterne wechselt ins Lager, die zweite steht auf dem Feld. Keine Energie geht verloren.
// - `levelaufstieg-ausstehend` („Levelaufstieg ausstehend vor und nach dem Pull“, #200): `haelfte-voll` mit
//   Philipps iPhone und Annas Android. Offline hat Anna zwei Apfelbäume und einen Beerenstrauch gebaut; mit
//   37 verbaut ist auch ihre Hälfte voll. Vor dem Sync zeigt Philipps iPhone Level 3 und „Momo wartet auf
//   Anna“. Annas Sync hebt die Insel mit dem dritten Bau auf Level 4: Ereignis `level:<insel>:4` und je ein
//   Push-Intent an beide. Philipps Pull bringt Level 4 und das Ereignis auf sein iPhone. Level 4 ist ein Formlevel:
//   Mit dem Aufstieg kommen die Schilfwiese, die Entdeckung mit je einem Ereignisstand und ein `gebiet`-Push an
//   beide (#204).
// - `formwechsel` („Formwechsel bei Level 4“, #204): der Stand von `levelaufstieg-ausstehend` nach beiden Syncs;
//   im Tab „Momo“ steht die Verwandlung von der Kaulquappe zum Hüpfer noch aus.
// - `ereignisse-voll` („volles Ereignis-Kontingent (4 offen)“, #202): `gekoppelt` ohne die Besucher von
//   heute. Philipp hat vier Besuche der letzten vier Tage nicht abgeholt, Anna einen von gestern. Philipps
//   Pull am Mittag erzeugt die Besucher des Tages: Philipp bekommt wegen der Grenze von 4 offenen keinen,
//   Anna einen; ihren Ereignisstand sieht nur sie.
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

/** Das in `gekoppelt` freie Feld, auf das beide Geräte offline eine Laterne stellen. */
const konfliktFeld = fieldIdOf('grundinsel:2:2');

/** Je Gerät eine Platzierung: das iPhone die Laterne von `grundinsel:0:0`, das iPad die von `grundinsel:1:0`. */
const konfliktZuege = [
  { installation: iphone, n: 1, operationId: seedIds.operation.feldkonflikt.iphone, at: '2026-10-14T11:00:00.000Z' },
  { installation: ipad, n: 2, operationId: seedIds.operation.feldkonflikt.ipad, at: '2026-10-14T11:10:00.000Z' },
] as const;

/** Eine Zeile der Tabelle, gesucht über ihre ID. */
function rowOf(rows: Readonly<Record<string, readonly SeedRow[]>>, table: string, id: string): SeedRow {
  const row = rows[table]?.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`Seed: ${table} ${id} fehlt`);
  return row;
}

/** Eine Offline-Platzierung, wie der Spieldienst sie schreibt: neues Feld und Änderungszeit, die Serverversion bleibt, dazu `placeObject`. */
function offlinePlace(state: SeedState, { installation, n, operationId, at }: (typeof konfliktZuege)[number]): OfflineChange {
  const row = rowOf(state.devices[installation]!.rows, 'island_object', seedIds.islandObject(n));
  const payload = PlaceObject.parse({ commandId: seedIds.placeCommand(n), islandObjectId: row.id, fromFieldId: row.field_id, target: { type: 'feld', fieldId: konfliktFeld } });
  return {
    rows: [{ table: 'island_object', row: { ...row, field_id: konfliktFeld, updated_at: at } }],
    operation: OutboxOperation.parse({
      type: 'placeObject',
      operationId,
      businessKey: placeObjectKey(EntityId.parse(payload.commandId)),
      payload,
      knownServerVersion: row.server_version,
      schemaVersion: currentSyncSchemaVersion,
      createdAt: at,
    }),
  };
}

/** Ein Inselobjekt, wie der Server es mit seiner Uhr neu schreibt; die Serverversion vergibt `changedOnServer`. */
function serverPlaced(state: SeedState, n: number, fieldId: string | null): SeedEntity {
  const row = Object.fromEntries(Object.entries(rowOf(state.server, 'island_object', seedIds.islandObject(n))).filter(([column]) => column !== 'server_version'));
  return { table: 'island_object', entityType: 'island_object', couplingId, row: { ...row, field_id: fieldId, updated_at: now } };
}

function feldkonflikt() {
  const synced = buildSeedState({
    parts: gekoppeltParts,
    createdAt: now,
    devices: { [iphone]: { personId: philipp, cursor: 'latest' }, [ipad]: { personId: philipp, cursor: 'latest' } },
  });
  const initial = konfliktZuege.reduce((state, zug) => changedOffline(state, zug.installation, [offlinePlace(synced, zug)]), synced);
  // Erst das iPhone: seine Laterne kommt aufs Feld. Dann das iPad: Seine Laterne verdrängt die des iPhones ins Lager.
  const server = changedOnServer(initial, {
    createdAt: now,
    changes: [serverPlaced(initial, 1, konfliktFeld), serverPlaced(initial, 1, null), serverPlaced(initial, 2, konfliktFeld)],
  });
  const target = afterSync(
    server,
    konfliktZuege.map(({ n, operationId }) => processed(operationId, 'applied', { command: 'placeObject', businessKey: placeObjectKey(EntityId.parse(seedIds.placeCommand(n))) })),
    [iphone, ipad],
  );
  return { initial, target };
}

const feldkonfliktStates = feldkonflikt();

export const feldkonfliktManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'feldkonflikt',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.philippIpad],
  initial: feldkonfliktStates.initial,
  // Erst das iPhone, dann das iPad, zuletzt noch einmal das iPhone: Danach zeigen beide dieselbe Insel.
  steps: [
    { type: 'sync', installation: iphone },
    { type: 'sync', installation: ipad },
    { type: 'sync', installation: iphone },
  ],
  target: feldkonfliktStates.target,
  extensions: gekoppeltExtensions,
});

/**
 * `ereignisse-voll`: Philipp hat seit vier Tagen je einen Besuch nicht abgeholt, Anna seit gestern einen.
 * Die Besuchs-Baupläne von Bauen sind alle versprochen, der vierte Besuch bringt deshalb Deko.
 */
const vollBesuche: readonly SeedVisit[] = [
  ...(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'] as const).map((date, index): SeedVisit => ({
    personId: philipp,
    date,
    n: 1,
    templateKey: ['igel_ilse', 'fuchs_fridolin', 'schwan_selma', 'eule_otto'][index]!,
    details: [
      visitWish('sitzbank', { type: 'bauplan', key: 'brunnen' }),
      visitWish('holzweg', { type: 'bauplan', key: 'vogelhaus' }),
      visitWish('sitzbank', { type: 'bauplan', key: 'wegweiser' }),
      visitWish('holzweg', { type: 'deko', key: 'kieselturm' }),
    ][index]!,
    at: `${date}T05:30:00.000Z`,
  })),
  { personId: anna, date: '2026-10-13', n: 2, templateKey: 'hase_hanna', details: visitWish('blumenwiese', { type: 'bauplan', key: 'kuerbisbeet' }), at: '2026-10-13T05:30:00.000Z' },
];

/**
 * Was der Ereignisgenerator beim ersten Pull des Tages erzeugt, mit denselben Spielregeln wie der Server:
 * Philipp hat 4 offene und bekommt nichts, Anna füllt mit einem Besuch den Tagesdeckel auf.
 */
function heutigeBesuche(): SeedVisit[] {
  const open = vollBesuche;
  const built = (personId: string) => new Set(gekoppeltBauten.filter((build) => build.personId === personId).map((build) => build.blueprintKey));
  const planned = planVisitors(gameCatalog, {
    islandId: seedIds.island.philippAnna,
    date: seedDays.heute,
    cappedToday: 0,
    visitorSlotsUsed: new Set(),
    unlockedBlueprints: new Set(gameCatalog.blueprints.filter((blueprint) => blueprint.origin === 'start').map((blueprint) => blueprint.key)),
    ...openVisitFacts(open),
    persons: [
      { personId: philipp, role: 'bauen', personalToday: 0, openPersonal: open.filter((visit) => visit.personId === philipp).length, builtBlueprints: built(philipp) },
      { personId: anna, role: 'natur', personalToday: 0, openPersonal: open.filter((visit) => visit.personId === anna).length, builtBlueprints: built(anna) },
    ],
  });
  return planned.map((visit) => ({
    personId: visit.responsiblePersonId,
    date: seedDays.heute,
    n: visitorSlotOf(visit.occasionKey, seedDays.heute)!,
    templateKey: visit.templateKey,
    details: visit.details,
    at: now,
  }));
}

function ereignisseVoll() {
  const initial = buildSeedState({
    parts: gekoppeltPartsVisited(vollBesuche),
    createdAt: seedClock.instant,
    devices: { [iphone]: { personId: philipp, cursor: 'latest' } },
  });
  const server = changedOnServer(initial, { createdAt: now, changes: heutigeBesuche().flatMap(visitEntities) });
  return { initial, target: pulledBy(server, iphone, philipp) };
}

const ereignisseVollStates = ereignisseVoll();

export const ereignisseVollManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'ereignisse-voll',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone],
  initial: ereignisseVollStates.initial,
  // Philipps Pull erzeugt die Besucher des Tages: nur Annas; ihren Ereignisstand sieht Philipps Gerät nicht.
  steps: [{ type: 'sync', installation: iphone }],
  target: ereignisseVollStates.target,
  extensions: gekoppeltExtensions,
});

/**
 * Annas Offline-Bauten in `levelaufstieg-ausstehend`, in ihrer Ecke: 29 + 3 + 3 + 2 = 37 verbaut, über
 * Schwelle(4) = 36. Kein Bau erfüllt ihren Besucherwunsch von heute (Blumenwiese).
 */
const annasLueckenBauten: readonly SeedBuild[] = [
  { personId: anna, fieldKey: 'grundinsel:14:2', blueprintKey: 'apfelbaum', at: '2026-10-14T11:00:00.000Z' },
  { personId: anna, fieldKey: 'grundinsel:15:2', blueprintKey: 'apfelbaum', at: '2026-10-14T11:01:00.000Z' },
  { personId: anna, fieldKey: 'grundinsel:12:3', blueprintKey: 'beerenstrauch', at: '2026-10-14T11:02:00.000Z' },
];

/** Das gemeinsame Ereignis „Levelaufstieg“, wie `level-up.ts` im Backend es schreibt (#200). */
function levelEvent(level: number): SeedEntity {
  const islandId = seedIds.island.philippAnna;
  const occasionKey = levelOccasionKey(islandId, level);
  return {
    table: 'island_event',
    entityType: 'island_event',
    couplingId,
    row: {
      id: islandEventId(EntityId.parse(islandId), occasionKey),
      island_id: islandId,
      coupling_id: couplingId,
      type: 'levelaufstieg',
      template_key: null,
      responsible_person_id: null,
      occasion_key: occasionKey,
      status: 'abgeschlossen',
      reward: null,
      occurred_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    },
  };
}

/** Philipp und Anna nach Person geordnet, wie der Server Ereignisstände und Intents schreibt. */
const membersInOrder = [philipp, anna].sort();

/** Gebiet des Formlevels mit Seite a für Philipp (Bauen) und Seite b für Anna (Natur). */
function areaAt(level: number) {
  const unlock = areaUnlockAt(gameCatalog, { level, sides: { a: philipp, b: anna } });
  if (unlock === null) throw new Error(`Seed: kein Gebiet bei Level ${level}`);
  return unlock;
}

/**
 * Gebiet und Entdeckung eines Formlevels, wie `area-unlock.ts` im Backend sie schreibt (#204): Freischaltung,
 * Felder beider Personen (Seite a Philipp mit Bauen, Seite b Anna), die Entdeckungs-Baupläne, die Entdeckung und
 * je Person ein Ereignisstand, in derselben Reihenfolge wie auf dem Server.
 */
function areaEntities(level: number): SeedEntity[] {
  const islandId = EntityId.parse(seedIds.island.philippAnna);
  const unlock = areaAt(level);
  const owned = { island_id: islandId, coupling_id: couplingId };
  const entity = (table: string, row: SeedEntity['row']): SeedEntity => ({ table, entityType: table, couplingId, row });
  const occasionKey = areaOccasionKey(islandId, unlock.area.key);
  const eventId = islandEventId(islandId, occasionKey);
  const discovery = DiscoveryEventDetails.parse(unlock.discovery);
  return [
    entity('area_unlock', { id: islandContentId('area_unlock', islandId, unlock.area.key), ...owned, area_key: unlock.area.key, level, unlocked_at: now, created_at: now }),
    ...unlock.fields.map((field) =>
      entity('island_field', { id: islandContentId('island_field', islandId, field.key), ...owned, field_key: field.key, owner_person_id: field.ownerPersonId, created_at: now }),
    ),
    ...discovery.blueprints.map((key) =>
      entity('blueprint_unlock', { id: islandContentId('blueprint_unlock', islandId, key), ...owned, catalog_key: key, reason: 'entdeckung', unlocked_at: now, created_at: now }),
    ),
    entity('island_event', {
      id: eventId,
      ...owned,
      type: 'entdeckung',
      template_key: null,
      responsible_person_id: null,
      occasion_key: occasionKey,
      status: discoveryStatus(discovery),
      reward: discovery,
      occurred_at: now,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }),
    ...membersInOrder.map(
      (personId): SeedEntity => ({
        table: 'island_event_state',
        entityType: 'island_event_state',
        ownerPersonId: personId,
        row: {
          id: islandEventStateId(eventId, EntityId.parse(personId)),
          island_event_id: eventId,
          person_id: personId,
          seen_at: null,
          claimed_at: null,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        },
      }),
    ),
  ];
}

/** Der offene `gebiet`-Intent an eine Person; Quelle ist die Entdeckung (#204). */
function areaIntent(level: number, recipientPersonId: string): SeedRow {
  const islandId = EntityId.parse(seedIds.island.philippAnna);
  const { area } = areaAt(level);
  const sourceEventId = islandEventId(islandId, areaOccasionKey(islandId, area.key));
  return {
    intent_id: notificationIntentId({ sourceEventId, recipientPersonId: EntityId.parse(recipientPersonId), type: 'gebiet' }),
    source_event_id: sourceEventId,
    recipient_person_id: recipientPersonId,
    type: 'gebiet',
    message_key: 'gebiet',
    payload: { gebietKey: area.key },
    status: 'offen',
    created_at: now,
    status_changed_at: now,
  };
}

/** Der offene `levelaufstieg`-Intent an eine Person; nur Server, ohne Sync. */
function levelIntent(level: number, recipientPersonId: string): SeedRow {
  const sourceEventId = levelEvent(level).row.id as string;
  return {
    intent_id: notificationIntentId({ sourceEventId: EntityId.parse(sourceEventId), recipientPersonId: EntityId.parse(recipientPersonId), type: 'levelaufstieg' }),
    source_event_id: sourceEventId,
    recipient_person_id: recipientPersonId,
    type: 'levelaufstieg',
    message_key: 'levelaufstieg',
    payload: { level },
    status: 'offen',
    created_at: now,
    status_changed_at: now,
  };
}

/**
 * Das zuletzt gefeierte Level je Installation, im Gerätezustand der App (`momo_levelfeier` in
 * `apps/mobile/src/island/level-celebration.ts`): Beide Geräte haben Level 3 schon gesehen. Ohne gemerktes
 * Level übernähme die App das erste, das sie sieht, still; dann hinge die Feier daran, ob die Oberfläche vor
 * dem ersten Pull steht.
 */
function celebratedLevel(state: SeedState, level: number): SeedState {
  const row = { key: 'momo_levelfeier', value: { islandId: seedIds.island.philippAnna, level }, updated_at: haelfteVollBauten.at(-1)!.at };
  return Object.keys(state.devices).reduce((next, installation) => withDeviceState(next, installation, [row]), state);
}

function levelaufstiegAusstehend() {
  const ops = seedIds.operation.levelaufstiegAusstehend;
  const synced = celebratedLevel(
    buildSeedState({
      parts: gekoppeltPartsBuilt(haelfteVollBauten),
      createdAt: now,
      devices: { [iphone]: { personId: philipp, cursor: 'latest' }, [android]: { personId: anna, cursor: 'latest' } },
    }),
    3,
  );
  const arrivals = annasLueckenBauten.map((build, index) => ({ build, n: firstBuild + index, operationId: ops[index]! }));
  const initial = changedOffline(synced, android, arrivals.map(({ build, n, operationId }) => offlineBuild(build, n, operationId)));
  // Jeder Bau berechnet den Fortschritt aus allen bisherigen; erst der dritte erreicht Level 4.
  const changes = arrivals.flatMap(({ build, n }, index) => {
    const accepted = [...haelfteVollBauten, ...arrivals.slice(0, index + 1).map((arrival) => arrival.build)];
    const built = serverBuild(initial, build, n, accepted);
    // Level 4 ist ein Formlevel: Mit dem Aufstieg kommen Schilfwiese und Entdeckung (#204).
    const level = progressOf(accepted).level;
    return level > progressOf(haelfteVollBauten).level ? [...built, levelEvent(level), ...areaEntities(level)] : built;
  });
  const server = changedOnServer(initial, { createdAt: now, changes });
  const intents = [levelIntent(4, philipp), levelIntent(4, anna), ...membersInOrder.map((personId) => areaIntent(4, personId))];
  const withIntents = { ...server, server: { ...server.server, notification_intent: intents } };
  // Anna sendet und zieht, danach zieht Philipp.
  const target = afterSync(
    withIntents,
    arrivals.map(({ n, operationId }) => ({
      ...processed(operationId, 'applied', { command: 'buildObject', businessKey: buildObjectKey(EntityId.parse(seedIds.buildCommand(n))) }),
      person_id: anna,
    })),
    [],
  );
  const pulled = pulledBy(pulledBy(target, android, anna), iphone, philipp);
  return {
    initial,
    target: { server: pulled.server, devices: Object.fromEntries(Object.entries(pulled.devices).map(([key, device]) => [key, { ...device, outbox: [] }])) },
  };
}

const levelaufstiegAusstehendStates = levelaufstiegAusstehend();

export const levelaufstiegAusstehendManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'levelaufstieg-ausstehend',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  initial: levelaufstiegAusstehendStates.initial,
  // Erst Annas Android: Ihre drei Bauten heben die Insel auf Level 4. Dann Philipps iPhone: Pull mit dem Aufstieg.
  steps: [
    { type: 'sync', installation: android },
    { type: 'sync', installation: iphone },
  ],
  target: levelaufstiegAusstehendStates.target,
  extensions: gekoppeltExtensions,
});

/**
 * Gerätezustand je Installation für die Momo-Szenen (#184, #200, #204): `momo_levelfeier` ist das zuletzt gefeierte
 * Level (`level-celebration.ts`), `momo_verwandlung` das Level, bei dem der Tab „Momo“ Momo zuletzt gezeigt hat
 * (`transformation.ts`), `momo_so_waechst_momo` das Einmal-Flag von „So wächst Momo“ (`growth-intro.ts`); ohne
 * es läge die Erklärung über der Verwandlung. Ersetzt diese Einträge.
 */
function shownLevels(state: SeedState, levels: Readonly<{ celebrated: number; transformed: number }>, at: string): SeedState {
  const islandId = seedIds.island.philippAnna;
  const rows: SeedRow[] = [
    { key: 'momo_levelfeier', value: { islandId, level: levels.celebrated }, updated_at: at },
    { key: 'momo_verwandlung', value: { islandId, level: levels.transformed }, updated_at: at },
    { key: 'momo_so_waechst_momo', value: { shownAt: at }, updated_at: at },
  ];
  const devices = Object.fromEntries(
    Object.entries(state.devices).map(([key, device]) => [
      key,
      { ...device, rows: { ...device.rows, device_state: [...(device.rows.device_state ?? []).filter((row) => !rows.some((own) => own.key === row.key)), ...rows] } },
    ]),
  );
  return { server: state.server, devices };
}

/**
 * `formwechsel` („Formwechsel bei Level 4“, #204): der Stand von `levelaufstieg-ausstehend` nach beiden Syncs.
 * Die Insel ist auf Level 4, Momo ein Hüpfer, die Schilfwiese freigeschaltet, und die Entdeckung wartet auf beide.
 * Beide Geräte haben Level 4 auf „Heute“ schon gefeiert und „So wächst Momo“ gesehen, Momo im Tab „Momo“ aber
 * zuletzt auf Level 3: Beim nächsten Öffnen des Tabs verwandelt sich Momo von der Kaulquappe in den Hüpfer, danach
 * zieht der Nebel von der Schilfwiese ab. Ein Sync ändert nichts.
 */
const formwechselState = (() => {
  const { server, devices } = shownLevels(levelaufstiegAusstehendStates.target, { celebrated: 4, transformed: 3 }, now);
  // Die verarbeiteten Operationen von Annas Bauten gehören zum Weg dorthin, nicht zum Ausgangszustand.
  return { server: Object.fromEntries(Object.entries(server).filter(([table]) => table !== 'processed_operation')), devices };
})();

export const formwechselManifest = SeedManifest.parse({
  formatVersion: 1,
  scenario: 'formwechsel',
  revision: 1,
  clock: seedClock,
  localDates: seedDays,
  catalogVersion: null,
  accounts: [seedAccounts.philipp, seedAccounts.anna],
  installations: [seedInstallations.philippIphone, seedInstallations.annaAndroid],
  initial: formwechselState,
  steps: [{ type: 'sync', installation: iphone }],
  target: formwechselState,
  extensions: gekoppeltExtensions,
});
