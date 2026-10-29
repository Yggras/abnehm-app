/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate, ServerVersion, TimeZone } from '@abnehm/contracts/base';

import { weightEntryEntity } from '.';
import { berlin, createTrackerWorld, noon, philipp, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #175: der Adapter des Gewichtseintrags in der Entitäts-Registry der App. Push, Pull und
// Löschung über zwei Geräte prüft `apps/backend/test/weight-sync-app.test.ts`; hier geht es um die
// Reconciliation nach einer dauerhaften Ablehnung und um den gemeldeten Tag.

const rejected = { code: 'invalid_payload', retryable: false } as const;
const morning = Instant.parse('2026-10-13T05:30:00.000Z');

const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

async function setup() {
  const world = await createTrackerWorld(createTestClock({ instant: noon, timeZone: berlin }));
  worlds.push(world);
  world.trackers.recordWeight({ weightG: 82_400, measuredAt: morning });
  return { ...world, entryId: EntityId.parse(world.weights()[0]!.id) };
}

const record = (entityId: EntityId, weightG: number) => ({
  type: 'record' as const,
  entityId,
  serverVersion: ServerVersion.parse('7'),
  data: {
    weightG, origin: 'manuell' as const, measuredAt: morning, localDate: LocalDate.parse('2026-10-13'),
    timeZone: TimeZone.parse('Europe/Berlin'), utcOffsetMinutes: 120, personId: philipp, createdAt: noon, updatedAt: noon,
  },
});

it('entfernt nach einer Ablehnung ohne kanonischen Zustand einen nie bestätigten Eintrag', async () => {
  const { database, weights, entryId } = await setup();

  database.transaction((tx) => weightEntryEntity.reconcileRejected(tx, { entityId: entryId, error: rejected, canonical: null, pending: [] }));

  expect(weights()).toEqual([]);
});

it('übernimmt den kanonischen Datensatz und wendet eine neuere offene Löschung erneut an', async () => {
  const { database, weights, entryId } = await setup();
  const deletedAt = Instant.parse('2026-10-14T10:00:05.000Z');

  database.transaction((tx) => weightEntryEntity.reconcileRejected(tx, {
    entityId: entryId, error: rejected, canonical: record(entryId, 82_000),
    pending: [{ type: 'delete_entity', operationId: EntityId.parse(randomUUID()), createdAt: deletedAt }],
  }));

  expect(weights()).toEqual([expect.objectContaining({ id: entryId, weightG: 82_000, serverVersion: '7', deletedAt })]);
});

it('meldet den gespeicherten Tag des Eintrags an die Tagesziele', async () => {
  const { database, entryId } = await setup();

  expect(database.read((tx) => weightEntryEntity.affectedDays!(tx, entryId))).toEqual([{ type: 'tag', personId: philipp, localDate: '2026-10-13' }]);
  expect(database.read((tx) => weightEntryEntity.affectedDays!(tx, EntityId.parse(randomUUID())))).toEqual([]);
});
