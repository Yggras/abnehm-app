import { EntityId, Instant, LocalDate } from '../src/base.ts';
import { DailyGoalSlot, dailyGoalKey } from '../src/daily-goals.ts';
import { CompleteDailyGoalPayload, dailyBonusKey, GrantDailyBonusPayload } from '../src/energy.ts';
import { currentSyncSchemaVersion, OutboxOperation } from '../src/sync.ts';
import { buildSeedState, changedOnServer, pulledBy, type SeedEntity, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDayEnds, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedRow, type SeedScenarioKey, type SeedState, type SeedStep } from './manifest.ts';
import { seedCompletion, seedDailyBonus, seedDailyGoals, seedKiEntry, seedSportEntry, seedWaterEntry } from './rows.ts';
import { philippThresholds, soloErnaehrung, soloFundament, soloTrackerOf, soloZieleOf, type SoloWeeklyPlan, type WaterToday } from './solo.ts';

// Randzustände der Tagesziele (Spezifikation 0, Abschnitt 12; #113): leer, teilweise, erfüllt, nach
// Erfüllung korrigiert, Tagesende offen und Tagesende abgeschlossen. Philipp ist wie in `solo` allein
// und hat dieselbe Person, Zielversion, Vorgeschichte (Radtour und Wiegungen) und dieselben IDs. Sein
// Wochenplan der Randzustände legt dienstags und mittwochs „Im Kalorienbudget“ auf Platz 1, den einzigen
// Baustein, der vom Tagesende abhängt; dieselbe Wochenplanversion wie in `solo`, nur andere Tage.
//
// Erfüllungen, Gutschriften und Tagesbonus entstehen in den Schritten über den echten Persistenzdienst
// der Tagesziele (#105): Der Ausgangszustand enthält die Tracker-Einträge, der Schritt
// `tagesziele_auswerten` wertet aus wie App-Öffnung oder Tagesabschluss, und der Sollzustand nennt, was
// er lokal anlegt. Die Fachbefehle bleiben in der Outbox; den Server erreichen sie erst mit dem nächsten
// Sync. Nur `nach_erfuellung_korrigiert` startet mit einer bereits synchronisierten Erfüllung, weil die
// Korrektur nach ihr kommt. Alle Werte sind erfunden.

const philipp = seedIds.person.philipp;
const iphone = seedInstallations.philippIphone.key;
const now = seedClock.instant;

/** Wochenplan der Randzustände: dienstags und mittwochs Kalorienbudget, Wasserziel und Sporteinheit. */
export const randzustandPlan = {
  montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
  dienstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  mittwoch: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  donnerstag: ['im_kalorienbudget', 'wasserziel', 'gewogen'],
  freitag: ['ernaehrung_erfasst', 'wasserziel', 'sporteinheit'],
  samstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  sonntag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
} as const satisfies SoloWeeklyPlan;

/** Wasser heute; das Ziel ist 2500 ml. `erreicht` endet um 11:30 UTC genau auf dem Ziel. */
const water = {
  keins: [],
  teil: [[500, '2026-10-14T06:30:00.000Z'], [750, '2026-10-14T10:15:00.000Z']],
  erreicht: [[500, '2026-10-14T06:30:00.000Z'], [750, '2026-10-14T10:15:00.000Z'], [750, '2026-10-14T11:00:00.000Z'], [500, '2026-10-14T11:30:00.000Z']],
} as const satisfies Record<string, WaterToday>;

/** Philipp mit Zielen, Wochenplan der Randzustände, Tageszielen von heute und Wasser von heute. */
const basis = (waterToday: WaterToday): SeedPart[] => [soloFundament, soloZieleOf(randzustandPlan), soloTrackerOf(waterToday)];

/** Heute eine kurze Einheit unter der Schwelle von 20 Minuten. */
const kurzeEinheit: SeedPart = {
  area: 'tracker',
  entities: [seedSportEntry({ id: seedIds.sportEntry.philippHeuteKurz, personId: philipp, activity: 'gehen', startedAt: '2026-10-14T05:00:00.000Z', minutes: 15, createdAt: '2026-10-14T05:20:00.000Z', localDate: seedDays.heute })],
};

/** Heute 30 Minuten Krafttraining, wie Philipps Einheit in `gekoppelt`. */
const krafttraining: SeedPart = {
  area: 'tracker',
  entities: [seedSportEntry({ id: seedIds.sportEntry.philippHeute, personId: philipp, activity: 'krafttraining', startedAt: '2026-10-14T05:00:00.000Z', minutes: 30, createdAt: '2026-10-14T05:00:00.000Z', localDate: seedDays.heute })],
};

