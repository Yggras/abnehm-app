import { dailyGoalKey, type DailyGoalSlot } from '../src/daily-goals.ts';
import { EntityId, Instant, LocalDate } from '../src/base.ts';
import { CompleteDailyGoalPayload } from '../src/energy.ts';
import { currentSyncSchemaVersion, OutboxOperation, type PushResult } from '../src/sync.ts';
import { WaterEntryUpsert, WeightEntryUpsert } from '../src/trackers.ts';
import { buildSeedState, changedOnServer, pulledBy, type SeedEntity, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedKey, type SeedRow, type SeedScenarioKey, type SeedState, type SeedStep } from './manifest.ts';
import { seedCompletion, seedWaterEntry } from './rows.ts';
import { soloParts } from './solo.ts';

// Mehrgeräte- und Sync-Szenarien (Spezifikation 0, Abschnitt 12; #116). Beide starten mit Philipp wie in
// `solo` und unterscheiden lokale und serverseitige Zustände: Geräte haben offline geändert, und der
// Server hat inzwischen anderes angenommen. Der Seeder stellt nur diesen Ausgangszustand her; Push, Pull,
// Ablehnung, Reconciliation, Löschmarkierung, Konfliktauflösung und kanonischer Duplikatersatz geschehen
// in den Schritten über die echten Sync-Operationen. Der Sollzustand nennt je Fall den Gewinner:
//
// - `zwei_installationen`: iPhone und iPad erfüllen offline dasselbe Wasserziel und korrigieren denselben
//   Gewichtseintrag. Es bleibt eine Erfüllung samt `+1` mit dem Zeitpunkt des zuerst angenommenen Geräts;
//   das iPad ersetzt sein Duplikat. Beim Gewicht gilt, was der Server zuletzt annimmt (Last-Write-Wins in
//   Server-Eingangsreihenfolge), nicht die Gerätezeit.
// - `offline_sync`: Das iPhone hat eine ungesicherte Buchung, ein Offline-Update gegen eine Löschung, eine
//   dauerhaft abgelehnte Operation mit neuerer Operation derselben Entität und einen Feldkonflikt. Gemeint
//   ist ein Konflikt um die Datenfelder einer Zeile (Last-Write-Wins, Abschnitt 10), nicht um ein Feld der
//   Insel; den Feldkonflikt mit Verdrängung ins Lager liefert Spezifikation 4 (#194). Ein
//   Fachbefehl zwischen beiden teilt den Push in zwei Batches; so ist die neuere Operation noch offen,
//   wenn das Gerät die Ablehnung übernimmt. Die widerrufene Partnerprojektion aus Abschnitt 12 deckt
//   `nach_entkopplung` ab (#117).
//
// Alle Werte sind erfunden.

const philipp = seedIds.person.philipp;
const iphone = seedInstallations.philippIphone.key;
const ipad = seedInstallations.philippIpad.key;
/** Die Geräte gehen zur Uhr des Manifests online; zu ihr nimmt der Server alles an. */
const now = seedClock.instant;

const rowById = (state: SeedState, table: string, id: string): SeedRow => {
  const row = state.server[table]?.find((candidate) => candidate.id === id);
  if (row === undefined) throw new Error(`Seed: ${table} ${id} fehlt`);
  return row;
};

/** Vollständige Upsert-Nutzlast eines Wassereintrags aus seiner Zeile, wie sie der Sync-Writer schreibt. */
const waterPayload = (row: SeedRow): WaterEntryUpsert => WaterEntryUpsert.parse({
  amountMl: row.amount_ml,
  origin: row.origin,
  loggedAt: row.logged_at,
  localDate: row.local_date,
  timeZone: row.time_zone,
  utcOffsetMinutes: row.utc_offset_minutes,
});

