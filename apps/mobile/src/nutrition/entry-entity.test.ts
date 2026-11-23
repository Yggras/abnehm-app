/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import { NutritionEntryRecord, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import { insertPersonForTest } from '../daily-goals/testing/persisted';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { nutritionEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { createNutrition, nutritionEntryEntity } from '.';
import { withoutNetwork } from './testing/without-network';

// Nachweis für #155: der Adapter des Ernährungseintrags in der Entitäts-Registry der App. Push, Pull
// und Löschung über zwei Geräte prüft `apps/backend/test/nutrition-sync-app.test.ts`; hier geht es um
// die Reconciliation nach einer dauerhaften Ablehnung und um den gemeldeten Tag.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const morning = Instant.parse('2026-10-14T06:30:00.000Z');
const rejected = { code: 'invalid_payload', retryable: false } as const;

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

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup() {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_a');
  database.transaction((tx) => insertPersonForTest(tx, philipp));
  const clock = createTestClock({ instant: morning, timeZone: TimeZone.parse('Europe/Berlin') });
  const newId = () => EntityId.parse(randomUUID());
  const nutrition = createNutrition({ ...withoutNetwork,
    database, clock, newId,
    writer: createSyncWriter({ registry: createSyncRegistry([nutritionEntryEntity]), clock, newId }),
    persistence: { reevaluateDailyGoals() {} },
  });
  nutrition.addEntry({
    localDate: LocalDate.parse('2026-10-13'), meal: 'fruehstueck', captureMethod: 'suche',
    foodRef: { type: 'bls', key: 'C133000' }, snapshot: oats, displayUnit: 'g', displayAmountMilli: 60_000,
  });
  const rows = () => database.read((tx) => sqliteOf(tx).select().from(nutritionEntry).all());
  const entryId = EntityId.parse(rows()[0]!.id);
  return { database, rows, entryId };
}

/** Kanonischer Datensatz: 40 g statt 60 g, 348 kcal je 100 g × 0,4 = 139,2 kcal. */
const record = (entityId: EntityId) => ({
  type: 'record' as const,
  entityId,
  serverVersion: ServerVersion.parse('7'),
  data: NutritionEntryRecord.parse({
    consumedAt: morning, localDate: '2026-10-13', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
    meal: 'fruehstueck', captureMethod: 'suche', foodRef: { type: 'bls', key: 'C133000' }, snapshot: oats,
    amount: { baseAmount: 40_000, displayUnit: 'g', displayAmountMilli: 40_000 },
    totals: { milliKcal: 139_200, proteinMg: 5_288, carbsMg: 21_320, fatMg: 2_660 },
    mealPhotoId: null, personId: philipp, createdAt: morning, updatedAt: morning,
  }),
});

it('entfernt nach einer Ablehnung ohne kanonischen Zustand einen nie bestätigten Eintrag', async () => {
  const { database, rows, entryId } = await setup();

  database.transaction((tx) => nutritionEntryEntity.reconcileRejected(tx, { entityId: entryId, error: rejected, canonical: null, pending: [] }));

  expect(rows()).toEqual([]);
});

it('übernimmt den kanonischen Datensatz und wendet eine neuere offene Löschung erneut an', async () => {
  const { database, rows, entryId } = await setup();
  const deletedAt = Instant.parse('2026-10-14T06:30:05.000Z');

  database.transaction((tx) => nutritionEntryEntity.reconcileRejected(tx, {
    entityId: entryId, error: rejected, canonical: record(entryId),
    pending: [{ type: 'delete_entity', operationId: EntityId.parse(randomUUID()), createdAt: deletedAt }],
  }));

  expect(rows()).toEqual([expect.objectContaining({ id: entryId, baseAmount: 40_000, totalMilliKcal: 139_200, serverVersion: '7', deletedAt })]);
});

it('meldet den gespeicherten Tag des Eintrags an die Tagesziele', async () => {
  const { database, entryId } = await setup();

  expect(database.read((tx) => nutritionEntryEntity.affectedDays!(tx, entryId))).toEqual([{ type: 'tag', personId: philipp, localDate: '2026-10-13' }]);
  expect(database.read((tx) => nutritionEntryEntity.affectedDays!(tx, EntityId.parse(randomUUID())))).toEqual([]);
});
