import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';

import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { coupling as localCoupling, couplingMember as localMember, sharedAction as localAction } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { readPartnerCache } from '../../mobile/src/partner-cache/index.ts';
import { createHttpSyncTransport, createSyncEngine, createSyncRegistry, foundationSyncEntities } from '../../mobile/src/sync/index.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { coupleByInvitation, worldStart } from './support/coupled-world.ts';
import { actionIdOf, decideOp, roleSwapRequest, testRoleKind } from './support/shared-actions.ts';
import { push } from './support/sync.ts';

// Tracer Bullet für #107 auf echten Geräten: Engine und Adapter der App auf echtem SQLite
// (better-sqlite3) gegen die echte Hono-App mit Postgres. Gemeinsame Aktionen kommen per Pull an.
// Nach der Entkopplung erhält das Gerät nur noch den Archivstatus und die Notice; die Anzeigenamen der
// Mitglieder bleiben lesbar. Nach der Reaktivierung kommen die beim Entkoppeln beendeten Aktionen an.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const http = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({
    database,
    registry: createSyncRegistry(foundationSyncEntities),
    transport: http,
    clock: createTestClock(worldStart),
    installationId: EntityId.parse(randomUUID()),
  });
  return {
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
    rows: () =>
      database.read((tx) => ({
        coupling: sqliteOf(tx).select({ status: localCoupling.status }).from(localCoupling).all(),
        members: sqliteOf(tx)
          .select({ personId: localMember.personId, displayName: localMember.displayName, couplingStatus: localMember.couplingStatus })
          .from(localMember)
          .all(),
        actions: Object.fromEntries(sqliteOf(tx).select().from(localAction).all().map((action) => [action.id, action.status])),
        partner: readPartnerCache(tx),
      })),
  };
}

describe('Gemeinsame Aktionen und Entkoppeln App ↔ Backend', () => {
  it('Aktionen kommen an; nach der Entkopplung bleiben Archivstatus und Namen, nach der Reaktivierung die beendeten Aktionen', async () => {
    const backend = await createTestBackend({ clock: createTestClock(worldStart) });
    backend.sharedActions.registerKind(testRoleKind);
    const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const { couplingId } = await coupleByInvitation(backend, anna.device, philipp.device);
    const annasPhone = await phone(backend, anna.accountId, anna.device);
    const philippsPhone = await phone(backend, philipp.accountId, philipp.device);

    const [accepted, open] = [roleSwapRequest(), roleSwapRequest()];
    const [acceptedId, openId] = [actionIdOf(accepted), actionIdOf(open)];
    await push(backend, anna.device, [accepted]);
    await push(backend, philipp.device, [decideOp(acceptedId, 'annehmen')]);
    await push(backend, anna.device, [open]);
    await philippsPhone.sync();
    expect(philippsPhone.rows()).toMatchObject({ coupling: [{ status: 'aktiv' }], actions: { [acceptedId]: 'angenommen', [openId]: 'offen' } });
    expect(philippsPhone.rows().partner.dailyGoalStatus).not.toBeNull();

    const uncouplingId = randomUUID();
    await backend.database.db.transaction((tx) =>
      backend.uncoupling.uncouple(tx, {
        actionId: EntityId.parse(uncouplingId),
        couplingId: EntityId.parse(couplingId),
        requesterPersonId: EntityId.parse(anna.personId),
        at: new Date('2026-10-14T13:00:00.000Z'),
      }),
    );
    await philippsPhone.sync();

    const archived = philippsPhone.rows();
    expect(archived.coupling).toEqual([{ status: 'archiviert' }]);
    expect(archived.members.map(({ displayName, couplingStatus }) => [displayName, couplingStatus]).sort()).toEqual([
      ['Anna', 'archiviert'],
      ['Philipp', 'archiviert'],
    ]);
    expect(archived.partner).toEqual({ dailyGoalStatus: null, summaries: [] });

    expect(await coupleByInvitation(backend, philipp.device, anna.device)).toEqual({ couplingId, reactivated: true });
    await philippsPhone.sync();
    await annasPhone.sync();

    for (const device of [philippsPhone, annasPhone]) {
      expect(device.rows()).toMatchObject({
        coupling: [{ status: 'aktiv' }],
        actions: { [acceptedId]: 'angenommen', [openId]: 'zurueckgezogen', [uncouplingId]: 'angenommen' },
      });
    }
  });
});
