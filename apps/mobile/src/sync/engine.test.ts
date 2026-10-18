/**
 * @jest-environment node
 */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import type { TestWaterRecord, TestWaterUpsert } from '@abnehm/contracts/fixtures';
import type { CanonicalChange, PullRequest, PullResponse, PushRequest, PushResponse, PushResult } from '@abnehm/contracts/sync';

import { createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncTransport, type TransportReply } from '.';
import type { LocalDatabase, TransactionContext } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { outbox, person, syncCursor } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { personRow } from '../local-db/testing/rows';
import type { CanonicalChangeApplied } from './engine';
import { testWaterEntity, testWaterRepository } from './testing/test-water';

// Sync-Ablauf der App gegen echtes SQLite (better-sqlite3) und einen Transport, den der Test steuert
// (#99). Das Zusammenspiel mit dem echten Backend prüft apps/backend/test/sync-app.test.ts.

const PERSON = EntityId.parse('00000000-0000-4000-8000-00000000000a');
const installationId = EntityId.parse('00000000-0000-4000-8000-0000000000aa');
const start = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };

const water = (amountMl: number): TestWaterUpsert => ({
  amountMl,
  loggedAt: start.instant,
  localDate: '2026-10-14' as TestWaterUpsert['localDate'],
  timeZone: start.timeZone,
  utcOffsetMinutes: 120,
});

const recordData = (amountMl: number): TestWaterRecord => ({ ...water(amountMl), personId: PERSON, createdAt: start.instant, updatedAt: start.instant });

const record = (entityId: string, amountMl: number, serverVersion: string): CanonicalChange => ({
  type: 'record',
  entityType: 'water_entry',
  entityId: EntityId.parse(entityId),
  serverVersion: ServerVersion.parse(serverVersion),
  data: recordData(amountMl),
});

type ScriptedTransport = SyncTransport & {
  pushes: PushRequest[];
  pulls: PullRequest[];
  onPush(request: PushRequest): TransportReply<PushResponse>;
  onPull(request: PullRequest): TransportReply<PullResponse>;
};

/** Transport, dessen Antworten der Test vorgibt; jede Anfrage wird mitgeschrieben. */
function scriptedTransport(): ScriptedTransport {
  const transport: ScriptedTransport = {
    pushes: [],
    pulls: [],
    onPush: (request) => ({
      type: 'ok',
      body: { results: request.operations.map((operation) => applied(operation.operationId, record(operation.entityId, 1, '1'))) },
    }),
    onPull: () => ({ type: 'ok', body: { changes: [], next: { type: 'complete', cursor: '1' as never } } }),
    async push(request) {
      transport.pushes.push(request);
      return transport.onPush(request);
    },
    async pull(request) {
      transport.pulls.push(request);
      return transport.onPull(request);
    },
  };
  return transport;
}

const applied = (operationId: string, canonical: CanonicalChange): PushResult => ({ type: 'applied', operationId: EntityId.parse(operationId), canonical });

async function setup() {
  const files = createBetterSqliteFiles();
  const errors: unknown[] = [];
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => errors.push(error) });
  const database = await databases.open('konto_a');
  database.transaction((tx) => sqliteOf(tx).insert(person).values(personRow(PERSON, 'konto_a')).run());
  const clock = createTestClock(start);
  const registry = createSyncRegistry([...foundationSyncEntities, testWaterEntity]);
  const writer = createSyncWriter({ registry, clock, newId: () => EntityId.parse(randomUUID()) });
  const transport = scriptedTransport();
  const hookCalls: CanonicalChangeApplied[][] = [];
  let hook: (tx: TransactionContext, changes: readonly CanonicalChangeApplied[]) => void = (_tx, changes) => hookCalls.push([...changes]);
  const engine = createSyncEngine({
    database,
    registry,
    transport,
    clock,
    installationId,
    onCanonicalChanges: (tx, changes) => hook(tx, changes),
  });
  const repository = testWaterRepository(writer, () => Instant.parse(clock.read().instant));
  return {
    files,
    databases,
    database,
    transport,
    engine,
    repository,
    hookCalls,
    setHook: (next: typeof hook) => {
      hook = next;
    },
  };
}

const outboxRows = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(outbox).all());
const cursorRow = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(syncCursor).get());

