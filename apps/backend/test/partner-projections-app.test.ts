import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, LocalDate } from '@abnehm/contracts/base';

import { islandSyncEntities } from '../../mobile/src/island/island-entities.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { outbox, partnerDailyGoalStatus as localStatus, partnerSharing as localSharing, partnerSummary as localSummary } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import { readPartnerCache } from '../../mobile/src/partner-cache/index.ts';
import {
  createHttpSyncTransport,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationSyncEntities,
  setPartnerSharing,
} from '../../mobile/src/sync/index.ts';
import { coupling } from '../src/db/schema/index.ts';
import { invalidatePartnerSummaries } from '../src/partner-projections/invalidations.ts';
import { revokeCoupling } from '../src/partner-projections/revocation.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { coupleByInvitation, worldStart, worldToday } from './support/coupled-world.ts';
import { completeOp, insertDailyGoals } from './support/daily-goals.ts';
import { testPlans, testRecorders, testWaterProjector } from './support/partner-projectors.ts';
import { push } from './support/sync.ts';

// Tracer Bullet für #106 auf echten Geräten: Engine, Outbox und Partnercache der App auf echtem SQLite
// (better-sqlite3) gegen die echte Hono-App mit Postgres. Anna erfüllt ein Tagesziel, und Philipp sieht
// nach dem Pull „unterwegs“. Schaltet Anna eine Freigabe ab, verschwindet die Zusammenfassung von
// Philipps Gerät; nach der Entkopplung ist der Partnercache leer.

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
  const clock = createTestClock(worldStart);
  const registry = createSyncRegistry([...foundationSyncEntities, ...islandSyncEntities]);
  const writer = createSyncWriter({ registry, clock, newId: () => EntityId.parse(randomUUID()) });
  const http = createHttpSyncTransport({
    baseUrl: testBaseUrl,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('authorization', `Bearer ${device.token ?? ''}`);
      headers.set('x-forwarded-for', device.ip);
      return backend.app.request(String(input), { ...init, headers });
    },
  });
  const engine = createSyncEngine({ database, registry, transport: http, clock, installationId: EntityId.parse(randomUUID()) });
  return {
    database,
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
    partner: () => database.read((tx) => readPartnerCache(tx)),
    setSharing: (area: 'wasser', level: 'privat' | 'zusammengefasst') =>
      database.transaction((tx) => setPartnerSharing(tx, writer, { area, level }, Instant.parse(clock.read().instant))),
    rows: () => database.read((tx) => ({
      summaries: sqliteOf(tx).select().from(localSummary).all(),
      statuses: sqliteOf(tx).select().from(localStatus).all(),
      outbox: sqliteOf(tx).select().from(outbox).all(),
    })),
  };
}

async function setup() {
  const clock = createTestClock(worldStart);
  const backend = await createTestBackend({ clock });
  const plans = testPlans();
  backend.partnerProjections.registerProjector(testWaterProjector(plans));
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  plans.set(anna.personId, { validFrom: '2026-10-01', waterTargetMl: 1500, weeklySportTargetMinutes: 150 });
  const { couplingId } = await coupleByInvitation(backend, anna.device, philipp.device);
  const annasPhone = await phone(backend, anna.accountId, anna.device);
  const philippsPhone = await phone(backend, philipp.accountId, philipp.device);
  await annasPhone.sync();
  await philippsPhone.sync();
  const drink = (amountMl: number) =>
    backend.database.db.transaction(async (tx) => {
      await testRecorders.wasser.water(tx, anna.personId, worldToday, amountMl);
      await invalidatePartnerSummaries(tx, { type: 'bereich', ownerPersonId: EntityId.parse(anna.personId), area: 'wasser', localDate: LocalDate.parse(worldToday) },
        new Date(clock.read().instant));
    });
  return { backend, anna, philipp, couplingId, annasPhone, philippsPhone, drink };
}

describe('Partnercache App ↔ Backend', () => {
  it('Tracer Bullet: Anna erfüllt ein Tagesziel, Philipps Gerät zeigt nach dem Pull „unterwegs“', async () => {
    const { backend, anna, philippsPhone } = await setup();
    expect(philippsPhone.partner().dailyGoalStatus).toMatchObject({ ownerPersonId: anna.personId, stage: 'noch_nichts' });

    const [goal] = await insertDailyGoals(backend, anna.personId, worldToday);
    expect((await push(backend, anna.device, [completeOp(goal!)]))[0]?.type).toBe('applied');
    await philippsPhone.sync();

    expect(philippsPhone.partner().dailyGoalStatus).toMatchObject({ ownerPersonId: anna.personId, localDate: worldToday, stage: 'unterwegs' });
  });

  it('Anna schaltet die Wasser-Freigabe ab: Die Zusammenfassung verschwindet von Philipps Gerät, und erneutes Freigeben bringt eine neue Generation', async () => {
    const { annasPhone, philippsPhone, drink } = await setup();
    await drink(750);
    await philippsPhone.sync();
    const [water] = philippsPhone.partner().summaries;
    expect(water).toMatchObject({ type: 'wasser', content: { progressPercent: 50 }, generation: 1 });

    annasPhone.setSharing('wasser', 'privat');
    expect(annasPhone.database.read((tx) => sqliteOf(tx).select().from(localSharing).where(eq(localSharing.area, 'wasser')).get())?.level).toBe('privat');
    await annasPhone.sync();
    expect(annasPhone.rows().outbox).toEqual([]);
    await philippsPhone.sync();

    expect(philippsPhone.partner().summaries).toEqual([]);
    // Der alte Inhalt ist gelöscht, nicht nur ausgeblendet.
    expect(philippsPhone.rows().summaries).toEqual([]);

    annasPhone.setSharing('wasser', 'zusammengefasst');
    await annasPhone.sync();
    await philippsPhone.sync();
    const [again] = philippsPhone.partner().summaries;
    expect(again).toMatchObject({ type: 'wasser', generation: 2, content: { progressPercent: 50 } });
    expect(again?.id).not.toBe(water?.id);
  });

  it('Nach der Entkopplung ist Philipps Partnercache leer', async () => {
    const { backend, couplingId, philippsPhone, drink } = await setup();
    await drink(750);
    await philippsPhone.sync();
    expect(philippsPhone.rows().summaries).toHaveLength(1);

    const at = new Date('2026-10-14T13:00:00.000Z');
    await backend.database.db.transaction(async (tx) => {
      await tx.update(coupling).set({ status: 'archiviert', endedAt: at, updatedAt: at }).where(eq(coupling.id, couplingId));
      await revokeCoupling(tx, couplingId, at);
    });
    await philippsPhone.sync();

    expect(philippsPhone.rows()).toMatchObject({ summaries: [], statuses: [] });
    expect(philippsPhone.partner()).toEqual({ dailyGoalStatus: null, summaries: [] });
  });
});
