import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { Instant, TimeZone } from '@abnehm/contracts/base';

import { sportEntry as localSportEntry } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { changeLog, sportEntry } from '../src/db/schema/index.ts';
import { push, upsertOp } from './support/sync.ts';
import { sameAccountPhones, type TrackerPhone } from './support/tracker-phones.ts';

// Nachweis für #173: Der Sporteintrag ist in der Entitäts-Registry beider Seiten angemeldet, je Herkunft
// mit allen Feldern. Eine Einheit über das Tracker-Modul der App geht über die echte Hono-App nach
// Postgres und kommt per Pull auf einem zweiten Gerät derselben Person an, ebenso die Löschung durch
// „Rückgängig“. Ein Import mit externem Schlüssel, Quell-App, Ausblendung und überschriebener Art kommt
// vollständig auf dem zweiten Gerät an.

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const halfHourAgo = Instant.parse('2026-10-14T09:30:00.000Z');
const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});

async function setup() {
  const phones = await sameAccountPhones(start);
  closes.push(phones.close);
  return phones;
}

/** Sporteinträge eines Geräts, auch gelöschte. */
const rows = (phone: TrackerPhone) => phone.database.read((tx) => sqliteOf(tx).select().from(localSportEntry).all());

const manual = {
  activityType: 'laufen', startedAt: halfHourAgo, durationMinutes: 30, activeMilliKcal: null, origin: 'manuell',
  replacedByEntryId: null, reactivatedAt: null, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
};
const imported = {
  activityType: 'radfahren', overrideActivityType: 'mannschaftssport', startedAt: '2026-10-14T05:00:00.000Z', durationMinutes: 52,
  activeMilliKcal: 412_000, origin: 'apple_health', externalKey: '5B0E3F6A-2C1D-4E8F-9A7B-3C2D1E0F9A8B', sourceAppId: 'com.fitbit.FitbitMobile',
  sourceAppName: 'Fitbit', hiddenAt: '2026-10-14T09:00:00.000Z', localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
};

describe('Sporteintrag im Sync', () => {
  it('pusht eine Einheit, pullt sie auf dem zweiten Gerät und dort auch die Löschung durch „Rückgängig“', async () => {
    const { backend, anna, a, b } = await setup();

    const { undoToken } = a.trackers.recordSport({ activityType: 'laufen', durationMinutes: 30, startedAt: halfHourAgo, activeMilliKcal: 210_000 });
    const [local] = rows(a);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    const [stored] = await backend.database.db.select().from(sportEntry).where(eq(sportEntry.id, local!.id));
    expect(stored).toMatchObject({
      personId: anna.personId, activityType: 'laufen', overrideActivityType: null, durationMinutes: 30, activeMilliKcal: 210_000, origin: 'manuell',
      externalKey: null, sourceAppId: null, sourceAppName: null, hiddenAt: null, replacedByEntryId: null, reactivatedAt: null,
      localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, deletedAt: null,
    });
    expect(stored!.startedAt.toISOString()).toBe(halfHourAgo);
    expect(await backend.database.db.select().from(changeLog).where(eq(changeLog.entityId, local!.id))).toMatchObject([{ entityType: 'sport_entry', operation: 'upsert' }]);

    await b.sync();
    expect(rows(b)).toEqual([
      expect.objectContaining({
        id: local!.id, activityType: 'laufen', startedAt: halfHourAgo, durationMinutes: 30, activeMilliKcal: 210_000, origin: 'manuell',
        localDate: '2026-10-14', deletedAt: null, serverVersion: stored!.serverVersion.toString(),
      }),
    ]);
    // Die Pull-Übernahme meldet den Tag des Eintrags an den Persistenzdienst des zweiten Geräts.
    expect(b.signals).toContainEqual(expect.objectContaining({ personId: anna.personId, localDates: ['2026-10-14'], cause: 'pull' }));
    // Die zuletzt genutzte Einheit ist Gerätezustand und kommt nicht mit.
    expect(b.trackers.lastSport()).toBeNull();

    expect(a.trackers.undo(undoToken)).toEqual({ type: 'undone' });
    await a.sync();
    await b.sync();

    const [tombstone] = await backend.database.db.select().from(sportEntry).where(eq(sportEntry.id, local!.id));
    expect(tombstone!.deletedAt).not.toBeNull();
    expect(rows(b)).toEqual([expect.objectContaining({ id: local!.id, deletedAt: tombstone!.deletedAt!.toISOString() })]);
  });

  it('überträgt einen Import mit allen Feldern seiner Herkunft auf das zweite Gerät', async () => {
    const { backend, anna, b } = await setup();
    const id = randomUUID();

    const [result] = await push(backend, anna.device, [upsertOp(id, imported, { entityType: 'sport_entry' })]);
    expect(result).toMatchObject({ type: 'applied' });
    await b.sync();

    expect(rows(b)).toEqual([
      expect.objectContaining({
        id, origin: 'apple_health', activityType: 'radfahren', overrideActivityType: 'mannschaftssport', durationMinutes: 52, activeMilliKcal: 412_000,
        externalKey: imported.externalKey, sourceAppId: 'com.fitbit.FitbitMobile', sourceAppName: 'Fitbit', hiddenAt: imported.hiddenAt,
        replacedByEntryId: null, reactivatedAt: null, startedAt: imported.startedAt, localDate: '2026-10-14', deletedAt: null,
      }),
    ]);
  });

  it('überträgt einen ersetzten und reaktivierten manuellen Eintrag samt Verweis auf seinen Import', async () => {
    const { backend, anna, b } = await setup();
    const importId = randomUUID();
    const manualId = randomUUID();

    const results = await push(backend, anna.device, [
      upsertOp(importId, { ...imported, hiddenAt: null }, { entityType: 'sport_entry' }),
      upsertOp(manualId, { ...manual, replacedByEntryId: importId, reactivatedAt: '2026-10-14T09:45:00.000Z' }, { entityType: 'sport_entry' }),
    ]);
    expect(results).toMatchObject([{ type: 'applied' }, { type: 'applied' }]);
    await b.sync();

    expect(rows(b)).toContainEqual(expect.objectContaining({ id: manualId, replacedByEntryId: importId, reactivatedAt: '2026-10-14T09:45:00.000Z' }));
  });

  it.each([
    ['manuell über 600 Minuten', { ...manual, durationMinutes: 601 }],
    ['manuell mit externem Schlüssel', { ...manual, externalKey: imported.externalKey }],
    ['mit unbekannter Art', { ...manual, activityType: 'tanzen' }],
    ['mit Intensität', { ...manual, intensity: 'hoch' }],
    ['als Import ohne externen Schlüssel', { ...imported, externalKey: undefined }],
    ['mit „ersetzt durch“ auf einen unbekannten Import', { ...manual, replacedByEntryId: randomUUID() }],
  ])('lehnt eine Nutzlast %s dauerhaft ab, ohne etwas zu speichern', async (_, payload) => {
    const { backend, anna } = await setup();

    const [result] = await push(backend, anna.device, [upsertOp(randomUUID(), payload, { entityType: 'sport_entry' })]);

    expect(result).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await backend.database.db.select().from(sportEntry)).toEqual([]);
  });
});