describe('Sync der App', () => {
  let context: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    context = await setup();
  });
  afterEach(() => {
    context.databases.lock();
    context.files.remove();
  });

  it('legt Fachänderung und Outbox-Operation in einer Transaktion an; ein Rollback hinterlässt keine von beiden', () => {
    const { database, repository } = context;
    const kept = EntityId.parse(randomUUID());
    database.transaction((tx) => repository.save(tx, kept, water(250)));
    expect(() =>
      database.transaction((tx) => {
        repository.save(tx, EntityId.parse(randomUUID()), water(500));
        throw new Error('Abbruch im Bereich');
      }),
    ).toThrow('Abbruch im Bereich');

    expect(database.read((tx) => repository.visible(tx)).map((row) => row.amountMl)).toEqual([250]);
    expect(outboxRows(database)).toEqual([
      expect.objectContaining({ type: 'upsert_entity', entityType: 'water_entry', entityId: kept, sequence: 1, knownServerVersion: null, schemaVersion: 1 }),
    ]);
  });

  it('weist Nutzlasten mit Eigentumsgrenze oder ungültigem Inhalt ab, ohne etwas zu schreiben', () => {
    const { database } = context;
    const writer = createSyncWriter({ registry: createSyncRegistry([testWaterEntity]), clock: createTestClock(start), newId: () => EntityId.parse(randomUUID()) });
    const entityId = EntityId.parse(randomUUID());
    expect(() =>
      database.transaction((tx) => writer.upsert(tx, { entityType: 'water_entry', entityId, payload: { ...water(250), personId: PERSON }, knownServerVersion: null })),
    ).toThrow('Eigentumsgrenze');
    expect(() =>
      database.transaction((tx) => writer.upsert(tx, { entityType: 'water_entry', entityId, payload: { amountMl: 250 }, knownServerVersion: null })),
    ).toThrow();
    expect(() => database.transaction((tx) => writer.delete(tx, { entityType: 'person', entityId, knownServerVersion: null }))).toThrow('nicht angemeldet');
    expect(outboxRows(database)).toEqual([]);
  });

  it('entfernt bestätigte Operationen erst zusammen mit der Übernahme des kanonischen Ergebnisses', async () => {
    const { database, repository, transport, engine, setHook } = context;
    const id = EntityId.parse(randomUUID());
    database.transaction((tx) => repository.save(tx, id, water(250)));
    transport.onPush = (request) => ({ type: 'ok', body: { results: [applied(request.operations[0]!.operationId, record(id, 250, '7'))] } });

    // Scheitert die Übernahme, bleibt alles wie vorher und die Operation in der Outbox.
    setHook(() => {
      throw new Error('Ableitung scheitert');
    });
    await expect(engine.sync()).rejects.toThrow('Ableitung scheitert');
    expect(outboxRows(database)).toHaveLength(1);
    expect(database.read((tx) => repository.row(tx, id))?.serverVersion).toBeNull();

    setHook(() => undefined);
    expect(await engine.sync()).toEqual({ push: 'done', pull: 'done' });
    expect(outboxRows(database)).toEqual([]);
    expect(database.read((tx) => repository.row(tx, id))).toMatchObject({ amountMl: 250, serverVersion: '7' });
  });

  it('übernimmt bei dauerhafter Ablehnung den kanonischen Stand und erhält die Wirkung einer jüngeren offenen Operation', async () => {
    const { database, repository, transport, engine, hookCalls } = context;
    const id = EntityId.parse(randomUUID());
    // Bestätigter Stand 250 in Version 5.
    database.transaction((tx) => testWaterEntity.applyCanonical(tx, { entityId: id, serverVersion: ServerVersion.parse('5'), data: recordData(250) }));
    database.transaction((tx) => repository.save(tx, id, water(300)));
    let firstPush = true;
    transport.onPush = (request) => {
      // Der Push der jüngeren Operation scheitert danach vorübergehend; sie bleibt offen.
      if (!firstPush) return { type: 'unavailable' };
      firstPush = false;
      // Während die Anfrage unterwegs ist, ändert die Person den Eintrag erneut.
      database.transaction((tx) => repository.save(tx, id, water(400)));
      return {
        type: 'ok',
        body: {
          results: [
            {
              type: 'permanently_rejected',
              operationId: request.operations[0]!.operationId,
              error: { code: 'invalid_payload', retryable: false },
              canonical: record(id, 250, '5'),
            },
          ],
        },
      };
    };
    transport.onPull = () => ({ type: 'ok', body: { changes: [record(id, 999, '6')], next: { type: 'complete', cursor: '6' as never } } });

    expect(await engine.sync()).toEqual({ push: 'unavailable', pull: 'done' });

    // Die jüngere Operation ist noch offen: Ihre Wirkung bleibt, der Pull überschreibt die Zeile nicht.
    expect(database.read((tx) => repository.row(tx, id))).toMatchObject({ amountMl: 400, serverVersion: '5' });
    expect(outboxRows(database)).toEqual([expect.objectContaining({ entityId: id, payload: expect.objectContaining({ amountMl: 400 }) })]);
    expect(hookCalls[0]).toEqual([{ entityType: 'water_entry', entityId: id, kind: 'reconciled' }]);
  });

  it('entfernt eine abgelehnte Entität ohne kanonischen Zustand lokal', async () => {
    const { database, repository, transport, engine } = context;
    const id = EntityId.parse(randomUUID());
    database.transaction((tx) => repository.save(tx, id, water(250)));
    transport.onPush = (request) => ({
      type: 'ok',
      body: {
        results: [
          {
            type: 'permanently_rejected',
            operationId: request.operations[0]!.operationId,
            error: { code: 'forbidden', retryable: false },
            canonical: { type: 'absent', entityType: 'water_entry', entityId: id },
          },
        ],
      },
    });
    await engine.sync();
    expect(database.read((tx) => repository.row(tx, id))).toBeUndefined();
    expect(outboxRows(database)).toEqual([]);
  });

  it('überschreibt nach gescheitertem Push keine Zeile mit offener Operation und merkt sich den Versuch', async () => {
    const { database, repository, transport, engine } = context;
    const id = EntityId.parse(randomUUID());
    const other = EntityId.parse(randomUUID());
    database.transaction((tx) => repository.save(tx, id, water(300)));
    transport.onPush = () => ({ type: 'unavailable' });
    transport.onPull = () => ({ type: 'ok', body: { changes: [record(id, 999, '9'), record(other, 100, '10')], next: { type: 'complete', cursor: '10' as never } } });

    expect(await engine.sync()).toEqual({ push: 'unavailable', pull: 'done' });

    expect(database.read((tx) => repository.row(tx, id))).toMatchObject({ amountMl: 300, serverVersion: null });
    expect(database.read((tx) => repository.row(tx, other))).toMatchObject({ amountMl: 100, serverVersion: '10' });
    expect(outboxRows(database)).toEqual([expect.objectContaining({ entityId: id, attemptCount: 1, lastErrorCode: 'unavailable', lastAttemptAt: start.instant })]);
  });

  it('übernimmt jede Pull-Seite atomar und speichert den Cursor erst mit der letzten; ein Fehler setzt beim Seitentoken fort', async () => {
    const { database, repository, transport, engine, setHook } = context;
    const [a, b] = [EntityId.parse(randomUUID()), EntityId.parse(randomUUID())];
    transport.onPull = (request) =>
      request.pageToken === null
        ? { type: 'ok', body: { changes: [record(a, 100, '3')], next: { type: 'page', pageToken: 'v1.seite.2' } } }
        : { type: 'ok', body: { changes: [record(b, 200, '4'), { type: 'tombstone', entityType: 'water_entry', entityId: a, serverVersion: '5' as never, deletedAt: start.instant }], next: { type: 'complete', cursor: '5' as never } } };
    let failSecondPage = true;
    setHook((_tx, changes) => {
      if (failSecondPage && changes.some((change) => change.entityId === b)) throw new Error('Seite scheitert');
    });

    await expect(engine.sync()).rejects.toThrow('Seite scheitert');
    // Seite 1 ist vollständig übernommen, Seite 2 gar nicht; der endgültige Cursor fehlt noch.
    expect(database.read((tx) => repository.visible(tx)).map((row) => row.id)).toEqual([a]);
    expect(cursorRow(database)).toMatchObject({ cursor: null, pageToken: 'v1.seite.2' });

    failSecondPage = false;
    expect(await engine.sync()).toEqual({ push: 'nothing_to_do', pull: 'done' });
    expect(transport.pulls.map((request) => [request.cursor, request.pageToken])).toEqual([
      [null, null],
      [null, 'v1.seite.2'],
      [null, 'v1.seite.2'],
    ]);
    expect(database.read((tx) => repository.visible(tx)).map((row) => row.id)).toEqual([b]);
    expect(database.read((tx) => repository.row(tx, a))).toMatchObject({ deletedAt: start.instant, serverVersion: '5' });
    expect(cursorRow(database)).toMatchObject({ cursor: '5', pageToken: null });
  });

  it('ignoriert einen älteren kanonischen Stand und zieht nach full_resync_required vollständig neu', async () => {
    const { database, repository, transport, engine } = context;
    const id = EntityId.parse(randomUUID());
    database.transaction((tx) => sqliteOf(tx).insert(syncCursor).values({ scope: 'konto', cursor: '99', updatedAt: start.instant }).run());
    transport.onPull = (request) =>
      request.cursor === null
        ? { type: 'ok', body: { changes: [record(id, 300, '8'), record(id, 100, '2')], next: { type: 'complete', cursor: '8' as never } } }
        : { type: 'rejected', error: { code: 'full_resync_required', retryable: false } };

    expect(await engine.sync()).toEqual({ push: 'nothing_to_do', pull: 'done' });
    expect(database.read((tx) => repository.row(tx, id))).toMatchObject({ amountMl: 300, serverVersion: '8' });
    expect(cursorRow(database)).toMatchObject({ cursor: '8' });
  });

  it('teilt gleichzeitige Aufrufe auf einen Zyklus auf und pusht ohne Pull, wenn die Sitzung fehlt', async () => {
    const { database, repository, transport, engine } = context;
    database.transaction((tx) => repository.save(tx, EntityId.parse(randomUUID()), water(250)));
    transport.onPush = () => ({ type: 'unauthorized' });
    const [first, second] = await Promise.all([engine.sync(), engine.sync()]);
    expect(first).toEqual({ push: 'unauthorized', pull: 'skipped' });
    expect(second).toBe(first);
    expect(transport.pushes).toHaveLength(1);
    expect(transport.pulls).toHaveLength(0);
  });
});
