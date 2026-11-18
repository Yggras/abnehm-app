import { EntityId, Instant, LocalDate, localDateAfter, TimeZone } from '../src/base.ts';
import { dailyGoalId, dailyGoalKey, dailyGoalsKey } from '../src/daily-goals.ts';
import { CompleteDailyGoalPayload } from '../src/energy.ts';
import { dailyGoalSnapshotsOf, MaterializeDailyGoals, type WeeklyPlanDays } from '../src/plan.ts';
import { currentSyncSchemaVersion, OutboxOperation } from '../src/sync.ts';
import { buildSeedState, type SeedEntity, type SeedPart } from './build.ts';
import { seedAccounts, seedClock, seedDays, seedIds, seedInstallations } from './ids.ts';
import { SeedManifest, type SeedRow, type SeedScenarioKey, type SeedState, type SeedStep } from './manifest.ts';
import { seedCompletion, seedWaterEntry } from './rows.ts';
import { soloFundament, soloZieleOf, type SoloWeeklyPlan } from './solo.ts';

// Szenarien der Tagesziele aus Spezifikation 1, Abschnitte 5 und 12 (#131): „Tage ohne App-Öffnung“
// innerhalb und außerhalb des 7-Tage-Nachholfensters und „Zeitzonen“ mit Reise nach Osten und Westen
// und den Umstellungstagen 2026-10-25 und 2027-03-28 in `Europe/Berlin`. Philipp ist wie in `solo` allein
// und hat dieselbe Person, Zielversion und Wochenplanversion ab 01.10. mit denselben IDs, nur einen
// eigenen Wochenplan mit drei Sporttagen. Tagesziele entstehen im Schritt `tagesziele_sicherstellen`
// über das echte Plan-Modul; der Sollzustand nennt sie samt ihren Fachbefehlen in der Outbox. Den
// Server erreichen sie erst mit dem nächsten Sync. Tagesenden stehen ausgeschrieben im Manifest, damit
// der Sollzustand nicht mit derselben Rechnung entsteht, die er prüft. Alle Werte sind erfunden.

const philipp = seedIds.person.philipp;
const iphone = seedInstallations.philippIphone.key;
const now = seedClock.instant;
const berlin = TimeZone.parse(seedClock.timeZone);

/** Wochenplan: montags und sonntags Wiegetag, dienstags, donnerstags und samstags Sport. */
const plan = {
  montag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
  dienstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  mittwoch: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  donnerstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  freitag: ['ernaehrung_erfasst', 'wasserziel', 'im_kalorienbudget'],
  samstag: ['im_kalorienbudget', 'wasserziel', 'sporteinheit'],
  sonntag: ['ernaehrung_erfasst', 'wasserziel', 'gewogen'],
} as const satisfies SoloWeeklyPlan;

/** Zielversion und Wochenplanversion aus `solo`, ohne dessen Tagesziele von heute. */
const ziele: SeedPart = (() => {
  const part = soloZieleOf(plan);
  return { area: 'ziele', entities: part.entities.filter((entity) => entity.table !== 'daily_goal') };
})();

/** Was die Snapshots aus Philipps Zielversion brauchen. */
const goal = (() => {
  const row = ziele.entities.find((entity) => entity.table === 'goal_version')!.row;
  return {
    calorieBudgetMilliKcal: Number(row.calorie_budget_milli_kcal),
    lowerBoundMilliKcal: Number(row.lower_bound_milli_kcal),
    waterTargetMl: Number(row.water_target_ml),
    weeklySportTargetMinutes: Number(row.weekly_sport_target_minutes),
  };
})();

/** Ein materialisierter Tag: Zone und Offset zu Beginn des Tags, Tagesende als Beginn des Folgetags. */
type DayStamp = Readonly<{ localDate: string; timeZone: TimeZone; utcOffsetMinutes: number; dayEndsAt: string; createdAt: string }>;