/** Vollständige Upsert-Nutzlast eines manuellen Gewichtseintrags aus seiner Zeile. */
const weightPayload = (row: SeedRow): WeightEntryUpsert => WeightEntryUpsert.parse({
  weightG: row.weight_g,
  origin: row.origin,
  measuredAt: row.measured_at,
  localDate: row.local_date,
  timeZone: row.time_zone,
  utcOffsetMinutes: row.utc_offset_minutes,
});

const payloadOf = { water_entry: waterPayload, weight_entry: weightPayload } as const;
type OfflineTable = keyof typeof payloadOf;

/** Fachlicher Schlüssel eines Tagesziels von Philipp heute. */
const keyToday = (slot: DailyGoalSlot) => dailyGoalKey(EntityId.parse(philipp), LocalDate.parse(seedDays.heute), slot);

/** Erfüllung von Philipps Wasserziel heute samt `+1`; `createdAt` setzt der Server, wenn er sie annimmt. */
const wasserziel = ({ slot, at, createdAt }: { slot: DailyGoalSlot; at: string; createdAt?: string }): SeedEntity[] =>
  seedCompletion({ personId: philipp, dailyGoalId: seedIds.dailyGoal.philippHeute[slot - 1]!, localDate: seedDays.heute, slot, baustein: 'wasserziel', at, ...(createdAt && { createdAt }) });

/** Was ein Gerät offline in einer Transaktion geschrieben hat: lokale Zeilen und ihre eine Operation. */
type OfflineChange = Readonly<{ rows: readonly Readonly<{ table: string; row: SeedRow }>[]; operation: OutboxOperation }>;

/**
 * Eine offline geänderte Zeile: Fachspalten und `updated_at` wie beim Erfassen, die Serverversion bleibt
 * die zuletzt bekannte (`null` bei neuen Einträgen), dazu ihre Upsert-Operation. `payload` ersetzt die
 * Nutzlast aus der Zeile, etwa für eine Operation, die der Server ablehnen muss.
 */
function offlineUpsert(table: OfflineTable, row: SeedRow, { operationId, at, payload }: { operationId: string; at: string; payload?: Record<string, unknown> }): OfflineChange {
  return {
    rows: [{ table, row }],
    operation: OutboxOperation.parse({
      type: 'upsert_entity',
      operationId,
      entityType: table,
      entityId: row.id,
      payload: payload ?? payloadOf[table](row),
      knownServerVersion: row.server_version ?? null,
      schemaVersion: currentSyncSchemaVersion,
      createdAt: at,
    }),
  };
}

/**
 * Eine offline angelegte Erfüllung samt `+1`, noch ohne Serverversion, und ihr Fachbefehl
 * `completeDailyGoal`, wie der Persistenzdienst (#105) sie schreibt.
 */
function offlineCompletion({ slot, at, operationId }: { slot: DailyGoalSlot; at: string; operationId: string }): OfflineChange {
  const dailyGoalId = seedIds.dailyGoal.philippHeute[slot - 1]!;
  const [completion, credit] = wasserziel({ slot, at });
  const localDate = LocalDate.parse(seedDays.heute);
  return {
    rows: [completion!, credit!].map(({ table, row }) => ({ table, row: { ...row, server_version: null } })),
    operation: OutboxOperation.parse({
      type: 'completeDailyGoal',
      operationId,
      businessKey: keyToday(slot),
      payload: CompleteDailyGoalPayload.parse({ dailyGoalId, localDate, slot, baustein: 'wasserziel', completedAt: at }),
      knownServerVersion: null,
      schemaVersion: currentSyncSchemaVersion,
      createdAt: at,
    }),
  };
}

