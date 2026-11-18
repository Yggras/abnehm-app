/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import { defaultNotificationSetting, notificationSettingId, type NotificationSettingUpsert } from '@abnehm/contracts/notifications';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { notificationSetting, person } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { personRow } from '../local-db/testing/rows';
import { createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { createNotificationSettings, notificationSettingEntity, readNotificationSetting } from './notification-setting';

// Nachweis für #132: die Benachrichtigungseinstellung der App (Spezifikation 5, Abschnitte 6 und 10)
// gegen eine echte SQLite-Datei mit den Migrationen der App. Ohne gespeicherte Einstellung gilt der
// Standard; erst „Speichern“ legt sie mit der deterministischen ID an, samt Upsert in der Outbox.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const philippsWish: NotificationSettingUpsert = { ...defaultNotificationSetting, eveningTime: '20:30', trackerGewicht: false };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup({ withPerson = true } = {}) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_philipp');
  if (withPerson) database.transaction((tx) => sqliteOf(tx).insert(person).values(personRow(philipp, 'konto_philipp')).run());
  const clock = createTestClock(start);
  const registry = createSyncRegistry([...foundationSyncEntities, notificationSettingEntity]);
  const writer = createSyncWriter({ registry, clock, newId: () => EntityId.parse(randomUUID()) });
  const settings = createNotificationSettings({ database, writer, clock });
  return { database, clock, settings };
}

const rows = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(notificationSetting).all());
const outbox = (database: LocalDatabase) => database.read((tx) => pendingOperations(tx, 100));

describe('Benachrichtigungseinstellung der App', () => {
  it('liefert ohne gespeicherte Einstellung den Standard und legt dabei nichts an', async () => {
    const { database, settings } = await setup();

    expect(settings.current()).toEqual(defaultNotificationSetting);
    expect(database.read(readNotificationSetting)).toEqual(defaultNotificationSetting);
    expect(rows(database)).toEqual([]);
    expect(outbox(database)).toEqual([]);
  });

  it('legt sie beim ersten Speichern mit der deterministischen ID an und merkt den vollständigen Upsert vor', async () => {
    const { database, settings } = await setup();

    expect(settings.save(philippsWish)).toEqual({ type: 'saved' });

    expect(rows(database)).toEqual([
      expect.objectContaining({ id: notificationSettingId(philipp), personId: philipp, ...philippsWish, createdAt: start.instant, updatedAt: start.instant, serverVersion: null }),
    ]);
    expect(outbox(database)).toEqual([
      expect.objectContaining({
        type: 'upsert_entity', entityType: 'notification_setting', entityId: notificationSettingId(philipp), payload: philippsWish, knownServerVersion: null,
      }),
    ]);
    expect(settings.current()).toEqual(philippsWish);
  });

  it('überschreibt beim nächsten Speichern dieselbe Zeile und nennt die bekannte Serverversion', async () => {
    const { database, clock, settings } = await setup();
    settings.save(philippsWish);
    database.transaction((tx) => sqliteOf(tx).update(notificationSetting).set({ serverVersion: '41' }).run());
    clock.advanceBy(5 * 60_000);

    expect(settings.save({ ...philippsWish, middayEnabled: false })).toEqual({ type: 'saved' });

    expect(rows(database)).toEqual([
      expect.objectContaining({ id: notificationSettingId(philipp), middayEnabled: false, createdAt: start.instant, updatedAt: '2026-10-14T10:05:00.000Z' }),
    ]);
    expect(outbox(database).at(-1)).toEqual(expect.objectContaining({ knownServerVersion: ServerVersion.parse('41'), payload: { ...philippsWish, middayEnabled: false } }));
  });

  it('meldet jede Änderung, auch eine aus dem Pull, und behält ohne Änderung denselben Stand', async () => {
    const { database, settings } = await setup();
    const seen: NotificationSettingUpsert[] = [];
    const stop = settings.subscribe(() => seen.push(settings.current()));
    const before = settings.current();

    settings.save(philippsWish);
    database.transaction((tx) => sqliteOf(tx).update(notificationSetting).set({ partnerPushEnabled: false }).run());
    database.transaction((tx) => sqliteOf(tx).update(person).set({ displayName: 'Phil' }).run());
    stop();

    expect(seen).toEqual([philippsWish, { ...philippsWish, partnerPushEnabled: false }]);
    expect(settings.current()).not.toBe(before);
  });

  it('speichert denselben Stand nicht noch einmal', async () => {
    const { database, settings } = await setup();
    settings.save(philippsWish);

    expect(settings.save({ ...philippsWish })).toEqual({ type: 'unchanged' });
    expect(outbox(database)).toHaveLength(1);
  });

  it('speichert den Standard beim ersten Mal, damit er auf allen Geräten gilt', async () => {
    const { database, settings } = await setup();

    expect(settings.save(defaultNotificationSetting)).toEqual({ type: 'saved' });
    expect(rows(database)).toHaveLength(1);
  });

  it('lehnt Abend vor Mittag ab, ohne etwas zu schreiben', async () => {
    const { database, settings } = await setup();

    expect(settings.save({ ...defaultNotificationSetting, eveningTime: '12:00' })).toEqual({ type: 'invalid' });
    expect(rows(database)).toEqual([]);
    expect(outbox(database)).toEqual([]);
  });

  it('speichert vor dem ersten Pull nichts, weil die eigene Person fehlt', async () => {
    const { database, settings } = await setup({ withPerson: false });

    expect(settings.current()).toEqual(defaultNotificationSetting);
    expect(settings.save(philippsWish)).toEqual({ type: 'no_person' });
    expect(rows(database)).toEqual([]);
  });
});
