/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, TimeZone } from '@abnehm/contracts/base';

import { insertPersonForTest } from '../daily-goals/testing/persisted';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { waterEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncRegistry, createSyncWriter } from '../sync';
import { createTrackers, waterEntryEntity } from '.';

// Nachweis für #171: der Adapter des Wassereintrags in der Entitäts-Registry der App. Push, Pull und
// Löschung über zwei Geräte prüft `apps/backend/test/water-sync-app.test.ts`; hier geht es um die
// Reconciliation nach einer dauerhaften Ablehnung und um den gemeldeten Tag.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const noon = Instant.parse('2026-10-14T10:00:00.000Z');
const rejected = { code: 'invalid_payload', retryable: false } as const;

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
  const clock = createTestClock({ instant: noon, timeZone: TimeZone.parse('Europe/Berlin') });
  const newId = () => EntityId.parse(randomUUID());
  const trackers = createTrackers({
    database, clock, newId,
    writer: createSyncWriter({ registry: createSyncRegistry([waterEntryEntity]), clock, newId }),
    persistence: { reevaluateDailyGoals() {} },
  });
  trackers.addWater({ ml: 250 });
  const rows = () => database.read((tx) => sqliteOf(tx).select().from(waterEntry).all());
  const entryId = EntityId.parse(rows()[0]!.id);
  return { database, rows, entryId };
}

const record = (entityId: EntityId, amountMl: number) => ({
  type: 'record' as const,
  entityId,
  serverVersion: ServerVersion.parse('7'),
  data: {
    amountMl, origin: 'manuell' as const, loggedAt: noon, localDate: LocalDate.parse('2026-10-14'),
    timeZone: TimeZone.parse('Europe/Berlin'), utcOffsetMinutes: 120, personId: philipp, createdAt: noon, updatedAt: noon,
  },
});

it('entfernt nach einer Ablehnung ohne kanonischen Zustand einen nie bestätigten Eintrag', async () => {
  const { database, rows, entryId } = await setup();

  database.transaction((tx) => waterEntryEntity.reconcileRejected(tx, { entityId: entryId, error: rejected, canonical: null, pending: [] }));

  expect(rows()).toEqual([]);
});

it('übernimmt den kanonischen Datensatz und wendet eine neuere offene Löschung erneut an', async () => {
  const { database, rows, entryId } = await setup();
  const deletedAt = Instant.parse('2026-10-14T10:00:05.000Z');

  database.transaction((tx) => waterEntryEntity.reconcileRejected(tx, {
    entityId: entryId, error: rejected, canonical: record(entryId, 500),
    pending: [{ type: 'delete_entity', operationId: EntityId.parse(randomUUID()), createdAt: deletedAt }],
  }));

  expect(rows()).toEqual([expect.objectContaining({ id: entryId, amountMl: 500, serverVersion: '7', deletedAt })]);
});

it('meldet den gespeicherten Tag des Eintrags an die Tagesziele', async () => {
  const { database, entryId } = await setup();

  expect(database.read((tx) => waterEntryEntity.affectedDays!(tx, entryId))).toEqual([{ type: 'tag', personId: philipp, localDate: '2026-10-14' }]);
  expect(database.read((tx) => waterEntryEntity.affectedDays!(tx, EntityId.parse(randomUUID())))).toEqual([]);
});
