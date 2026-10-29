import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import type { NutritionSnapshot } from '@abnehm/contracts/nutrition';

import {
  createDailyGoalPersistence,
  createDailyGoalRegistry,
  createDaysChangedDispatcher,
  dailyGoalCompletionEntity,
  type DaysChanged,
} from '../../mobile/src/daily-goals/index.ts';
import { energyBookingEntity } from '../../mobile/src/energy/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { nutritionEntry as localNutritionEntry } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createNutrition, nutritionEntryEntity, type DayLog } from '../../mobile/src/nutrition/index.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { changeLog, mealPhoto, nutritionEntry, person } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { push, upsertOp } from './support/sync.ts';

// Nachweis für #155: Der Ernährungseintrag ist in der Entitäts-Registry beider Seiten angemeldet. Ein
// Eintrag aus dem App-Modul „Ernährung“ geht über die echte Hono-App nach Postgres und kommt per Pull
// auf einem zweiten Gerät derselben Person an, dort auch die Löschung durch „Rückgängig“. Dazu prüft
// der Server jede Nutzlast (Spezifikation 2, Abschnitt 11): vollständiger Snapshot, Summen passend zu
// Snapshot und Menge, `local_date` höchstens einen Tag nach dem aktuellen lokalen Tag der Person.
// App-Code läuft auf echtem SQLite (better-sqlite3), der HTTP-Transport über `app.request`.

/** 12:00 in Berlin am Mittwoch, 14.10.2026 (Sommerzeit, UTC+2); Server und Geräte teilen die Uhr. */
const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Hafer Flocken aus dem BLS 4.0 (C133000), Werte je 100 g wie im Asset. */
const oats: NutritionSnapshot = {
  name: 'Hafer Flocken',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 348_000,
  proteinMg: 13_220,
  carbsMg: 53_300,
  fatMg: 6_650,
  portions: [],
  source: 'bls',
  attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0',
};

/** 60 g Hafer Flocken zum Frühstück: 348 kcal je 100 g × 0,6 = 208,8 kcal. */
const payload = {
  consumedAt: start.instant,
  localDate: '2026-10-14',
  timeZone: 'Europe/Berlin',
  utcOffsetMinutes: 120,
  meal: 'fruehstueck',
  captureMethod: 'suche',
  foodRef: { type: 'bls', key: 'C133000' },
  snapshot: oats,
  amount: { baseAmount: 60_000, displayUnit: 'g', displayAmountMilli: 60_000 },
  totals: { milliKcal: 208_800, proteinMg: 7_932, carbsMg: 31_980, fatMg: 3_990 },
  mealPhotoId: null,
};

/** Eine Installation, wie sie der Composition Root zusammensetzt: Sync, Persistenzdienst und Ernährungsmodul. */
async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(start);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry([...foundationSyncEntities, dailyGoalCompletionEntity, energyBookingEntity, nutritionEntryEntity]);
  const writer = createSyncWriter({ registry, clock, newId });
  const signals: DaysChanged[] = [];
  const dispatcher = createDaysChangedDispatcher({ database, observers: [(signal) => void signals.push(signal)], onError: (error) => { throw error; } });
  const persistence = createDailyGoalPersistence({ registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock, writer, dispatcher });
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId(), onCanonicalChanges: persistence.onCanonicalChanges });
  const nutrition = createNutrition({ database, clock, writer, persistence, newId });
  return {
    nutrition,
    sync: () => engine.sync(),
    signals,
    rows: () => database.read((tx) => sqliteOf(tx).select().from(localNutritionEntry).all()),
    dayLog() {
      let log: DayLog | null = null;
      nutrition.observeDayLog(LocalDate.parse('2026-10-14'), (value) => (log = value))();
      return log;
    },
  };
}

async function setup() {
  const backend = await createTestBackend({ clock: createTestClock(start) });
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
  const a = await phone(backend, anna.accountId, anna.device);
  const b = await phone(backend, anna.accountId, second);
  // Erster Pull: Die Person kommt auf beide Geräte.
  await a.sync();
  await b.sync();
  return { backend, anna, a, b };
}