/** Die drei Tagesziele eines Tags, wie sie das Plan-Modul anlegt: IDs aus Person, Tag und Platz. */
function materializedGoals(day: DayStamp): MaterializeDailyGoals['goals'] {
  const localDate = LocalDate.parse(day.localDate);
  const snapshots = dailyGoalSnapshotsOf({
    personId: EntityId.parse(philipp),
    localDate,
    timeZone: day.timeZone,
    dayEndsAt: Instant.parse(day.dayEndsAt),
    goal,
    days: plan as unknown as WeeklyPlanDays,
  });
  return MaterializeDailyGoals.parse({
    localDate,
    goals: snapshots.map((snapshot) => ({ id: dailyGoalId(EntityId.parse(philipp), localDate, snapshot.slot), snapshot })),
  }).goals;
}

/** Zeilen der Tagesziele eines Tags; nicht beim Sync angemeldet, deshalb ohne Änderungsprotokoll. */
function dailyGoalRows(day: DayStamp): SeedEntity[] {
  return materializedGoals(day).map(({ id, snapshot }) => ({
    table: 'daily_goal',
    ownerPersonId: philipp,
    row: {
      id,
      person_id: philipp,
      local_date: day.localDate,
      time_zone: day.timeZone,
      utc_offset_minutes: day.utcOffsetMinutes,
      slot: snapshot.slot,
      baustein: snapshot.type,
      snapshot,
      day_ends_at: day.dayEndsAt,
      created_at: day.createdAt,
    },
  }));
}

/** Der Fachbefehl `materializeDailyGoals` eines Tags. */
function materialization(day: DayStamp, operationId: string): OutboxOperation {
  const localDate = LocalDate.parse(day.localDate);
  return OutboxOperation.parse({
    type: 'materializeDailyGoals',
    operationId,
    businessKey: dailyGoalsKey(EntityId.parse(philipp), localDate),
    payload: { localDate, goals: materializedGoals(day) },
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: day.createdAt,
  });
}

/**
 * Ein Tag in Berlin in Sommer- (UTC+2) oder Winterzeit (UTC+1), dessen Folgetag mit demselben Offset
 * beginnt: Mitternacht ist dann 22:00 bzw. 23:00 UTC desselben Kalendertags.
 */
function berlinDay(localDate: string, utcOffsetMinutes: 60 | 120, createdAt: string): DayStamp {
  const dayEndsAt = `${localDate}T${utcOffsetMinutes === 120 ? '22' : '23'}:00:00.000Z`;
  return { localDate, timeZone: berlin, utcOffsetMinutes, dayEndsAt, createdAt };
}

/** Zustand mit dem iPhone auf dem Stand des Servers. */
const stateOf = (parts: readonly SeedPart[]): SeedState =>
  buildSeedState({ parts, createdAt: now, devices: { [iphone]: { personId: philipp, cursor: 'latest' } } });

/** Sollzustand: Der Server bleibt, wie er ist; das iPhone hat die neuen Zeilen und die Outbox. */
function onDevice(state: SeedState, created: readonly SeedEntity[], outbox: readonly OutboxOperation[]): SeedState {
  const device = state.devices[iphone]!;
  const rows: Record<string, SeedRow[]> = { ...device.rows };
  // Lokal angelegt und noch nicht synchronisiert: ohne Serverversion.
  for (const { table, row } of created) rows[table] = [...(rows[table] ?? []), { ...row, server_version: null }];
  return { server: state.server, devices: { [iphone]: { ...device, rows, outbox: [...device.outbox, ...outbox] } } };
}

/** Die Tage `from` bis `to` (beide einschließlich); lokale Tage ordnen sich als Zeichenfolgen. */
function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = LocalDate.parse(from); day <= to; day = localDateAfter(day, 1)) days.push(day);
  return days;
}

type Szenario = Readonly<{ initial: SeedState; steps: readonly SeedStep[]; target: SeedState }>;

