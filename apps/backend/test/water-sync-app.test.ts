import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { Instant, TimeZone } from '@abnehm/contracts/base';

import { waterEntry as localWaterEntry } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { changeLog, waterEntry } from '../src/db/schema/index.ts';
import { push, upsertOp } from './support/sync.ts';
import { sameAccountPhones, type TrackerPhone } from './support/tracker-phones.ts';

// Nachweis für #171: Der Wassereintrag ist in der Entitäts-Registry beider Seiten angemeldet. Eine
// Buchung über das Tracker-Modul der App geht über die echte Hono-App nach Postgres, kommt per Pull
// auf einem zweiten Gerät derselben Person an, und dort kommt auch die Löschung durch „Rückgängig“ an.
// App-Code läuft auf echtem SQLite (better-sqlite3), der HTTP-Transport über `app.request`.

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});

async function setup() {
  const phones = await sameAccountPhones(start);
  closes.push(phones.close);
  return phones;
}

/** Wassereinträge eines Geräts, auch gelöschte. */
const rows = (phone: TrackerPhone) => phone.database.read((tx) => sqliteOf(tx).select().from(localWaterEntry).all());

describe('Wassereintrag im Sync', () => {
  it('pusht eine Buchung, pullt sie auf dem zweiten Gerät und dort auch die Löschung durch „Rückgängig“', async () => {
    const { backend, anna, a, b } = await setup();

    const { undoToken } = a.trackers.addWater({ ml: 250 });
    const [local] = rows(a);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    const [stored] = await backend.database.db.select().from(waterEntry).where(eq(waterEntry.id, local!.id));
    expect(stored).toMatchObject({ personId: anna.personId, amountMl: 250, origin: 'manuell', localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, deletedAt: null });
    expect(await backend.database.db.select().from(changeLog).where(eq(changeLog.entityId, local!.id))).toMatchObject([{ entityType: 'water_entry', operation: 'upsert' }]);

    await b.sync();
    expect(rows(b)).toEqual([expect.objectContaining({ id: local!.id, amountMl: 250, localDate: '2026-10-14', deletedAt: null, serverVersion: stored!.serverVersion.toString() })]);
    // Die Pull-Übernahme meldet den Tag des Eintrags an den Persistenzdienst des zweiten Geräts.
    expect(b.signals).toContainEqual(expect.objectContaining({ personId: anna.personId, localDates: ['2026-10-14'], cause: 'pull' }));

    expect(a.trackers.undo(undoToken)).toEqual({ type: 'undone' });
    await a.sync();
    await b.sync();

    const [tombstone] = await backend.database.db.select().from(waterEntry).where(eq(waterEntry.id, local!.id));
    expect(tombstone!.deletedAt).not.toBeNull();
    expect(rows(b)).toEqual([expect.objectContaining({ id: local!.id, deletedAt: tombstone!.deletedAt!.toISOString() })]);
  });

  it.each([
    ['über 3000 ml', { amountMl: 3001 }],
    ['importierte Herkunft', { origin: 'apple_health' }],
  ])('lehnt eine Nutzlast %s dauerhaft ab, ohne etwas zu speichern', async (_, change) => {
    const { backend, anna } = await setup();
    const id = randomUUID();
    const payload = { amountMl: 250, origin: 'manuell', loggedAt: start.instant, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, ...change };

    const [result] = await push(backend, anna.device, [upsertOp(id, payload, { entityType: 'water_entry' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await backend.database.db.select().from(waterEntry)).toEqual([]);
  });
});
