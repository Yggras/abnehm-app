import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { importedSportEntryId, importedWeightEntryId } from '@abnehm/contracts/trackers';

import { createHealthImport } from '../../mobile/src/health/health-import.ts';
import { createFakeHealthPlatform, fakeWeight, fakeWorkout, minutesFrom, type FakeHealthPlatform } from '../../mobile/src/health/testing/fake-platform.ts';
import { sportEntry as localSportEntry, weightEntry as localWeightEntry } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { sportEntry, weightEntry } from '../src/db/schema/index.ts';
import { push, upsertOp } from './support/sync.ts';
import { sameAccountPhones, type TrackerPhone } from './support/tracker-phones.ts';

// Nachweis für #183: Importe tragen eine deterministische ID aus Person, Herkunft und externem Schlüssel.
// Zwei Geräte derselben Person, die dasselbe Training und dasselbe Gewicht aus ihrer Health-Attrappe
// importieren, ergeben nach dem Sync über die echte Hono-App genau einen Eintrag je Datensatz, auf dem
// Server wie auf beiden Geräten. Der importierte Gewichtseintrag reist dabei samt genauer Gramm,
// externem Schlüssel und Quell-App.

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});

/** Health-Import eines Geräts über seiner Kontodatenbank, mit eigener Attrappe derselben Quelle. */
function healthOf(phone: TrackerPhone) {
  const clock = createTestClock(start);
  const fake: FakeHealthPlatform = createFakeHealthPlatform({ origin: 'apple_health', clock });
  const health = createHealthImport({ database: phone.database, platform: fake, trackers: phone.trackers, clock, onError: (error) => { throw error; } });
  return { fake, health };
}

/** Dieselben Datensätze in beiden Quellen: Fitbit-Training und Waagenwert von heute früh. */
function fill(fake: FakeHealthPlatform) {
  fake.put(
    fakeWorkout('5B0E3F6A-2C1D-4E8F-9A7B-3C2D1E0F9A8B', minutesFrom(start.instant, -180), 45 * 60, { platformActivityType: 37, activeMilliKcal: 410_000 }),
    fakeWeight('3F2B8C1E-7D4A-4B9E-8A1F-6C5D4E3B2A10', minutesFrom(start.instant, -240), 82_437),
  );
}

const sports = (phone: TrackerPhone) => phone.database.read((tx) => sqliteOf(tx).select().from(localSportEntry).all());
const weights = (phone: TrackerPhone) => phone.database.read((tx) => sqliteOf(tx).select().from(localWeightEntry).all());

describe('Health-Import über zwei Geräte derselben Person', () => {
  it('beide importieren offline denselben Datensatz; nach dem Sync gibt es genau einen Eintrag je Datensatz', async () => {
    const phones = await sameAccountPhones(start);
    closes.push(phones.close);
    const { backend, anna, a, b } = phones;
    const personId = EntityId.parse(anna.personId);
    const onA = healthOf(a);
    const onB = healthOf(b);
    fill(onA.fake);
    fill(onB.fake);

    await onA.health.connect();
    await onB.health.connect();
    await onA.health.idle();
    await onB.health.idle();
    const sportId = importedSportEntryId(personId, 'apple_health', '5B0E3F6A-2C1D-4E8F-9A7B-3C2D1E0F9A8B');
    const weightId = importedWeightEntryId(personId, 'apple_health', '3F2B8C1E-7D4A-4B9E-8A1F-6C5D4E3B2A10');
    expect(sports(a).map((row) => row.id)).toEqual([sportId]);
    expect(sports(b).map((row) => row.id)).toEqual([sportId]);

    await a.sync();
    await b.sync();
    await a.sync();

    expect(await backend.database.db.select().from(sportEntry)).toEqual([
      expect.objectContaining({ id: sportId, personId: anna.personId, origin: 'apple_health', durationMinutes: 45, activityType: 'laufen', deletedAt: null }),
    ]);
    expect(await backend.database.db.select().from(weightEntry)).toEqual([
      expect.objectContaining({
        id: weightId, personId: anna.personId, origin: 'apple_health', weightG: 82_437,
        externalKey: '3F2B8C1E-7D4A-4B9E-8A1F-6C5D4E3B2A10', sourceAppId: 'com.fitbit.FitbitMobile', hiddenAt: null, deletedAt: null,
      }),
    ]);
    for (const phone of [a, b]) {
      expect(sports(phone)).toEqual([expect.objectContaining({ id: sportId, durationMinutes: 45, deletedAt: null })]);
      expect(weights(phone)).toEqual([expect.objectContaining({ id: weightId, weightG: 82_437, deletedAt: null })]);
    }
  });

  it('ein Gerät importiert und synchronisiert, das zweite pullt und importiert danach ohne neue Operation', async () => {
    const phones = await sameAccountPhones(start);
    closes.push(phones.close);
    const { backend, a, b } = phones;
    const onA = healthOf(a);
    const onB = healthOf(b);
    fill(onA.fake);
    fill(onB.fake);

    await onA.health.connect();
    await onA.health.idle();
    await a.sync();
    await b.sync();
    await onB.health.connect();
    await onB.health.idle();

    // Derselbe Datensatz mit denselben Werten: Gerät B hat nichts zu pushen.
    expect(await b.sync()).toEqual({ push: 'nothing_to_do', pull: 'done' });
    expect(await backend.database.db.select().from(sportEntry)).toHaveLength(1);
    expect(await backend.database.db.select().from(weightEntry)).toHaveLength(1);
    expect(sports(b)).toHaveLength(1);
    expect(weights(b)).toHaveLength(1);
  });

  it('nimmt importierte Gewichte nur mit externem Schlüssel und im Bereich 20–350 kg an', async () => {
    const phones = await sameAccountPhones(start);
    closes.push(phones.close);
    const { backend, anna } = phones;
    const imported = {
      weightG: 82_437, origin: 'health_connect', measuredAt: start.instant, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
      externalKey: 'hc-1', sourceAppId: 'com.fitbit.FitbitMobile', sourceAppName: null, hiddenAt: null,
    };

    const [accepted, tooHeavy] = await push(backend, anna.device, [
      upsertOp(randomUUID(), imported, { entityType: 'weight_entry' }),
      upsertOp(randomUUID(), { ...imported, externalKey: 'hc-2', weightG: 350_001 }, { entityType: 'weight_entry' }),
    ]);

    expect(accepted).toMatchObject({ type: 'applied' });
    expect(tooHeavy).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await backend.database.db.select().from(weightEntry)).toEqual([expect.objectContaining({ weightG: 82_437, externalKey: 'hc-1', origin: 'health_connect' })]);
  });
});