describe('Ernährungseintrag im Sync', () => {
  it('pusht einen Eintrag, pullt ihn auf dem zweiten Gerät und dort auch die Löschung durch „Rückgängig“', async () => {
    const { backend, anna, a, b } = await setup();

    const { undoToken } = a.nutrition.addEntry({
      localDate: LocalDate.parse('2026-10-14'), meal: 'fruehstueck', captureMethod: 'suche',
      foodRef: { type: 'bls', key: 'C133000' }, snapshot: oats, displayUnit: 'g', displayAmountMilli: 60_000,
    });
    const [local] = a.rows();
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    const [stored] = await backend.database.db.select().from(nutritionEntry).where(eq(nutritionEntry.id, local!.id));
    expect(stored).toMatchObject({
      personId: anna.personId, localDate: '2026-10-14', meal: 'fruehstueck', captureMethod: 'suche', foodRefType: 'bls', foodRefKey: 'C133000',
      baseAmount: 60_000, snapshotName: 'Hafer Flocken', totalMilliKcal: 208_800, deletedAt: null,
    });
    expect(await backend.database.db.select().from(changeLog).where(eq(changeLog.entityId, local!.id))).toMatchObject([{ entityType: 'nutrition_entry', operation: 'upsert' }]);

    await b.sync();
    expect(b.rows()).toEqual([expect.objectContaining({ ...local, serverVersion: stored!.serverVersion.toString(), updatedAt: expect.any(String) })]);
    expect(b.dayLog()).toMatchObject({ intakeKcal: 209, meals: [{ meal: 'fruehstueck', entries: [{ name: 'Hafer Flocken', kcal: 209 }] }, {}, {}, {}] });
    // Die Pull-Übernahme meldet den Tag des Eintrags an den Persistenzdienst des zweiten Geräts.
    expect(b.signals).toContainEqual(expect.objectContaining({ personId: anna.personId, localDates: ['2026-10-14'], cause: 'pull' }));

    expect(a.nutrition.undo(undoToken)).toEqual({ type: 'undone' });
    await a.sync();
    await b.sync();

    const [tombstone] = await backend.database.db.select().from(nutritionEntry).where(eq(nutritionEntry.id, local!.id));
    expect(tombstone!.deletedAt).not.toBeNull();
    expect(b.rows()).toEqual([expect.objectContaining({ id: local!.id, deletedAt: tombstone!.deletedAt!.toISOString() })]);
    expect(b.dayLog()).toMatchObject({ intakeKcal: 0 });
  });

  it.each([
    ['Snapshot ohne Fett', { snapshot: { ...oats, fatMg: undefined } }],
    ['Summen passen nicht zur Menge', { totals: { ...payload.totals, milliKcal: 208_801 } }],
    ['Menge passt nicht zur Anzeige', { amount: { ...payload.amount, baseAmount: 61_000 } }],
    ['über 5 kg', { amount: { baseAmount: 5_000_001, displayUnit: 'g', displayAmountMilli: 5_000_001 } }],
    ['übermorgen in Berlin', { localDate: '2026-10-16' }],
  ])('lehnt %s dauerhaft ab, ohne etwas zu speichern', async (_, change) => {
    const { backend, anna } = await setup();

    const [result] = await push(backend, anna.device, [upsertOp(randomUUID(), { ...payload, ...change }, { entityType: 'nutrition_entry' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload', retryable: false } });
    expect(await backend.database.db.select().from(nutritionEntry)).toEqual([]);
  });

  it('erlaubt morgen in der Zone der Person als Toleranz, auch nach dem Wechsel in eine Zone mit anderem Tag', async () => {
    const { backend, anna } = await setup();

    const [tomorrow] = await push(backend, anna.device, [upsertOp(randomUUID(), { ...payload, localDate: '2026-10-15' }, { entityType: 'nutrition_entry' })]);
    // In Kiritimati (UTC+14) ist um 10:00 UTC schon der 15.10.; der 16.10. ist dort „morgen“.
    await backend.database.db.update(person).set({ timeZone: 'Pacific/Kiritimati' }).where(eq(person.id, anna.personId));
    const [afterTravel] = await push(backend, anna.device, [upsertOp(randomUUID(), { ...payload, localDate: '2026-10-16' }, { entityType: 'nutrition_entry' })]);

    expect(tomorrow).toMatchObject({ type: 'applied' });
    expect(afterTravel).toMatchObject({ type: 'applied' });
    expect((await backend.database.db.select().from(nutritionEntry)).map((row) => row.localDate).sort()).toEqual(['2026-10-15', '2026-10-16']);
  });

  it('lehnt den Verweis auf das Mahlzeitenfoto einer anderen Person ab', async () => {
    const { backend, anna } = await setup();
    const ben = await personWithSession(backend, 'ben@example.test', 'Ben');
    const photoId = randomUUID();
    const at = new Date(start.instant);
    await backend.database.db.insert(mealPhoto).values({
      id: photoId, personId: ben.personId, imageKey: `test/${photoId}.jpg`, capturedAt: at, sharedWithPartner: true, createdAt: at, updatedAt: at, serverVersion: 1n,
    });

    const [result] = await push(backend, anna.device, [upsertOp(randomUUID(), { ...payload, mealPhotoId: photoId }, { entityType: 'nutrition_entry' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await backend.database.db.select().from(nutritionEntry)).toEqual([]);
  });
});