/** Die Geräte haben offline geändert: Zeilen ersetzt oder ergänzt, die Operationen in Reihenfolge in der Outbox. */
function changedOffline(state: SeedState, installation: SeedKey, changes: readonly OfflineChange[]): SeedState {
  const device = state.devices[installation];
  if (device === undefined) throw new Error(`Seed: unbekannte Installation ${installation}`);
  const rows: Record<string, SeedRow[]> = { ...device.rows };
  for (const { table, row } of changes.flatMap((change) => change.rows)) {
    const local = rows[table] ?? [];
    rows[table] = local.some((candidate) => candidate.id === row.id)
      ? local.map((candidate) => (candidate.id === row.id ? row : candidate))
      : [...local, row];
  }
  const outbox = [...device.outbox, ...changes.map((change) => change.operation)];
  return { server: state.server, devices: { ...state.devices, [installation]: { ...device, rows, outbox } } };
}

/** Ergebnis einer verarbeiteten Operation von Philipp, ohne die abgeleiteten Spalten (`derivedColumns`). */
function processed(operationId: string, outcome: PushResult['type'], target:
  | Readonly<{ entityType: string; entityId: string }>
  | Readonly<{ command: string; businessKey: string | null }>): SeedRow {
  return {
    operation_id: operationId,
    person_id: philipp,
    operation_type: 'command' in target ? target.command : 'upsert_entity',
    entity_type: 'entityType' in target ? target.entityType : null,
    entity_id: 'entityType' in target ? target.entityId : null,
    business_key: 'businessKey' in target ? target.businessKey : null,
    outcome,
    created_at: now,
  };
}

/** Zustand nach den Schritten: Server mit den verarbeiteten Operationen, jedes Gerät auf seinem Stand und ohne offene Operation. */
function afterSync(state: SeedState, processedOperations: readonly SeedRow[], installations: readonly SeedKey[]): SeedState {
  let result: SeedState = { server: { ...state.server, processed_operation: [...processedOperations] }, devices: state.devices };
  for (const installation of installations) result = pulledBy(result, installation, philipp);
  return { server: result.server, devices: Object.fromEntries(Object.entries(result.devices).map(([key, device]) => [key, { ...device, outbox: [] }])) };
}

/** Eine neue Fassung einer Serverzeile, wie der Server sie mit seiner Uhr schreibt. */
const serverRevision = (table: string, row: SeedRow, at: string = now): SeedEntity => ({
  table,
  entityType: table,
  ownerPersonId: philipp,
  row: { ...row, updated_at: at },
});

/** Ein auf dem Server neu angelegter Wassereintrag: Anlage- und Änderungszeit setzt die Uhr des Servers. */
const createdWater = (id: string, amountMl: number, loggedAt: string): SeedEntity => {
  const entity = seedWaterEntry({ id, personId: philipp, amountMl, loggedAt, localDate: seedDays.heute });
  return { ...entity, row: { ...entity.row, created_at: now, updated_at: now } };
};

/** Ein offline gebuchter Wassereintrag auf einem Gerät, noch ohne Serverversion. */
const offlineWater = (id: string, amountMl: number, loggedAt: string): SeedRow => ({
  ...seedWaterEntry({ id, personId: philipp, amountMl, loggedAt, localDate: seedDays.heute }).row,
  server_version: null,
});

type Szenario = Readonly<{ installations: readonly (typeof seedInstallations)[keyof typeof seedInstallations][]; initial: SeedState; steps: readonly SeedStep[]; target: SeedState }>;

/**
 * Zwei Geräte von Philipp, beide auf dem Stand des Servers mit 2000 ml Wasser von heute (die letzte Buchung um 11:00).
 * Offline korrigiert das iPad um 11:20 den Gewichtseintrag von gestern auf 91,7 kg und das iPhone um 11:30
 * auf 91,6 kg. Um 11:40 bucht das iPhone 500 ml, um 11:50 das iPad 500 ml; beide erfüllen damit das
 * Wasserziel (Platz 2) samt `+1`. Dann synchronisiert erst das iPhone, danach das iPad, zuletzt noch
 * einmal das iPhone.
 *
 * Gewinner: Die Erfüllung des iPhones (11:40) nimmt der Server an; das iPad erhält `already_applied` und
 * ersetzt seine Erfüllung von 11:50 samt Gutschrift durch die kanonische. Beim Gewicht gewinnt das iPad
 * (91,7 kg), weil seine Korrektur zuletzt eingeht, obwohl sie auf dem Gerät früher entstand. Beide
 * Wassereinträge bleiben: heute zählen 3000 ml.
 */