/**
 * Gestern (Dienstag): Tagesziele mit Kalorienbudget, Wasserziel und Sporteinheit, 2500 ml Wasser, die
 * Radtour aus `solo` (35 Minuten) und drei geschätzte Mahlzeiten mit zusammen 2010 kcal, also im Budget
 * von 1882 bis 2417 kcal.
 */
const gestern: readonly SeedPart[] = [
  {
    area: 'ziele',
    entities: seedDailyGoals({
      personId: philipp,
      ids: seedIds.dailyGoal.philippGestern,
      localDate: seedDays.gestern,
      dayEndsAt: seedDayEnds.gestern,
      createdAt: '2026-10-13T05:00:00.000Z',
      bausteine: randzustandPlan.dienstag,
      thresholds: philippThresholds,
    }),
  },
  {
    area: 'tracker',
    entities: [
      seedWaterEntry({ id: seedIds.waterEntry.philippGestern[0], personId: philipp, amountMl: 1_500, loggedAt: '2026-10-13T08:00:00.000Z', localDate: seedDays.gestern }),
      seedWaterEntry({ id: seedIds.waterEntry.philippGestern[1], personId: philipp, amountMl: 1_000, loggedAt: '2026-10-13T15:00:00.000Z', localDate: seedDays.gestern }),
    ],
  },
  {
    area: 'ernaehrung',
    entities: [
      seedKiEntry({
        id: seedIds.nutritionEntry.philippGestern[0], personId: philipp, at: '2026-10-13T06:30:00.000Z', localDate: seedDays.gestern, meal: 'fruehstueck',
        name: 'Müsli mit Joghurt', grams: 300, per100g: { milliKcal: 160_000, proteinMg: 6_000, carbsMg: 24_000, fatMg: 4_000 },
      }),
      seedKiEntry({
        id: seedIds.nutritionEntry.philippGestern[1], personId: philipp, at: '2026-10-13T11:00:00.000Z', localDate: seedDays.gestern, meal: 'mittagessen',
        name: 'Nudeln mit Tomatensoße', grams: 500, per100g: { milliKcal: 150_000, proteinMg: 5_000, carbsMg: 27_000, fatMg: 2_500 },
      }),
      seedKiEntry({
        id: seedIds.nutritionEntry.philippGestern[2], personId: philipp, at: '2026-10-13T17:30:00.000Z', localDate: seedDays.gestern, meal: 'abendessen',
        name: 'Gemüsepfanne mit Reis', grams: 600, per100g: { milliKcal: 130_000, proteinMg: 3_500, carbsMg: 20_000, fatMg: 4_000 },
      }),
    ],
  },
];

/** Erfüllung eines Tagesziels von Philipp zu `at`. */
const completion = (localDate: 'heute' | 'gestern', slot: DailyGoalSlot, at: string): SeedEntity[] => {
  const ids = localDate === 'heute' ? seedIds.dailyGoal.philippHeute : seedIds.dailyGoal.philippGestern;
  const bausteine = localDate === 'heute' ? randzustandPlan.mittwoch : randzustandPlan.dienstag;
  return seedCompletion({ personId: philipp, dailyGoalId: ids[slot - 1]!, localDate: seedDays[localDate], slot, baustein: bausteine[slot - 1]!, at });
};

/** Lokal angelegt und noch nicht synchronisiert: ohne Serverversion. */
const local = (entities: readonly SeedEntity[]): SeedEntity[] => entities.map((entity) => ({ ...entity, row: { ...entity.row, server_version: null } }));

/** Ohne Operations-ID: der Fachbefehl einer Erfüllung oder eines Tagesbonus. */
type CommandDraft = Omit<Extract<OutboxOperation, { businessKey: string }>, 'operationId'>;

/**
 * Der Fachbefehl, den der Persistenzdienst zu einer angelegten Zeile schreibt: je Erfüllung
 * `completeDailyGoal` (die Gutschrift reist mit ihr), je Tagesbonus `grantDailyBonus`; sonst keiner.
 * `createdAt` ist die Uhrzeit des Geräts bei der Auswertung.
 */
