/**
 * @jest-environment node
 */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, ServerVersion, TimeZone, type SyncCursor } from '@abnehm/contracts/base';
import type { PartnerDailyGoalStatus, PartnerSummaryEnvelope, RevocationNotice } from '@abnehm/contracts/partner';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { readPartnerCache } from '.';
import { createLocalDatabases } from '../local-db/local-databases';
import { partnerSummary, person } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { personRow } from '../local-db/testing/rows';
import { createSyncEngine, createSyncRegistry, foundationSyncEntities, type SyncTransport } from '../sync';

// Widerrufbarer Partnercache (#106) über die echte Sync-Engine auf echtem SQLite: Der Test gibt die
// Pull-Seiten vor. Die Zusammenarbeit mit dem Server prüft apps/backend/test/partner-projections-app.test.ts.

const PHILIPP = EntityId.parse('00000000-0000-4000-8000-0000000000b1');
const ANNA = EntityId.parse('00000000-0000-4000-8000-0000000000a1');
const COUPLING = EntityId.parse('00000000-0000-4000-8000-0000000000c1');
const at = Instant.parse('2026-10-14T12:00:00.000Z');

let version = 0;
const next = () => ServerVersion.parse(String(++version));

function record(entityType: string, entityId: string, data: object): CanonicalChange {
  return { type: 'record', entityType, entityId: EntityId.parse(entityId), serverVersion: next(), data: data as Record<string, unknown> };
}

const couplingRecord = () =>
  record('coupling', COUPLING, { personLowId: ANNA, personHighId: PHILIPP, status: 'aktiv', startedAt: at, endedAt: null, reactivatedAt: null, createdAt: at, updatedAt: at });

function summary(id: string, overrides: Partial<PartnerSummaryEnvelope> = {}): CanonicalChange {
  const serverVersion = next();
  const data = { type: 'wasser', id, generation: 1, ownerPersonId: ANNA, recipientPersonId: PHILIPP, couplingId: COUPLING,
    period: { type: 'tag', localDate: '2026-10-14' }, dataAsOf: at, serverVersion, content: { progressPercent: 64 }, ...overrides };
  return { type: 'record', entityType: 'partner_summary', entityId: EntityId.parse(id), serverVersion, data };
}

function status(id: string, stage: PartnerDailyGoalStatus['stage']): CanonicalChange {
  const serverVersion = next();
  const data = { id, ownerPersonId: ANNA, recipientPersonId: PHILIPP, couplingId: COUPLING, localDate: '2026-10-14', dataAsOf: at, serverVersion, stage };
  return { type: 'record', entityType: 'partner_daily_goal_status', entityId: EntityId.parse(id), serverVersion, data };
}

function notice(target: RevocationNotice['target'], reason: RevocationNotice['reason']): CanonicalChange {
  const id = randomUUID();
  const serverVersion = next();
  return { type: 'record', entityType: 'revocation_notice', entityId: EntityId.parse(id), serverVersion,
    data: { id, recipientPersonId: PHILIPP, couplingId: COUPLING, target, reason, serverVersion } };
}

async function setup() {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_philipp');
  database.transaction((tx) => sqliteOf(tx).insert(person).values(personRow(PHILIPP, 'konto_philipp')).run());
  const pages: CanonicalChange[][] = [];
  const transport: SyncTransport = {
    push: async () => ({ type: 'unavailable' }),
    pull: async () => ({ type: 'ok', body: { changes: pages.shift() ?? [], next: { type: 'complete', cursor: String(version) as SyncCursor } } }),
  };
  const engine = createSyncEngine({ database, registry: createSyncRegistry(foundationSyncEntities), transport,
    clock: createTestClock({ instant: at, timeZone: TimeZone.parse('Europe/Berlin') }), installationId: EntityId.parse(randomUUID()) });
  return {
    async pull(changes: CanonicalChange[]) {
      pages.push(changes);
      await engine.sync();
    },
    cache: () => database.read((tx) => readPartnerCache(tx)),
    stored: () => database.read((tx) => sqliteOf(tx).select().from(partnerSummary).all()),
    cleanup() {
      databases.lock();
      files.remove();
    },
  };
}

let context: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  version = 0;
  context = await setup();
});
afterEach(() => context.cleanup());

const WATER = '00000000-0000-4000-8000-0000000000d1';
const SPORT = '00000000-0000-4000-8000-0000000000d2';
const STATUS = '00000000-0000-4000-8000-0000000000e1';

describe('Partnercache', () => {
  it('liefert Tageszielstand und Zusammenfassungen in der Reihenfolge der Bereiche', async () => {
    await context.pull([
      couplingRecord(),
      summary(SPORT, { type: 'sport', period: { type: 'woche', from: '2026-10-12', to: '2026-10-18' }, content: { countedMinutes: 45, weeklyTargetMinutes: 150 } } as never),
      summary(WATER),
      status(STATUS, 'unterwegs'),
    ]);

    const cache = context.cache();
    expect(cache.dailyGoalStatus).toMatchObject({ id: STATUS, stage: 'unterwegs' });
    expect(cache.summaries.map((entry) => [entry.type, entry.content])).toEqual([
      ['wasser', { progressPercent: 64 }],
      ['sport', { countedMinutes: 45, weeklyTargetMinutes: 150 }],
    ]);
  });

  it('übernimmt einen neueren Stand und behält ihn gegenüber einem älteren', async () => {
    await context.pull([couplingRecord(), summary(WATER)]);
    const newer = summary(WATER, { content: { progressPercent: 80 } } as never);
    const older = { ...summary(WATER, { content: { progressPercent: 10 } } as never), serverVersion: ServerVersion.parse('1') };

    await context.pull([newer, older]);

    expect(context.cache().summaries).toMatchObject([{ content: { progressPercent: 80 } }]);
  });

  it('löscht den Inhalt bei einer Notice für die Zusammenfassung, auch ohne Löschmarkierung', async () => {
    await context.pull([couplingRecord(), summary(WATER), status(STATUS, 'unterwegs')]);

    await context.pull([notice({ type: 'partner_summary', projectionId: EntityId.parse(WATER) }, 'freigabe_entzogen')]);

    expect(context.stored()).toEqual([]);
    expect(context.cache()).toMatchObject({ summaries: [], dailyGoalStatus: { stage: 'unterwegs' } });
  });

  it('löscht den Inhalt bei einer Löschmarkierung ganz', async () => {
    await context.pull([couplingRecord(), summary(WATER)]);

    await context.pull([{ type: 'tombstone', entityType: 'partner_summary', entityId: EntityId.parse(WATER), serverVersion: next(), deletedAt: at }]);

    expect(context.stored()).toEqual([]);
  });

  it('leert bei einer Notice für die Kopplung den ganzen Partnercache in derselben Seite', async () => {
    await context.pull([couplingRecord(), summary(WATER), status(STATUS, 'fast_geschafft')]);

    await context.pull([notice({ type: 'kopplung' }, 'entkopplung')]);

    expect(context.cache()).toEqual({ dailyGoalStatus: null, summaries: [] });
    expect(context.stored()).toEqual([]);
  });
});
