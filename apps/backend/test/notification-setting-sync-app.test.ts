import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock, type TestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { defaultNotificationSetting, notificationSettingId, type NotificationSettingUpsert } from '@abnehm/contracts/notifications';
import { PullResponse, PushResponse, type OutboxOperation, type PushResult } from '@abnehm/contracts/sync';

import type { LocalDatabase } from '../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { notificationSetting as localNotificationSetting } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createNotificationSettings, notificationSettingEntity as localEntity, type NotificationSettings } from '../../mobile/src/notifications/notification-setting.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { policies } from '../src/authorization/authorization.ts';
import { notificationSetting } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { authorizationCases, httpOutcome, personWithSession, type AuthorizationWorld, type Outcome } from './support/authorization.ts';
import { deleteOp, pullRaw, push, pushRaw, upsertOp } from './support/sync.ts';

// Nachweis für #132: die Benachrichtigungseinstellung im Sync (Spezifikation 5, Abschnitte 10 und 11)
// gegen die echte Hono-App. Zwei Geräte derselben Person, zusammengesetzt wie im Composition Root
// (App-Modul auf better-sqlite3, HTTP-Transport über `app.request`), ergeben eine einzige Zeile mit der
// deterministischen ID, und die zuletzt gepushte Fassung gilt überall (Last-Write-Wins). Lesen und
// Schreiben darf nur die Eigentümerin; das prüft das Negativtest-Gerüst aus #98 mit positiver Gegenprobe.

const start = { instant: Instant.parse('2026-10-14T10:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const philippsWish: NotificationSettingUpsert = { ...defaultNotificationSetting, eveningTime: '20:30', trackerGewicht: false };

const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});

type Phone = Readonly<{ database: LocalDatabase; settings: NotificationSettings; clock: TestClock; sync: () => Promise<unknown> }>;

async function phone(backend: TestBackend, accountId: string, device: Device): Promise<Phone> {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  closes.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(start);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry([...foundationSyncEntities, localEntity]);
  const writer = createSyncWriter({ registry, clock, newId });
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId() });
  return { database, settings: createNotificationSettings({ database, writer, clock }), clock, sync: () => engine.sync() };
}

/** Philipp mit zwei angemeldeten Geräten, beide nach dem ersten Pull mit seiner Person. */
async function twoPhones() {
  const backend = await createTestBackend();
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const second = (await signIn(backend, 'philipp@example.test', defaultPassword, newDevice())).device;
  const iphone = await phone(backend, philipp.accountId, philipp.device);
  const ipad = await phone(backend, philipp.accountId, second);
  await iphone.sync();
  await ipad.sync();
  return { backend, accountId: philipp.accountId, personId: EntityId.parse(philipp.personId), iphone, ipad };
}

const serverRows = (backend: TestBackend) => backend.database.db.select().from(notificationSetting);
const localRows = (phone: Phone) => phone.database.read((tx) => sqliteOf(tx).select().from(localNotificationSetting).all());

describe('Benachrichtigungseinstellung über zwei Geräte', () => {
  it('legen beide gleichzeitig offline an, gibt es danach genau eine Zeile mit der deterministischen ID', async () => {
    const { backend, personId, iphone, ipad } = await twoPhones();

    iphone.settings.save(philippsWish);
    ipad.settings.save({ ...defaultNotificationSetting, partnerPushEnabled: false });
    // Beide Pushes zugleich: Der Sync serialisiert sie, der zweite überschreibt.
    await Promise.all([iphone.sync(), ipad.sync()]);
    await iphone.sync();
    await ipad.sync();

    const rows = await serverRows(backend);
    expect(rows).toEqual([expect.objectContaining({ id: notificationSettingId(personId), personId })]);
    const winner = rows[0]!.partnerPushEnabled ? philippsWish : { ...defaultNotificationSetting, partnerPushEnabled: false };
    for (const device of [iphone, ipad]) {
      expect(localRows(device)).toEqual([expect.objectContaining({ id: notificationSettingId(personId), ...winner })]);
      expect(device.settings.current()).toEqual(winner);
    }
  });

  it('gilt die zuletzt gepushte Fassung auf beiden Geräten (Last-Write-Wins)', async () => {
    const { backend, iphone, ipad } = await twoPhones();

    iphone.settings.save(philippsWish);
    await iphone.sync();
    await ipad.sync();
    expect(ipad.settings.current()).toEqual(philippsWish);

    // Offline auf beiden geändert; das iPad pusht zuletzt und gewinnt, auch gegen die neuere lokale Uhr des iPhones.
    ipad.settings.save({ ...philippsWish, middayTime: '12:15' });
    iphone.clock.advanceBy(60 * 60_000);
    iphone.settings.save({ ...philippsWish, eveningEnabled: false });
    await iphone.sync();
    await ipad.sync();
    await iphone.sync();

    const lastWrite = { ...philippsWish, middayTime: '12:15' };
    expect(await serverRows(backend)).toEqual([expect.objectContaining(lastWrite)]);
    expect(iphone.settings.current()).toEqual(lastWrite);
    expect(ipad.settings.current()).toEqual(lastWrite);
  });

  it('übersteht einen Neustart: ein frisches Gerät desselben Kontos erhält die Einstellung mit dem ersten Pull', async () => {
    const { backend, accountId, iphone } = await twoPhones();
    iphone.settings.save(philippsWish);
    await iphone.sync();

    const third = (await signIn(backend, 'philipp@example.test', defaultPassword, newDevice())).device;
    const fresh = await phone(backend, accountId, third);
    expect(fresh.settings.current()).toEqual(defaultNotificationSetting);
    await fresh.sync();

    expect(fresh.settings.current()).toEqual(philippsWish);
  });
});