function commandOf(entity: SeedEntity, createdAt: string): CommandDraft | null {
  const { row } = entity;
  const personId = EntityId.parse(row.person_id);
  const localDate = LocalDate.parse(row.local_date);
  const base = { knownServerVersion: null, schemaVersion: currentSyncSchemaVersion, createdAt: Instant.parse(createdAt) };
  if (entity.table === 'daily_goal_completion') {
    const slot = DailyGoalSlot.parse(row.slot);
    return {
      ...base,
      type: 'completeDailyGoal',
      businessKey: dailyGoalKey(personId, localDate, slot),
      payload: CompleteDailyGoalPayload.parse({ dailyGoalId: row.daily_goal_id, localDate, slot, baustein: row.baustein, completedAt: row.first_completed_at }),
    };
  }
  if (row.type === 'daily_bonus_credit') {
    return { ...base, type: 'grantDailyBonus', businessKey: dailyBonusKey(personId, localDate), payload: GrantDailyBonusPayload.parse({ localDate }) };
  }
  return null;
}

/** Zustand mit dem iPhone auf dem Stand des Servers. */
export const stateOf = (parts: readonly SeedPart[]): SeedState =>
  buildSeedState({ parts, createdAt: now, devices: { [iphone]: { personId: philipp, cursor: 'latest' } } });

/**
 * Sollzustand nach `tagesziele_auswerten`: Erfüllungen und Buchungen nur auf dem iPhone, ohne
 * Serverversion, ihre Fachbefehle in Reihenfolge in der Outbox. Der Server bleibt unverändert. `at` ist
 * die Uhrzeit des Geräts bei der Auswertung, ohne Angabe die Uhr des Manifests.
 */
export function evaluatedOnDevice(state: SeedState, created: readonly SeedEntity[], operationIds: readonly string[], at: string = now): SeedState {
  const device = state.devices[iphone]!;
  const rows: Record<string, SeedRow[]> = { ...device.rows };
  for (const { table, row } of local(created)) rows[table] = [...(rows[table] ?? []), row];
  const commands = created.map((entity) => commandOf(entity, at)).filter((draft) => draft !== null);
  if (commands.length !== operationIds.length) throw new Error('Seed: je Fachbefehl genau eine Operations-ID');
  const outbox = commands.map((draft, index) => OutboxOperation.parse({ ...draft, operationId: operationIds[index] }));
  return { server: state.server, devices: { [iphone]: { ...device, rows, outbox } } };
}

/** Schritt `tagesziele_auswerten` auf dem iPhone; mit `at` zu dieser Uhrzeit des Geräts. */
export const evaluate = (localDate: 'heute' | 'gestern', cause: 'app_oeffnung' | 'tagesabschluss', operationIds: readonly string[], at?: string): SeedStep => ({
  type: 'tagesziele_auswerten',
  installation: iphone,
  localDates: [LocalDate.parse(seedDays[localDate])],
  cause,
  operationIds: operationIds.map((id) => EntityId.parse(id)),
  ...(at === undefined ? {} : { at: Instant.parse(at) }),
});

export type Randzustand = Readonly<{ initial: SeedState; steps: readonly SeedStep[]; target: SeedState }>;

/** Heute ohne Wasser, Sport und Mahlzeiten: alle drei Tagesziele offen; die App-Öffnung legt nichts an. */
function leer(): Randzustand {
  const state = stateOf(basis(water.keins));
  return { initial: state, steps: [evaluate('heute', 'app_oeffnung', [])], target: state };
}

/**
 * Heute 1250 ml Wasser, 15 Minuten Sport und ein Frühstück: Wasser und Sport `teilweise`, Budget bis zum
 * Tagesende `tagesende`. Die App-Öffnung legt nichts an.
 */
function teilweise(): Randzustand {
  const state = stateOf([...basis(water.teil), kurzeEinheit, soloErnaehrung]);
  return { initial: state, steps: [evaluate('heute', 'app_oeffnung', [])], target: state };
}

/**
 * Heute genau 2500 ml Wasser, noch keine Erfüllung. Die App-Öffnung legt für das Wasserziel (Platz 2)
 * die Erfüllung samt `+1` an; Sport bleibt offen, das Budget wartet aufs Tagesende.
 */
function erfuellt(): Randzustand {
  const initial = stateOf([...basis(water.erreicht), soloErnaehrung]);
  const operationIds = seedIds.operation.erfuellt;
  return { initial, steps: [evaluate('heute', 'app_oeffnung', operationIds)], target: evaluatedOnDevice(initial, completion('heute', 2, now), operationIds) };
}

/** Der letzte Wassereintrag von heute (500 ml um 11:30 UTC), den ein anderes Gerät um 11:50 UTC löscht. */
const korrekturAt = '2026-10-14T11:50:00.000Z';