/**
 * Tage ohne App-Öffnung: Philipp hat die App zuletzt am Montag, 05.10., geöffnet; seitdem gibt es keine
 * Tagesziele. Am 07.10. (außerhalb des Fensters) und am 10.10. (innerhalb) hat er auf einem anderen Gerät
 * je 2500 ml Wasser eingetragen, das Wasserziel. Die App-Öffnung heute (14.10.) legt die Tage der letzten
 * 7 lokalen Tage an, also vom 08. bis zum 14.10., und meldet die abgelaufenen vom 08. bis zum 13.10. mit
 * `tagesabschluss`. Am 10.10. erfüllt das Wasser damit das Wasserziel samt `+1`. Der 06. und 07.10.
 * bleiben ohne Tagesziele: Das Wasser vom 07.10. zählt für den Tracker, erzeugt aber keine Energie.
 */
function tageOhneAppOeffnung(): Szenario {
  const lastOpened: SeedPart = { area: 'ziele', entities: dailyGoalRows(berlinDay('2026-10-05', 120, '2026-10-05T05:00:00.000Z')) };
  const [outside, inside] = seedIds.waterEntry.philippOhneAppOeffnung;
  const water: SeedPart = {
    area: 'tracker',
    entities: [
      seedWaterEntry({ id: outside!, personId: philipp, amountMl: 2_500, loggedAt: '2026-10-07T15:00:00.000Z', localDate: '2026-10-07' }),
      seedWaterEntry({ id: inside!, personId: philipp, amountMl: 2_500, loggedAt: '2026-10-10T15:00:00.000Z', localDate: '2026-10-10' }),
    ],
  };
  const initial = stateOf([soloFundament, ziele, lastOpened, water]);

  const operationIds = seedIds.operation.tageOhneAppOeffnung;
  const window = daysBetween('2026-10-08', seedDays.heute).map((localDate) => berlinDay(localDate, 120, now));
  // Samstag, 10.10.: Im Kalorienbudget, Wasserziel, Sporteinheit; das Wasserziel liegt auf Platz 2.
  const waterGoal = materializedGoals(window[2]!)[1];
  const completion = seedCompletion({ personId: philipp, dailyGoalId: waterGoal.id, localDate: '2026-10-10', slot: 2, baustein: 'wasserziel', at: now });
  const completeOperation = OutboxOperation.parse({
    type: 'completeDailyGoal',
    operationId: operationIds[7],
    businessKey: dailyGoalKey(EntityId.parse(philipp), LocalDate.parse('2026-10-10'), 2),
    payload: CompleteDailyGoalPayload.parse({ dailyGoalId: waterGoal.id, localDate: '2026-10-10', slot: 2, baustein: 'wasserziel', completedAt: now }),
    knownServerVersion: null,
    schemaVersion: currentSyncSchemaVersion,
    createdAt: now,
  });
  return {
    initial,
    steps: [{ type: 'tagesziele_sicherstellen', installation: iphone, operationIds: operationIds.map((id) => EntityId.parse(id)) }],
    target: onDevice(
      initial,
      [...window.flatMap(dailyGoalRows), ...completion],
      [...window.map((day, index) => materialization(day, operationIds[index]!)), completeOperation],
    ),
  };
}

