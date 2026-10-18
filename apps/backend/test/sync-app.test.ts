import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { outbox, person as localPerson } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import {
  createHttpSyncTransport,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationSyncEntities,
  type SyncTransport,
} from '../../mobile/src/sync/index.ts';
import { testWaterEntity as localWaterEntity, testWaterRepository } from '../../mobile/src/sync/testing/test-water.ts';
import { changeLog, processedOperation, waterEntry } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { faultyWaterEntity, push, upsertOp, water } from './support/sync.ts';

// Der Sync der App gegen die echte Hono-App mit Postgres (#99): Engine, Outbox und Adapter der App auf
// echtem SQLite (better-sqlite3), der HTTP-Transport über `app.request`. Zwei Installationen derselben
// Person, verlorene Antworten, Ablehnungen samt Reconciliation, Löschmarkierung und Feldkonflikt.

const start = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Eine App-Installation: eigene Kontodatenbank, eigene Installationskennung, eigenes Sitzungstoken. */
async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({
    openSqlite: files.openSqlite,
    onError: (error) => {
      throw error;
    },
  });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(start);
  const registry = createSyncRegistry([...foundationSyncEntities, localWaterEntity]);
  const writer = createSyncWriter({ registry, clock, newId: () => EntityId.parse(randomUUID()) });
  const network = { online: true, dropNextPushResponse: false };
  const http = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      if (!network.online) throw new TypeError('Network request failed');
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const transport: SyncTransport = {
    pull: (request) => http.pull(request),
    async push(request) {
      const reply = await http.push(request);
      if (!network.dropNextPushResponse) return reply;
      // Der Server hat alles verarbeitet, die Antwort geht unterwegs verloren.
      network.dropNextPushResponse = false;
      return { type: 'unavailable' };
    },
  };
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: EntityId.parse(randomUUID()) });
  const water_ = testWaterRepository(writer, () => Instant.parse(clock.read().instant));
  return {
    database,
    network,
    sync: () => engine.sync(),
    save: (id: EntityId, amountMl: number) => database.transaction((tx) => water_.save(tx, id, water(amountMl))),
    remove: (id: EntityId) => database.transaction((tx) => water_.remove(tx, id)),
    visible: () => database.read((tx) => water_.visible(tx)).map(({ id, amountMl }) => ({ id, amountMl })),
    row: (id: EntityId) => database.read((tx) => water_.row(tx, id)),
    outbox: () => database.read((tx) => sqliteOf(tx).select().from(outbox).all()),
  };
}

async function setup(options: { entity?: ReturnType<typeof faultyWaterEntity> } = {}) {
  const backend = await createTestBackend();
  const entity = options.entity ?? faultyWaterEntity();
  backend.sync.registerEntity(entity);
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
  const a = await phone(backend, anna.accountId, anna.device);
  const b = await phone(backend, anna.accountId, second);
  // Erster Pull: Die Person kommt auf beide Geräte.
  await a.sync();
  await b.sync();
  return { backend, entity, anna, a, b };
}

const serverRows = (backend: TestBackend) => backend.database.db.select().from(waterEntry);