/**
 * Wie `erfuellt` nach dem Sync: Das Wasserziel ist seit 11:30 UTC erfüllt und gutgeschrieben. Danach hat
 * Philipp auf einem anderen Gerät den letzten Wassereintrag gelöscht; der Server kennt die
 * Löschmarkierung, das iPhone noch nicht. Der Sync übernimmt sie, und der Persistenzdienst wertet den
 * Tag neu aus: Wasser ist wieder `teilweise` (2000 ml), die Erfüllung bleibt, keine Gegenbuchung
 * (Spezifikation 0, Abschnitte 3 und 4). Auf „Heute“ zeigt das iPhone zuerst „erfüllt“, nach dem
 * ersten Sync „bereits gutgeschrieben“.
 */
function nachErfuellungKorrigiert(): Randzustand {
  const synced = stateOf([...basis(water.erreicht), soloErnaehrung, { area: 'fundament', entities: completion('heute', 2, water.erreicht[3][1]) }]);
  const lastEntry = synced.server.water_entry!.find((row) => row.id === seedIds.waterEntry.philippHeute[3])!;
  // Die neue Serverversion vergibt `changedOnServer`.
  const initial = changedOnServer(synced, {
    createdAt: korrekturAt,
    changes: [{ table: 'water_entry', entityType: 'water_entry', ownerPersonId: philipp, row: { ...lastEntry, updated_at: korrekturAt, deleted_at: korrekturAt } }],
  });
  return { initial, steps: [{ type: 'sync', installation: iphone }], target: pulledBy(initial, iphone, philipp) };
}

/**
 * Heute 2500 ml Wasser und 30 Minuten Krafttraining, noch keine Erfüllung. Die App-Öffnung legt
 * Wasserziel (Platz 2) und Sporteinheit (Platz 3) samt `+1` an; das Kalorienbudget bleibt bis zum
 * Tagesende `tagesende`, und mit ihm wartet der Tagesbonus.
 */
function tagesendeOffen(): Randzustand {
  const initial = stateOf([...basis(water.erreicht), krafttraining, soloErnaehrung]);
  const operationIds = seedIds.operation.tagesendeOffen;
  const created = [...completion('heute', 2, now), ...completion('heute', 3, now)];
  return { initial, steps: [evaluate('heute', 'app_oeffnung', operationIds)], target: evaluatedOnDevice(initial, created, operationIds) };
}

/**
 * Gestern (Dienstag) sind Wasserziel und Sporteinheit erfüllt und synchronisiert, die Aufnahme liegt mit
 * 2010 kcal im Budget. Der Tagesabschluss für gestern legt das Kalorienbudget (Platz 1) samt `+1` an und,
 * weil damit alle drei bestehen, den Tagesbonus. Heute gleicht `teilweise` ohne Sport.
 */
function tagesendeAbgeschlossen(): Randzustand {
  const erfuellungenGestern: SeedPart = {
    area: 'fundament',
    entities: [...completion('gestern', 2, '2026-10-13T15:00:00.000Z'), ...completion('gestern', 3, '2026-10-13T16:40:00.000Z')],
  };
  const initial = stateOf([...basis(water.teil), soloErnaehrung, ...gestern, erfuellungenGestern]);
  const operationIds = seedIds.operation.tagesendeAbgeschlossen;
  const created = [...completion('gestern', 1, now), seedDailyBonus({ personId: philipp, localDate: seedDays.gestern, at: now })];
  return { initial, steps: [evaluate('gestern', 'tagesabschluss', operationIds)], target: evaluatedOnDevice(initial, created, operationIds) };
}

const randzustaende = {
  leer,
  teilweise,
  erfuellt,
  nach_erfuellung_korrigiert: nachErfuellungKorrigiert,
  tagesende_offen: tagesendeOffen,
  tagesende_abgeschlossen: tagesendeAbgeschlossen,
} as const satisfies Partial<Record<SeedScenarioKey, () => Randzustand>>;

type RandzustandKey = keyof typeof randzustaende;

/** Manifest eines Randzustands: Philipp allein mit dem iPhone, Uhr und Tage wie in allen Szenarien. */
export function randzustandManifest(scenario: SeedScenarioKey, { initial, steps, target }: Randzustand): SeedManifest {
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
    steps,
    target,
  });
}

/** Die Randzustände der Tagesziele (#113). */
export const randzustandManifests = Object.fromEntries(
  (Object.keys(randzustaende) as RandzustandKey[]).map((scenario) => [scenario, randzustandManifest(scenario, randzustaende[scenario]())]),
) as Readonly<Record<RandzustandKey, SeedManifest>>;