describe('Deterministische ID auf dem Server', () => {
  it('lehnt eine andere als die deterministische ID ab, ohne etwas anzulegen', async () => {
    const backend = await createTestBackend();
    const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');

    const [random, philippsId] = await push(backend, anna.device, [
      settingOp(randomUUID(), philippsWish),
      // Philipp hat noch keine Einstellung; seine ID ist nicht Annas.
      settingOp(notificationSettingId(EntityId.parse(philipp.personId)), philippsWish),
    ]);

    expect(random).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(philippsId).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(await serverRows(backend)).toEqual([]);
  });

  it('lehnt Abend vor Mittag und Löschen ab', async () => {
    const backend = await createTestBackend();
    const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
    const id = notificationSettingId(EntityId.parse(anna.personId));
    await push(backend, anna.device, [settingOp(id, philippsWish)]);

    const [order, removal] = await push(backend, anna.device, [
      settingOp(id, { ...philippsWish, eveningTime: '12:00' }),
      deleteOp(id, { entityType: 'notification_setting' }),
    ]);

    expect(order).toMatchObject({ type: 'permanently_rejected', error: { code: 'invalid_payload' } });
    expect(removal).toMatchObject({ type: 'permanently_rejected' });
    expect(await serverRows(backend)).toEqual([expect.objectContaining({ ...philippsWish, deletedAt: null })]);
  });
});

// Negativtests des Autorisierungsgerüsts (#98): je Schutzdimension erst die positive Gegenprobe, dann
// die verweigerte Abwandlung.

type SettingWorld = AuthorizationWorld & { philippPersonId: EntityId; annaSetting: EntityId; philippSetting: EntityId };

async function arrange(): Promise<SettingWorld> {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const annaSetting = notificationSettingId(EntityId.parse(anna.personId));
  const philippSetting = notificationSettingId(EntityId.parse(philipp.personId));
  await push(backend, anna.device, [settingOp(annaSetting, defaultNotificationSetting)]);
  await push(backend, philipp.device, [settingOp(philippSetting, philippsWish)]);
  return { backend, actor: anna.device, alsoForeign: [philipp.device], philippPersonId: EntityId.parse(philipp.personId), annaSetting, philippSetting };
}

function settingOp(entityId: string, payload: Record<string, unknown>): OutboxOperation {
  return upsertOp(entityId, payload, { entityType: 'notification_setting' });
}

async function operationOutcome(world: SettingWorld, device: Device, operation: OutboxOperation): Promise<Outcome> {
  const reply = await pushRaw(world.backend, device, [operation]);
  if (reply.status !== 200) return httpOutcome(reply);
  const [result] = PushResponse.parse(reply.body).results as [PushResult];
  if (result.type === 'applied' || result.type === 'already_applied') return 'erlaubt';
  if (result.error.code === 'forbidden' && result.canonical.type === 'absent') return 'verweigert';
  return `unerwartet: ${JSON.stringify(result)}`;
}

async function pullOutcome(world: SettingWorld, device: Device, entityId: string): Promise<Outcome> {
  const reply = await pullRaw(world.backend, device);
  if (reply.status !== 200) return httpOutcome(reply);
  return PullResponse.parse(reply.body).changes.some((change) => change.entityId === entityId) ? 'erlaubt' : 'verweigert';
}

const cases = {
  'Push: eigene Benachrichtigungseinstellung ändern': authorizationCases({
    policy: policies.resource('notification_setting', 'upsert'),
    arrange,
    attempt: (world, device) => operationOutcome(world, device, settingOp(world.annaSetting, philippsWish)),
    // Die Einstellung des Partners und die eigene mit fremdem Eigentumsfeld.
    manipulierte_id: async (world) => {
      const foreignId = await operationOutcome(world, world.actor, settingOp(world.philippSetting, defaultNotificationSetting));
      const foreignOwner = await operationOutcome(world, world.actor, settingOp(world.annaSetting, { ...philippsWish, personId: world.philippPersonId }));
      return foreignId === foreignOwner ? foreignId : `unerwartet: ${foreignId} / ${foreignOwner}`;
    },
  }),
  'Pull: eigene Benachrichtigungseinstellung lesen': authorizationCases({
    policy: policies.resource('notification_setting', 'lesen'),
    arrange,
    attempt: (world, device) => pullOutcome(world, device, world.annaSetting),
    manipulierte_id: (world) => pullOutcome(world, world.actor, world.philippSetting),
  }),
};

for (const [name, list] of Object.entries(cases)) {
  describe(name, () => {
    for (const { name: caseName, run } of list) it(caseName, run);
  });
}
