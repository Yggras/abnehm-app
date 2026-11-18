import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';
import type { EncouragementKey } from '@abnehm/contracts/partner';

import type { LocalDatabase } from '../../mobile/src/local-db/index.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { encouragement as localEncouragement } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { encouragementEntity, readEncourageSheet, sendEncouragement, sendEncouragementCommand } from '../../mobile/src/partner/encouragement.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
} from '../../mobile/src/sync/index.ts';
import { pendingOperations } from '../../mobile/src/sync/outbox.ts';
import { encouragement, notificationIntent } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { coupleByInvitation, worldStart } from './support/coupled-world.ts';
import { uncoupleAs } from './support/shared-actions.ts';

// Nachweis für #123: Anfeuern vom App-Modul bis auf das Gerät des Partners. Zwei Geräte, zusammengesetzt
// wie im Composition Root (Partnerbereich auf better-sqlite3, HTTP-Transport über `app.request`), gegen
// die echte Hono-App mit Postgres. Die Anfeuerung ist im Sync angemeldet und für beide aktiven Mitglieder
// lesbar; offline vorgemerkt geht sie beim nächsten Sync raus.

const closes: (() => void)[] = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
});

async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  closes.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open(accountId);
  const clock = createTestClock(worldStart);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry([...foundationSyncEntities, encouragementEntity]);
  const writer = createSyncWriter({ registry, clock, newId });
  let online = true;
  const engine = createSyncEngine({
    database,
    registry,
    transport: createHttpSyncTransport({
      baseUrl: testBaseUrl,
      fetch: async (input, init) => {
        if (!online) throw new TypeError('Netzwerk nicht erreichbar');
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${device.token ?? ''}`);
        headers.set('x-forwarded-for', device.ip);
        return backend.app.request(String(input), { ...init, headers });
      },
    }),
    clock,
    installationId: newId(),
    commands: createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, sendEncouragementCommand] }),
  });
  return {
    database,
    encourage: (messageKey: EncouragementKey) => database.transaction((tx) => sendEncouragement(tx, { writer, newId, clock }, messageKey)),
    sheet: () => database.read((tx) => readEncourageSheet(tx, clock.read().localDate)),
    rows: () => database.read((tx) => sqliteOf(tx).select().from(localEncouragement).all()),
    outbox: () => database.read((tx) => pendingOperations(tx, 100)),
    sync: () => engine.sync(),
    setOnline(value: boolean) {
      online = value;
    },
  };
}

/** Philipp und Anna, gekoppelt über die echte Einladung, beide Geräte nach dem ersten Sync. */
async function coupledPhones() {
  const backend = await createTestBackend({ clock: createTestClock(worldStart) });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const { couplingId } = await coupleByInvitation(backend, philipp.device, anna.device);
  const philippsIphone = await phone(backend, philipp.accountId, philipp.device);
  const annasAndroid = await phone(backend, anna.accountId, anna.device);
  await philippsIphone.sync();
  await annasAndroid.sync();
  return { backend, philipp, anna, couplingId: EntityId.parse(couplingId), philippsIphone, annasAndroid };
}

describe('Anfeuern von Gerät zu Gerät', () => {
  it('Philipp feuert an, der Server bestätigt, und Annas Gerät hat dieselbe Anfeuerung', async () => {
    const { backend, philipp, anna, philippsIphone, annasAndroid } = await coupledPhones();
    expect(philippsIphone.sheet()).toEqual({ type: 'coupled', partnerDisplayName: 'Anna', remainingPushes: 3 });

    expect(philippsIphone.encourage('stolz_auf_dich')).toEqual({ type: 'gesendet' });
    await philippsIphone.sync();
    await annasAndroid.sync();

    const [server] = await backend.database.db.select().from(encouragement);
    expect(server).toMatchObject({ senderPersonId: philipp.personId, recipientPersonId: anna.personId, messageKey: 'stolz_auf_dich', pushStatus: 'ausstehend' });
    expect(philippsIphone.outbox()).toEqual([]);
    for (const device of [philippsIphone, annasAndroid]) {
      expect(device.rows()).toEqual([
        expect.objectContaining({ id: server!.id, senderPersonId: philipp.personId, recipientPersonId: anna.personId, messageKey: 'stolz_auf_dich', serverVersion: String(server!.serverVersion) }),
      ]);
    }
    expect(philippsIphone.sheet()).toMatchObject({ remainingPushes: 2 });
    // Annas eigener Zähler kennt nur ihre eigenen Anfeuerungen.
    expect(annasAndroid.sheet()).toEqual({ type: 'coupled', partnerDisplayName: 'Philipp', remainingPushes: 3 });
    expect(await backend.database.db.select().from(notificationIntent)).toHaveLength(1);
  });

  it('offline vorgemerkt, geht die Anfeuerung beim nächsten Sync raus', async () => {
    const { backend, philippsIphone } = await coupledPhones();
    philippsIphone.setOnline(false);

    philippsIphone.encourage('du_schaffst_das');
    await philippsIphone.sync();
    expect(philippsIphone.outbox()).toHaveLength(1);
    expect(await backend.database.db.select().from(encouragement)).toEqual([]);

    philippsIphone.setOnline(true);
    await philippsIphone.sync();
    expect(philippsIphone.outbox()).toEqual([]);
    expect(await backend.database.db.select().from(encouragement)).toHaveLength(1);
  });

  it('entkoppelt, bevor die vorgemerkte Anfeuerung ankommt: Der Server lehnt ab, sie verschwindet vom Gerät', async () => {
    const { backend, anna, couplingId, philippsIphone } = await coupledPhones();
    philippsIphone.encourage('stark_heute');
    await uncoupleAs(backend, { couplingId, requesterPersonId: anna.personId });

    await philippsIphone.sync();

    expect(philippsIphone.outbox()).toEqual([]);
    expect(philippsIphone.rows()).toEqual([]);
    expect(philippsIphone.sheet()).toEqual({ type: 'solo' });
    expect(await backend.database.db.select().from(encouragement)).toEqual([]);
  });
});