function zweiInstallationen(): Szenario {
  const ops = seedIds.operation.zweiInstallationen;
  const elfUhr: SeedPart = {
    area: 'tracker',
    entities: [seedWaterEntry({ id: seedIds.waterEntry.philippHeute[2], personId: philipp, amountMl: 750, loggedAt: '2026-10-14T11:00:00.000Z', localDate: seedDays.heute })],
  };
  const synced = buildSeedState({
    parts: [...soloParts, elfUhr],
    createdAt: now,
    devices: { [iphone]: { personId: philipp, cursor: 'latest' }, [ipad]: { personId: philipp, cursor: 'latest' } },
  });
  const weight = rowById(synced, 'weight_entry', seedIds.weightEntry.philippGestern);
  const correctedOn = (weightG: number, at: string) => ({ ...weight, weight_g: weightG, updated_at: at });
  const waterOf = { iphone: offlineWater(seedIds.waterEntry.philippIphoneOffline, 500, '2026-10-14T11:40:00.000Z'), ipad: offlineWater(seedIds.waterEntry.philippIpadOffline, 500, '2026-10-14T11:50:00.000Z') };
  const initial = changedOffline(
    changedOffline(synced, iphone, [
      offlineUpsert('weight_entry', correctedOn(91_600, '2026-10-14T11:30:00.000Z'), { operationId: ops.iphone.gewicht, at: '2026-10-14T11:30:00.000Z' }),
      offlineUpsert('water_entry', waterOf.iphone, { operationId: ops.iphone.wasser, at: '2026-10-14T11:40:00.000Z' }),
    ]),
    ipad,
    [
      offlineUpsert('weight_entry', correctedOn(91_700, '2026-10-14T11:20:00.000Z'), { operationId: ops.ipad.gewicht, at: '2026-10-14T11:20:00.000Z' }),
      offlineUpsert('water_entry', waterOf.ipad, { operationId: ops.ipad.wasser, at: '2026-10-14T11:50:00.000Z' }),
    ],
  );

  const evaluate = (installation: SeedKey, at: string, operationId: string): SeedStep => ({
    type: 'tagesziele_auswerten',
    installation,
    localDates: [LocalDate.parse(seedDays.heute)],
    cause: 'eingabe',
    operationIds: [EntityId.parse(operationId)],
    at: Instant.parse(at),
  });
  const steps: SeedStep[] = [
    evaluate(iphone, '2026-10-14T11:40:00.000Z', ops.iphone.erfuellung),
    evaluate(ipad, '2026-10-14T11:50:00.000Z', ops.ipad.erfuellung),
    { type: 'sync', installation: iphone },
    { type: 'sync', installation: ipad },
    { type: 'sync', installation: iphone },
  ];

  const slot: DailyGoalSlot = 2;
  const completionKey = keyToday(slot);
  // In Server-Eingangsreihenfolge: erst der Batch des iPhones, dann der des iPads (ohne Duplikat).
  const server = changedOnServer(initial, {
    createdAt: now,
    changes: [
      serverRevision('weight_entry', { ...weight, weight_g: 91_600 }),
      createdWater(seedIds.waterEntry.philippIphoneOffline, 500, '2026-10-14T11:40:00.000Z'),
      ...wasserziel({ slot, at: '2026-10-14T11:40:00.000Z', createdAt: now }),
      serverRevision('weight_entry', { ...weight, weight_g: 91_700 }),
      createdWater(seedIds.waterEntry.philippIpadOffline, 500, '2026-10-14T11:50:00.000Z'),
    ],
  });
  const target = afterSync(server, [
    processed(ops.iphone.gewicht, 'applied', { entityType: 'weight_entry', entityId: weight.id as string }),
    processed(ops.iphone.wasser, 'applied', { entityType: 'water_entry', entityId: seedIds.waterEntry.philippIphoneOffline }),
    processed(ops.iphone.erfuellung, 'applied', { command: 'completeDailyGoal', businessKey: completionKey }),
    processed(ops.ipad.gewicht, 'applied', { entityType: 'weight_entry', entityId: weight.id as string }),
    processed(ops.ipad.wasser, 'applied', { entityType: 'water_entry', entityId: seedIds.waterEntry.philippIpadOffline }),
    // Das Duplikat belegt den fachlichen Schlüssel nicht noch einmal.
    processed(ops.ipad.erfuellung, 'already_applied', { command: 'completeDailyGoal', businessKey: null }),
  ], [iphone, ipad]);

  return { installations: [seedInstallations.philippIphone, seedInstallations.philippIpad], initial, steps, target };
}

