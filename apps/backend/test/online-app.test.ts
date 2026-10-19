import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { coupling, couplingMember, island, partnerSharing, photoSharing } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { createInvitationFlows } from '../../mobile/src/online/invitation-flows.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';

// Das Modul für Online-Abläufe der App gegen die echte Hono-App mit Postgres (#103): Einladung erzeugen,
// prüfen und annehmen. Fachdaten der Kopplung landen nur per Pull in SQLite, auf beiden Geräten.

const start = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Eine App-Installation mit Kontodatenbank, Sync-Engine und Online-Abläufen über `app.request`. */
async function phone(backend: TestBackend, accountId: string, device: Device, network = { online: true }) {
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
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (!network.online) throw new TypeError('Network request failed');
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${device.token ?? ''}`);
    headers.set('x-forwarded-for', device.ip);
    return backend.app.request(String(input), { ...init, headers });
  };
  const engine = createSyncEngine({
    database,
    registry: createSyncRegistry(foundationSyncEntities),
    transport: createHttpSyncTransport({ baseUrl: testBaseUrl, fetch }),
    clock: createTestClock(start),
    installationId: EntityId.parse(randomUUID()),
  });
  const flows = createInvitationFlows({ baseUrl: testBaseUrl, fetch, sync: engine });
  const rows = () =>
    database.read((tx) => ({
      coupling: sqliteOf(tx).select().from(coupling).all(),
      members: sqliteOf(tx).select().from(couplingMember).all(),
      island: sqliteOf(tx).select().from(island).all(),
      partnerSharing: sqliteOf(tx).select().from(partnerSharing).all(),
      photoSharing: sqliteOf(tx).select().from(photoSharing).all(),
    }));
  return { flows, network, rows, sync: () => engine.sync() };
}

async function setup() {
  const backend = await createTestBackend();
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const phones = { philipp: await phone(backend, philipp.accountId, philipp.device), anna: await phone(backend, anna.accountId, anna.device) };
  // Die eigene Person kommt mit dem ersten Pull; Freigaben verweisen lokal auf sie.
  await phones.philipp.sync();
  await phones.anna.sync();
  return { backend, philipp, anna, phones };
}

describe('Online-Abläufe App ↔ Backend', () => {
  it('Tracer Bullet: Code erzeugen, prüfen, annehmen; die Kopplung kommt per Pull auf beide Geräte', async () => {
    const { philipp, anna, phones } = await setup();

    const created = await phones.philipp.flows.createCode(EntityId.parse(randomUUID()));
    if (created.type !== 'ok') throw new Error(`Code erzeugen: ${created.type}`);
    expect(await phones.anna.flows.checkCode(created.value.code)).toEqual({
      type: 'ok',
      value: { inviterDisplayName: 'Philipp', reactivates: false },
    });
    const accepted = await phones.anna.flows.acceptCode(EntityId.parse(randomUUID()), created.value.code);
    expect(accepted).toMatchObject({ type: 'ok', value: { reactivated: false } });

    // Annas Gerät hat schon gepullt; Philipps Gerät erhält die Kopplung mit seinem nächsten Sync.
    await phones.philipp.sync();
    for (const [own, other] of [
      [anna, philipp],
      [philipp, anna],
    ] as const) {
      const rows = (own === anna ? phones.anna : phones.philipp).rows();
      expect(rows.coupling).toEqual([expect.objectContaining({ status: 'aktiv' })]);
      expect(rows.members.map(({ personId, displayName, role, couplingStatus }) => ({ personId, displayName, role, couplingStatus })).sort(byPerson)).toEqual(
        [
          { personId: philipp.personId, displayName: 'Philipp', role: null, couplingStatus: 'aktiv' },
          { personId: anna.personId, displayName: 'Anna', role: null, couplingStatus: 'aktiv' },
        ].sort(byPerson),
      );
      expect(rows.island).toEqual([expect.objectContaining({ state: 'wartet_auf_rollen', hatchedAt: null })]);
      expect(rows.partnerSharing.map((sharing) => [sharing.ownerPersonId, sharing.level])).toEqual(
        Array.from({ length: 4 }, () => [own.personId, 'zusammengefasst']),
      );
      expect(rows.photoSharing.map((sharing) => [sharing.ownerPersonId, sharing.level])).toEqual([[own.personId, 'geteilt']]);
      expect(JSON.stringify(rows)).not.toContain(`"ownerPersonId":"${other.personId}"`);
    }
  });

  it('meldet fachliche Ablehnungen mit ihrem Code und ohne Netz „offline“', async () => {
    const { phones } = await setup();
    const created = await phones.philipp.flows.createCode(EntityId.parse(randomUUID()));
    if (created.type !== 'ok') throw new Error(`Code erzeugen: ${created.type}`);

    expect(await phones.philipp.flows.checkCode(created.value.code)).toEqual({ type: 'rejected', code: 'invite_self' });
    phones.anna.network.online = false;
    expect(await phones.anna.flows.checkCode(created.value.code)).toEqual({ type: 'offline' });
    expect(await phones.anna.flows.acceptCode(EntityId.parse(randomUUID()), created.value.code)).toEqual({ type: 'offline' });
  });
});

const byPerson = (a: { personId: string }, b: { personId: string }) => (a.personId < b.personId ? -1 : 1);
