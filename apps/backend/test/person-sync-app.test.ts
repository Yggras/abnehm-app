import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { couplingMember as localMember, outbox, person as localPerson } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { followPersonTimeZone } from '../../mobile/src/session/time-zone-follower.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
  updateOwnPerson,
  type PersonChange,
} from '../../mobile/src/sync/index.ts';
import { couplingMember, person } from '../src/db/schema/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { call, defaultPassword, newDevice, signIn, type Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';

// Person und Zeitzone im Sync (#110): Engine, Outbox, Person-Upsert und Zeitzonen-Auslöser der App auf
// echtem SQLite gegen die echte Hono-App mit Postgres. Zwei Installationen derselben Person in
// verschiedenen Zonen; keine der beiden Änderungen überschreibt die andere.

const berlin = TimeZone.parse('Europe/Berlin');
const newYork = TimeZone.parse('America/New_York');
const tokyo = TimeZone.parse('Asia/Tokyo');
const start = Instant.parse('2026-10-14T12:00:00.000Z');

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Eine Installation mit eigener Kontodatenbank, Uhr in eigener Zone und eigenem Sitzungstoken. */
async function phone(backend: TestBackend, accountId: string, device: Device, timeZone: TimeZone) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const clock = createTestClock({ instant: start, timeZone });
  const registry = createSyncRegistry(foundationSyncEntities);
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry, clock, newId });
  const network = { online: true };
  const transport = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      if (!network.online) throw new TypeError('Network request failed');
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const errors: unknown[] = [];
  const follower = followPersonTimeZone({
    clock,
    newId,
    commandsFor: (database) => createLocalCommandRegistry({ database, writer, commands: foundationLocalCommands }),
    onError: (error) => errors.push(error),
  });
  // Wie die App-Sitzung: Der Auslöser hängt sich an die geöffnete Kontodatenbank.
  const database = await databases.open(accountId);
  cleanups.push(follower.opened(database));
  const commands = createLocalCommandRegistry({ database, writer, commands: foundationLocalCommands });
  const engine = createSyncEngine({ database, registry, transport, clock, commands, installationId: EntityId.parse(randomUUID()) });
  return {
    network,
    errors,
    sync: () => engine.sync(),
    travel(to: TimeZone) {
      clock.setTimeZone(to);
      follower.check();
    },
    change: (change: PersonChange) => database.transaction((tx) => updateOwnPerson(tx, writer, change, Instant.parse(clock.read().instant))),
    person: () => database.read((tx) => sqliteOf(tx).select().from(localPerson).get()),
    member: (personId: string) => database.read((tx) => sqliteOf(tx).select().from(localMember).all()).find((row) => row.personId === personId),
    outbox: () => database.read((tx) => sqliteOf(tx).select().from(outbox).all()),
  };
}

async function setup() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
  const a = await phone(backend, anna.accountId, anna.device, newYork);
  const b = await phone(backend, anna.accountId, second, berlin);
  const server = async () => {
    const [row] = await backend.database.db.select().from(person).where(eq(person.id, anna.personId));
    return row!;
  };
  return { backend, anna, a, b, server };
}