/** Die vier Auslöser in `zeitzonen_reisen`: Zeitpunkt, Zone des Geräts und die Tage, die dabei entstehen. */
const reisen = [
  {
    // Reise nach Osten: 16:00 UTC ist in Tokio 01:00 am 15.10.; Tokio hat keine Sommerzeit (UTC+9).
    at: '2026-10-14T16:00:00.000Z',
    timeZone: TimeZone.parse('Asia/Tokyo'),
    days: [{ localDate: '2026-10-15', utcOffsetMinutes: 540, dayEndsAt: '2026-10-15T15:00:00.000Z' }],
  },
  {
    // Reise nach Westen: 12:00 UTC ist in New York 08:00 am 16.10. (Sommerzeit, UTC−4).
    at: '2026-10-16T12:00:00.000Z',
    timeZone: TimeZone.parse('America/New_York'),
    days: [{ localDate: '2026-10-16', utcOffsetMinutes: -240, dayEndsAt: '2026-10-17T04:00:00.000Z' }],
  },
  {
    // Zurück in Berlin am 25.10., dem Ende der Sommerzeit: 25 Stunden bis zum Beginn des 26.10. (UTC+1).
    // Der 17. und 18.10. liegen außerhalb des Fensters und bleiben ohne Tagesziele.
    at: '2026-10-25T10:00:00.000Z',
    timeZone: berlin,
    days: [
      ...daysBetween('2026-10-19', '2026-10-24').map((localDate) => ({ localDate, utcOffsetMinutes: 120, dayEndsAt: berlinDay(localDate, 120, '').dayEndsAt })),
      { localDate: '2026-10-25', utcOffsetMinutes: 120, dayEndsAt: '2026-10-25T23:00:00.000Z' },
    ],
  },
  {
    // 28.03.2027, Beginn der Sommerzeit: 23 Stunden bis zum Beginn des 29.03. (UTC+2).
    at: '2027-03-28T10:00:00.000Z',
    timeZone: berlin,
    days: [
      ...daysBetween('2027-03-22', '2027-03-27').map((localDate) => ({ localDate, utcOffsetMinutes: 60, dayEndsAt: berlinDay(localDate, 60, '').dayEndsAt })),
      { localDate: '2027-03-28', utcOffsetMinutes: 60, dayEndsAt: '2027-03-28T22:00:00.000Z' },
    ],
  },
] as const;

/**
 * Zeitzonen: Philipp hat die App vom 08. bis zum 14.10. täglich in Berlin geöffnet. Dann reist er nach
 * Tokio und New York, ist am 25.10. zurück in Berlin und öffnet die App am 28.03.2027 wieder. Jeder
 * Auslöser legt neue Tage in der Zone des Geräts an, mit dem Beginn des Folgetags in dieser Zone als
 * Tagesende; bestehende Tage behalten Zone und Tagesende. Einträge gibt es keine, also auch keine Energie.
 */
function zeitzonenReisen(): Szenario {
  const daily: SeedPart = {
    area: 'ziele',
    entities: daysBetween('2026-10-08', seedDays.heute).flatMap((localDate) => dailyGoalRows(berlinDay(localDate, 120, `${localDate}T05:00:00.000Z`))),
  };
  const initial = stateOf([soloFundament, ziele, daily]);
  const operationIds = [...seedIds.operation.zeitzonenReisen];
  const stamps = reisen.flatMap(({ at, timeZone, days }) => days.map((day): DayStamp => ({ ...day, timeZone, createdAt: at })));
  const steps = reisen.map(({ at, timeZone, days }): SeedStep => ({
    type: 'tagesziele_sicherstellen',
    installation: iphone,
    operationIds: operationIds.splice(0, days.length).map((id) => EntityId.parse(id)),
    at: Instant.parse(at),
    timeZone,
  }));
  return {
    initial,
    steps,
    target: onDevice(initial, stamps.flatMap(dailyGoalRows), stamps.map((day, index) => materialization(day, seedIds.operation.zeitzonenReisen[index]!))),
  };
}

const szenarien = {
  tage_ohne_app_oeffnung: tageOhneAppOeffnung,
  zeitzonen_reisen: zeitzonenReisen,
} as const satisfies Partial<Record<SeedScenarioKey, () => Szenario>>;

type TageszielSzenario = keyof typeof szenarien;

function manifest(scenario: TageszielSzenario): SeedManifest {
  const { initial, steps, target } = szenarien[scenario]();
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

/** „Tage ohne App-Öffnung“ und „Zeitzonen“ aus Spezifikation 1, Abschnitt 12 (#131). */
export const tageszielManifests = Object.fromEntries(
  (Object.keys(szenarien) as TageszielSzenario[]).map((scenario) => [scenario, manifest(scenario)]),
) as Readonly<Record<TageszielSzenario, SeedManifest>>;