describe('Sync App ↔ Backend', () => {
  it('bringt die Person mit dem ersten vollständigen Pull auf das Gerät', async () => {
    const { a, anna } = await setup();
    const people = a.database.read((tx) => sqliteOf(tx).select().from(localPerson).all());
    expect(people).toEqual([expect.objectContaining({ id: anna.personId, accountId: anna.accountId, displayName: 'Anna', timeZone: 'Europe/Berlin' })]);
    expect(people[0]?.serverVersion).not.toBeNull();
  });

  it('Tracer Bullet: lokal erfasst, gepusht, auf der zweiten Installation gepullt; die Löschung kommt als Löschmarkierung an', async () => {
    const { a, b } = await setup();
    const id = EntityId.parse(randomUUID());

    a.save(id, 250);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });
    expect(a.outbox()).toEqual([]);
    await b.sync();
    expect(b.visible()).toEqual([{ id, amountMl: 250 }]);

    a.remove(id);
    await a.sync();
    await b.sync();
    expect(b.visible()).toEqual([]);
    expect(b.row(id)).toMatchObject({ amountMl: 250, deletedAt: expect.any(String) });
  });

  it('wiederholt nach verlorener Push-Antwort sicher; der Server führt die Operation genau einmal aus', async () => {
    const { backend, a } = await setup();
    const id = EntityId.parse(randomUUID());
    a.save(id, 250);
    a.network.dropNextPushResponse = true;

    expect((await a.sync()).push).toBe('unavailable');
    expect(a.outbox()).toHaveLength(1);
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    expect(a.outbox()).toEqual([]);
    expect(a.row(id)).toMatchObject({ amountMl: 250, serverVersion: expect.any(String) });
    expect(await serverRows(backend)).toHaveLength(1);
    expect((await backend.database.db.select().from(changeLog).where(eq(changeLog.entityId, id))).length).toBe(1);
    const [stored] = await backend.database.db.select().from(processedOperation);
    expect(stored?.outcome).toBe('applied');
  });

  it('übernimmt einen gemischten Batch: gültige Operationen bleiben, die abgelehnte verschwindet lokal', async () => {
    const { backend, a } = await setup();
    // Philipps Eintrag; Annas Gerät nennt dieselbe ID, etwa nach einer Manipulation.
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const foreign = EntityId.parse(randomUUID());
    await push(backend, philipp.device, [upsertOp(foreign, water(100))]);
    const [first, last] = [EntityId.parse(randomUUID()), EntityId.parse(randomUUID())];
    a.save(first, 250);
    a.save(foreign, 999);
    a.save(last, 400);

    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    expect(a.visible()).toEqual([
      { id: first, amountMl: 250 },
      { id: last, amountMl: 400 },
    ]);
    expect(a.row(foreign)).toBeUndefined();
    expect(a.outbox()).toEqual([]);
    const rows = await serverRows(backend);
    expect(rows.map((row) => [row.amountMl, row.personId === philipp.personId]).sort()).toEqual([
      [100, true],
      [250, false],
      [400, false],
    ]);
  });

  it('rollt bei einem vorübergehenden Serverfehler zurück; die Outbox bleibt und der nächste Sync gelingt', async () => {
    const { backend, entity, a } = await setup();
    a.save(EntityId.parse(randomUUID()), 250);
    a.save(EntityId.parse(randomUUID()), 300);
    entity.failAfter(1);

    expect((await a.sync()).push).toBe('unavailable');
    expect(a.outbox().map((operation) => operation.attemptCount)).toEqual([1, 1]);
    expect(await serverRows(backend)).toHaveLength(0);

    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });
    expect(a.outbox()).toEqual([]);
    expect(await serverRows(backend)).toHaveLength(2);
  });

  it('dauerhafte Ablehnung: Ein Offline-Update gegen eine Löschung endet lokal in der Löschmarkierung', async () => {
    const { a, b } = await setup();
    const id = EntityId.parse(randomUUID());
    a.save(id, 250);
    await a.sync();
    await b.sync();

    a.network.online = false;
    a.save(id, 300);
    b.remove(id);
    await b.sync();
    a.network.online = true;
    expect(await a.sync()).toEqual({ push: 'done', pull: 'done' });

    expect(a.visible()).toEqual([]);
    expect(a.row(id)).toMatchObject({ deletedAt: expect.any(String) });
    expect(a.outbox()).toEqual([]);
  });

  it('Feldkonflikt: Zwei Installationen ändern offline, die später eingegangene Änderung gilt überall', async () => {
    const { backend, a, b } = await setup();
    const id = EntityId.parse(randomUUID());
    a.save(id, 250);
    await a.sync();
    await b.sync();

    a.network.online = false;
    b.network.online = false;
    a.save(id, 300);
    b.save(id, 500);
    // Der Pull eines Geräts mit offener Operation lässt dessen Zeile unangetastet.
    expect((await a.sync()).push).toBe('unavailable');
    expect(a.visible()).toEqual([{ id, amountMl: 300 }]);
    a.network.online = true;
    b.network.online = true;
    await a.sync();
    await b.sync();
    await a.sync();

    expect(a.visible()).toEqual([{ id, amountMl: 500 }]);
    expect(b.visible()).toEqual([{ id, amountMl: 500 }]);
    const [row] = await serverRows(backend);
    expect(row?.amountMl).toBe(500);
    expect(a.row(id)?.serverVersion).toBe(row?.serverVersion.toString());
  });
});