/**
 * Philipp wie in `solo`, das iPhone auf diesem Stand. Danach hat ein anderes Gerät von Philipp
 * (keine Installation dieses Szenarios) online um 11:10 den Gewichtseintrag von gestern auf 91,5 kg
 * korrigiert und um 11:30 den Wassereintrag von 10:15 (750 ml) gelöscht. Offline hat das iPhone in dieser
 * Reihenfolge:
 *
 * 1. 11:00 den Gewichtseintrag von gestern auf 91,6 kg korrigiert (Feldkonflikt um die Datenfelder der
 *    Zeile). Gewinner: das iPhone,
 *    weil es zuletzt eingeht, obwohl es auf dem Gerät früher entstand.
 * 2. 11:05 den Wassereintrag von 06:30 auf 5500 ml geändert. Damit war das Wasserziel (Platz 2) erfüllt,
 *    und der Persistenzdienst hat die Erfüllung samt `+1` angelegt. 11:06 hat Philipp auf 550 ml
 *    korrigiert. Die erste Operation lehnt der Server dauerhaft ab (`invalid_payload`): Mehr als 3000 ml
 *    je Eintrag verbietet das Vertragsschema; die aktuelle App sendet so etwas nicht, der Server muss es
 *    trotzdem ablehnen. Der Fachbefehl der Erfüllung beendet den ersten Push-Batch, die Korrektur ist
 *    dabei noch offen: Das iPhone übernimmt den kanonischen Eintrag (500 ml) und wendet die Korrektur
 *    erneut an. Gewinner: die neuere Operation derselben Entität; ihre 550 ml bleiben. Die Erfüllung bleibt
 *    ebenfalls; eine spätere Korrektur bucht keine Energie zurück (Abschnitt 4).
 * 3. 11:20 den Wassereintrag von 10:15 auf 500 ml geändert. Gewinner: die Löschung (`conflict`); Löschen
 *    gewinnt gegen ein späteres Offline-Update.
 * 4. 11:45 250 ml gebucht, noch ungesichert. Gewinner: das iPhone; der Server legt den Eintrag an.
 */