describe('Zeitzone der Person', () => {
  it('setzt die Gerätezone beim Start, sobald die kanonische Person angekommen ist', async () => {
    const { a, server } = await setup();
    expect(a.outbox()).toEqual([]);

    // Der erste Pull bringt die Person (Bootstrap in Berlin); das Gerät in New York merkt seine Zone vor.
    await a.sync();
    expect(a.outbox()).toMatchObject([{ type: 'updatePersonTimeZone', payload: { timeZone: newYork } }]);
    expect(a.person()?.timeZone).toBe(berlin);

    await a.sync();
    expect((await server()).timeZone).toBe(newYork);
    expect(a.person()?.timeZone).toBe(newYork);
    expect(a.outbox()).toEqual([]);
    expect(a.errors).toEqual([]);
  });

  it('folgt jedem Zeitzonenwechsel, auch zurück in eine schon gesetzte Zone', async () => {
    const { a, server } = await setup();
    await a.sync();
    await a.sync();

    a.travel(tokyo);
    await a.sync();
    expect((await server()).timeZone).toBe(tokyo);

    a.travel(newYork);
    await a.sync();
    expect((await server()).timeZone).toBe(newYork);
    expect(a.person()?.timeZone).toBe(newYork);

    // Ohne Wechsel entsteht kein weiterer Befehl.
    a.travel(newYork);
    expect(a.outbox()).toEqual([]);
  });

  it('merkt offline jeden Wechsel in Reihenfolge vor; der letzte gewinnt', async () => {
    const { a, server } = await setup();
    await a.sync();
    a.network.online = false;
    a.travel(tokyo);
    a.travel(berlin);
    expect((await a.sync()).push).toBe('unavailable');
    expect(a.outbox().map((row) => row.payload)).toEqual([{ timeZone: newYork }, { timeZone: tokyo }, { timeZone: berlin }]);

    a.network.online = true;
    await a.sync();
    expect((await server()).timeZone).toBe(berlin);
    expect(a.person()?.timeZone).toBe(berlin);
  });

  it('überschreibt mit einem veralteten Person-Datensatz keine anderen Felder', async () => {
    const { a, b, server } = await setup();
    await a.sync();
    await a.sync();
    await b.sync();
    // B ist in Berlin, die Person schon in New York: Der Start merkt Berlin vor.
    b.network.online = false;
    expect(b.outbox()).toHaveLength(1);

    // A benennt die Person um; B kennt den neuen Namen nicht, bevor es seine Zone sendet.
    a.change({ displayName: 'Anna B.' });
    await a.sync();
    b.network.online = true;
    await b.sync();

    expect(await server()).toMatchObject({ displayName: 'Anna B.', timeZone: berlin });
    expect(b.person()).toMatchObject({ displayName: 'Anna B.', timeZone: berlin });
    await a.sync();
    expect(a.person()).toMatchObject({ displayName: 'Anna B.', timeZone: berlin });
  });

  it('setzt die Zeitzone mit einer Namensänderung von einem anderen Gerät nicht zurück', async () => {
    const { a, b, server } = await setup();
    await b.sync();
    // B in Berlin: Die Person ist dort schon, B merkt nichts vor.
    expect(b.outbox()).toEqual([]);

    await a.sync();
    await a.sync();
    expect((await server()).timeZone).toBe(newYork);

    // B kennt die neue Zone noch nicht und ändert den Namen über den Person-Upsert.
    expect(b.person()?.timeZone).toBe(berlin);
    b.change({ displayName: 'Anna B.' });
    expect(b.outbox()).toMatchObject([{ type: 'upsert_entity', entityType: 'person' }]);
    expect(b.outbox()[0]?.payload).not.toHaveProperty('timeZone');
    await b.sync();

    expect(await server()).toMatchObject({ displayName: 'Anna B.', timeZone: newYork });
    expect(b.person()).toMatchObject({ displayName: 'Anna B.', timeZone: newYork });
    // Der Pull mit der Zone von A löst auf B keinen eigenen Befehl aus.
    expect(b.outbox()).toEqual([]);
  });
});

describe('Person-Upsert', () => {
  it('zieht den Anzeigenamen in derselben Transaktion am Kopplungsmitglied nach', async () => {
    const backend = await createTestBackend();
    const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const invitation = await call(backend, 'POST', '/v1/invitations', philipp.device, { requestId: randomUUID() });
    const { code } = invitation.body as { code: string };
    expect((await call(backend, 'POST', '/v1/invitations/accept', anna.device, { requestId: randomUUID(), code })).status).toBe(200);
    const annaPhone = await phone(backend, anna.accountId, anna.device, berlin);
    const philippPhone = await phone(backend, philipp.accountId, philipp.device, berlin);
    await annaPhone.sync();
    await philippPhone.sync();
    expect(philippPhone.member(anna.personId)?.displayName).toBe('Anna');

    annaPhone.change({ displayName: 'Anna B.' });
    await annaPhone.sync();

    const [renamed] = await backend.database.db.select().from(person).where(eq(person.id, anna.personId));
    const [member] = await backend.database.db.select().from(couplingMember).where(eq(couplingMember.personId, anna.personId));
    // Dieselbe Transaktion: gleicher Zeitpunkt, die Position des Mitglieds direkt nach der Person.
    expect(member).toMatchObject({ displayName: 'Anna B.', updatedAt: renamed!.updatedAt, serverVersion: renamed!.serverVersion + 1n });
    await philippPhone.sync();
    expect(philippPhone.member(anna.personId)?.displayName).toBe('Anna B.');
  });
});
