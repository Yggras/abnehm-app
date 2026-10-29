import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';

import { weightEntry as localWeightEntry } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { changeLog, weightEntry } from '../src/db/schema/index.ts';
import { push, upsertOp } from './support/sync.ts';
import { sameAccountPhones, type TrackerPhone } from './support/tracker-phones.ts';

// Nachweis für #175: Der Gewichtseintrag ist in der Entitäts-Registry beider Seiten angemeldet. Ein
// Eintrag über das Tracker-Modul der App geht über die echte Hono-App nach Postgres und kommt per Pull
// auf einem zweiten Gerät derselben Person an, ebenso die Löschung durch „Rückgängig“. Der Schreib-Port
// `WeightRecorder` erzeugt auch nach zwei Aufrufen genau einen Eintrag auf beiden Geräten.

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const morning = Instant.parse('2026-10-14T05:30:00.000Z');
const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});

async function setup() {
  const phones = await sameAccountPhones(start);
  closes.push(phones.close);
  return phones;
}

/** Gewichtseinträge eines Geräts, auch gelöschte. */
const rows = (phone: TrackerPhone) => phone.database.read((tx) => sqliteOf(tx).select().from(localWeightEntry).all());

const payload = { weightG: 82_400, origin: 'manuell', measuredAt: morning, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 };

describe('Gewichtseintrag im Sync', () => {
  it('pusht einen Eintrag, pullt ihn auf dem zweiten Gerät und dort auch die Löschung durch „Rückgängig“', async () => {
    const { backend, anna, a, b } = await setup();

    const { undoToken } = a.trackers.recordWeight({ weightG: 82_400, measuredAt: morning });
    const [local] = rows(a);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    const [stored] = await backend.database.db.select().from(weightEntry).where(eq(weightEntry.id, local!.id));
    expect(stored).toMatchObject({
      personId: anna.personId, weightG: 82_400, origin: 'manuell', externalKey: null, hiddenAt: null,
      localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, deletedAt: null,
    });
    expect(stored!.measuredAt.toISOString()).toBe(morning);
    expect(await backend.database.db.select().from(changeLog).where(eq(changeLog.entityId, local!.id))).toMatchObject([{ entityType: 'weight_entry', operation: 'upsert' }]);

    await b.sync();
    expect(rows(b)).toEqual([
      expect.objectContaining({ id: local!.id, weightG: 82_400, measuredAt: morning, localDate: '2026-10-14', deletedAt: null, serverVersion: stored!.serverVersion.toString() }),
    ]);
    // Die Pull-Übernahme meldet den Tag des Eintrags an den Persistenzdienst des zweiten Geräts.
    expect(b.signals).toContainEqual(expect.objectContaining({ personId: anna.personId, localDates: ['2026-10-14'], cause: 'pull' }));

    expect(a.trackers.undo(undoToken)).toEqual({ type: 'undone' });
    await a.sync();
    await b.sync();

    const [tombstone] = await backend.database.db.select().from(weightEntry).where(eq(weightEntry.id, local!.id));
    expect(tombstone!.deletedAt).not.toBeNull();
    expect(rows(b)).toEqual([expect.objectContaining({ id: local!.id, deletedAt: tombstone!.deletedAt!.toISOString() })]);
  });

  it('WeightRecorder: zwei Aufrufe mit derselben entryId ergeben auf Server und zweitem Gerät genau einen Eintrag', async () => {
    const { backend, anna, a, b } = await setup();
    const entryId = EntityId.parse(randomUUID());

    const personId = EntityId.parse(anna.personId);

    await a.trackers.weightRecorder.recordManualWeight({ entryId, personId, weightG: 92_000, measuredAt: morning });
    await a.sync();
    await a.trackers.weightRecorder.recordManualWeight({ entryId, personId, weightG: 91_800, measuredAt: morning });
    await a.sync();
    await b.sync();

    expect(await backend.database.db.select().from(weightEntry)).toEqual([expect.objectContaining({ id: entryId, weightG: 91_800 })]);
    expect(rows(b)).toEqual([expect.objectContaining({ id: entryId, weightG: 91_800, deletedAt: null })]);
  });

  it.each([
    ['über 350 kg', { weightG: 350_100 }],
    ['nicht in 100-g-Schritten', { weightG: 82_437 }],
    ['importierte Herkunft', { origin: 'apple_health' }],
  ])('lehnt eine Nutzlast %s dauerhaft ab, ohne etwas zu speichern', async (_, change) => {
    const { backend, anna } = await setup();

    const [result] = await push(backend, anna.device, [upsertOp(randomUUID(), { ...payload, ...change }, { entityType: 'weight_entry' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await backend.database.db.select().from(weightEntry)).toEqual([]);
  });
});