function offlineSync(): Szenario {
  const ops = seedIds.operation.offlineSync;
  const synced = buildSeedState({ parts: soloParts, createdAt: now, devices: { [iphone]: { personId: philipp, cursor: 'latest' } } });
  const weight = rowById(synced, 'weight_entry', seedIds.weightEntry.philippGestern);
  const [morgens, vormittags] = [rowById(synced, 'water_entry', seedIds.waterEntry.philippHeute[0]), rowById(synced, 'water_entry', seedIds.waterEntry.philippHeute[1])];
  const deleted = '2026-10-14T11:30:00.000Z';
  const onServer = changedOnServer(
    changedOnServer(synced, { createdAt: '2026-10-14T11:10:00.000Z', changes: [serverRevision('weight_entry', { ...weight, weight_g: 91_500 }, '2026-10-14T11:10:00.000Z')] }),
    { createdAt: deleted, changes: [serverRevision('water_entry', { ...vormittags, deleted_at: deleted }, deleted)] },
  );
  const korrigiert = { ...morgens, amount_ml: 550, updated_at: '2026-10-14T11:06:00.000Z' };
  const initial = changedOffline(onServer, iphone, [
    offlineUpsert('weight_entry', { ...weight, weight_g: 91_600, updated_at: '2026-10-14T11:00:00.000Z' }, { operationId: ops.gewicht, at: '2026-10-14T11:00:00.000Z' }),
    offlineUpsert('water_entry', korrigiert, { operationId: ops.tippfehler, at: '2026-10-14T11:05:00.000Z', payload: { ...waterPayload(morgens), amountMl: 5_500 } }),
    offlineCompletion({ slot: 2, at: '2026-10-14T11:05:00.000Z', operationId: ops.erfuellung }),
    offlineUpsert('water_entry', korrigiert, { operationId: ops.korrektur, at: '2026-10-14T11:06:00.000Z' }),
    offlineUpsert('water_entry', { ...vormittags, amount_ml: 500, updated_at: '2026-10-14T11:20:00.000Z' }, { operationId: ops.gegenLoeschung, at: '2026-10-14T11:20:00.000Z' }),
    offlineUpsert('water_entry', offlineWater(seedIds.waterEntry.philippUngesichert, 250, '2026-10-14T11:45:00.000Z'), { operationId: ops.ungesichert, at: '2026-10-14T11:45:00.000Z' }),
  ]);

  // In Server-Eingangsreihenfolge über beide Batches; die beiden abgelehnten Operationen schreiben nichts.
  const server = changedOnServer(initial, {
    createdAt: now,
    changes: [
      serverRevision('weight_entry', { ...weight, weight_g: 91_600 }),
      ...wasserziel({ slot: 2, at: '2026-10-14T11:05:00.000Z', createdAt: now }),
      serverRevision('water_entry', { ...morgens, amount_ml: 550 }),
      createdWater(seedIds.waterEntry.philippUngesichert, 250, '2026-10-14T11:45:00.000Z'),
    ],
  });
  const water = (entityId: string) => ({ entityType: 'water_entry', entityId });
  const target = afterSync(server, [
    processed(ops.gewicht, 'applied', { entityType: 'weight_entry', entityId: weight.id as string }),
    processed(ops.tippfehler, 'permanently_rejected', water(seedIds.waterEntry.philippHeute[0])),
    processed(ops.erfuellung, 'applied', { command: 'completeDailyGoal', businessKey: keyToday(2) }),
    processed(ops.korrektur, 'applied', water(seedIds.waterEntry.philippHeute[0])),
    processed(ops.gegenLoeschung, 'permanently_rejected', water(seedIds.waterEntry.philippHeute[1])),
    processed(ops.ungesichert, 'applied', water(seedIds.waterEntry.philippUngesichert)),
  ], [iphone]);

  return { installations: [seedInstallations.philippIphone], initial, steps: [{ type: 'sync', installation: iphone }], target };
}

const szenarien = { zwei_installationen: zweiInstallationen, offline_sync: offlineSync } as const satisfies Partial<Record<SeedScenarioKey, () => Szenario>>;
type SzenarioKey = keyof typeof szenarien;

function manifest(scenario: SzenarioKey): SeedManifest {
  const { installations, initial, steps, target } = szenarien[scenario]();
  return SeedManifest.parse({
    formatVersion: 1,
    scenario,
    revision: 1,
    clock: seedClock,
    localDates: seedDays,
    catalogVersion: null,
    accounts: [seedAccounts.philipp],
    installations,
    initial,
    steps,
    target,
  });
}

/** Die Mehrgeräte- und Sync-Szenarien (#116). */
export const syncSzenarioManifests = Object.fromEntries(
  (Object.keys(szenarien) as SzenarioKey[]).map((scenario) => [scenario, manifest(scenario)]),
) as Readonly<Record<SzenarioKey, SeedManifest>>;
