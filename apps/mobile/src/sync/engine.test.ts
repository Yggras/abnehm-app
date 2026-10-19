/**
 * @jest-environment node
 */
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

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
import { testWaterCommandEntity as testWaterEntity, testWaterRepository } from './testing/test-water';

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
      body: { results: request.operations.map((operation) => applied(operation.operationId, record('entityId' in operation ? operation.entityId : operation.operationId, 1, '1'))) },
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
    writer,
    hookCalls,
    setHook: (next: typeof hook) => {
      hook = next;
    },
  };
}

const outboxRows = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(outbox).all());
const cursorRow = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(syncCursor).get());

describe('Sync der App', () => {
  it('meldet nach 24 Stunden die älteste unbestätigte Änderung und entfernt den Hinweis nach Bestätigung', async () => {
    const context = await setup();
    context.database.transaction((tx) => context.repository.saveTestCommand(tx, EntityId.parse(randomUUID()), 'goal:offen', water(250)));
    const clock = createTestClock(start);
    const engine = createSyncEngine({ database: context.database, registry: createSyncRegistry([...foundationSyncEntities, testWaterEntity]),
      transport: context.transport, clock, installationId });
    expect(engine.status()).toEqual({ type: 'secured' });
    clock.advanceBy(24 * 60 * 60 * 1000 + 1);
    expect(engine.status()).toEqual({ type: 'not_secured_since', since: start.instant });
    await engine.sync();
    expect(engine.status()).toEqual({ type: 'secured' });
    context.databases.lock(); context.files.remove();
  });

  it('pushNow bestätigt bei Fristablauf keinen Teil und behält dieselbe Operation für den Retry', async () => {
    const context = await setup();
    context.database.transaction((tx) => context.repository.saveTestCommand(tx, EntityId.parse(randomUUID()), 'goal:offen', water(250)));
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    context.transport.push = async (request) => { context.transport.pushes.push(request); await waiting; return context.transport.onPush(request); };
    const clock = createTestClock(start);
    const engine = createSyncEngine({ database: context.database, registry: createSyncRegistry([...foundationSyncEntities, testWaterEntity]),
      transport: context.transport, clock, installationId });
    const operation = outboxRows(context.database)[0];
    const result = engine.pushNow({ deadline: Instant.parse('2026-10-14T12:00:25.000Z') });
    clock.advanceBy(26_000);
    release();
    expect(await result).toBe('failed');
    expect(outboxRows(context.database)).toEqual([expect.objectContaining({
      operationId: operation?.operationId, payload: operation?.payload, schemaVersion: operation?.schemaVersion,
      businessKey: operation?.businessKey, createdAt: operation?.createdAt, attemptCount: 1,
    })]);
    expect(context.transport.pulls).toHaveLength(0);
    context.databases.lock(); context.files.remove();
  });

  it('pushNow wartet auf einen laufenden Vordergrund-Zyklus derselben Installation', async () => {
    const context = await setup();
    context.database.transaction((tx) => context.repository.saveTestCommand(tx, EntityId.parse(randomUUID()), 'goal:offen', water(250)));
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    context.transport.push = async (request) => { context.transport.pushes.push(request); await waiting; return context.transport.onPush(request); };
    const foreground = context.engine.sync();
    const background = context.engine.pushNow({ deadline: Instant.parse('2026-10-14T12:00:25.000Z') });
    expect(context.transport.pushes).toHaveLength(1);
    release();
    expect((await foreground).push).toBe('done');
    expect(await background).toBe('nothing_to_push');
    expect(context.transport.pushes).toHaveLength(1);
    context.databases.lock(); context.files.remove();
  });

  it('pushNow sendet genau einen Batch ohne Pull; gleichzeitige Aufrufe teilen den Push', async () => {
    const context = await setup();
    context.database.transaction((tx) => context.repository.saveTestCommand(tx, EntityId.parse(randomUUID()), 'goal:offen', water(250)));
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    context.transport.push = async (request) => { context.transport.pushes.push(request); await waiting; return context.transport.onPush(request); };
    const deadline = Instant.parse('2026-10-14T12:00:25.000Z');
    const first = context.engine.pushNow({ deadline });
    const second = context.engine.pushNow({ deadline });
    expect(context.transport.pushes).toHaveLength(1);
    release();
    expect(await Promise.all([first, second])).toEqual(['pushed', 'pushed']);
    expect(context.transport.pulls).toHaveLength(0);
    expect(await context.engine.pushNow({ deadline })).toBe('nothing_to_push');
    context.databases.lock(); context.files.remove();
  });
  it('übernimmt bei ausgefallenem Push keinen Pull über eine lokal offene Fachänderung', async () => {
    const context = await setup();
    const id = EntityId.parse(randomUUID());
    context.database.transaction((tx) => context.repository.saveTestCommand(tx, id, 'goal:offen', water(250)));
    context.transport.onPush = () => ({ type: 'unavailable' });
    context.transport.onPull = () => ({ type: 'ok', body: { changes: [record(id, 100, '2')],
      next: { type: 'complete', cursor: '2' as never } } });
    expect(await context.engine.sync()).toEqual({ push: 'unavailable', pull: 'done' });
    expect(context.database.read((tx) => context.repository.row(tx, id))?.amountMl).toBe(250);
    expect(outboxRows(context.database)).toHaveLength(1);
    context.databases.lock(); context.files.remove();
  });

  it('meldet dem Haken den alten und den neuen lokalen Tag einer übernommenen Zeile (#105)', async () => {
    const context = await setup();
    const id = EntityId.parse(randomUUID());
    context.database.transaction((tx) =>
      testWaterEntity.applyCanonical(tx, { entityId: id, serverVersion: ServerVersion.parse('1'), data: { ...recordData(250), localDate: '2026-10-13' as never } }),
    );
    const fresh = EntityId.parse(randomUUID());
    context.transport.onPull = () => ({ type: 'ok', body: { changes: [record(id, 300, '2'), record(fresh, 100, '3')],
      next: { type: 'complete', cursor: '3' as never } } });
    expect(await context.engine.sync()).toEqual({ push: 'nothing_to_do', pull: 'done' });
    const day = (localDate: string) => ({ type: 'tag', personId: PERSON, localDate });
    expect(context.hookCalls).toEqual([[
      { entityType: 'water_entry', entityId: id, type: 'record', days: [day('2026-10-13'), day('2026-10-14')] },
      { entityType: 'water_entry', entityId: fresh, type: 'record', days: [day('2026-10-14')] },
    ]]);
    context.databases.lock(); context.files.remove();
  });

  it('sendet Änderungen nach einem Fachbefehl erst mit der kanonischen ID', async () => {
    const context = await setup();
    const local = EntityId.parse(randomUUID());
    const canonical = EntityId.parse(randomUUID());
    context.database.transaction((tx) => {
      context.repository.saveTestCommand(tx, local, 'goal:serialized', water(250));
      context.repository.save(tx, local, water(300));
    });
    let pushes = 0;
    context.transport.onPush = (request) => {
      pushes++;
      if (pushes === 2) {
        expect(request.operations).toMatchObject([{ type: 'upsert_entity', entityId: canonical }]);
        return { type: 'unavailable' };
      }
      expect(request.operations).toHaveLength(1);
      return { type: 'ok', body: { results: [{ type: 'applied', operationId: request.operations[0]!.operationId,
        canonical: { type: 'absent', entityType: 'command_result', entityId: request.operations[0]!.operationId },
        changes: [record(canonical, 250, '1')], idMappings: [{ entityType: 'water_entry', from: local, to: canonical }] }] } };
    };
    expect((await context.engine.sync()).push).toBe('unavailable');
    expect(pushes).toBe(2);
    expect(context.database.read((tx) => context.repository.visible(tx))).toMatchObject([{ id: canonical, amountMl: 300 }]);
    context.databases.lock(); context.files.remove();
  });

  it('behält eine neuere lokale Änderung während der kanonischen ID-Zuordnung', async () => {
    const context = await setup();
    const local = EntityId.parse(randomUUID());
    const canonical = EntityId.parse(randomUUID());
    context.database.transaction((tx) => context.repository.saveTestCommand(tx, local, 'goal:gleicher-tag', water(250)));
    let firstPush = true;
    context.transport.onPush = (request) => {
      if (!firstPush) return { type: 'unavailable' };
      firstPush = false;
      context.database.transaction((tx) => context.repository.save(tx, local, water(300)));
      return { type: 'ok', body: { results: [{ type: 'applied', operationId: request.operations[0]!.operationId,
        canonical: { type: 'absent', entityType: 'command_result', entityId: request.operations[0]!.operationId },
        changes: [record(canonical, 250, '1')], idMappings: [{ entityType: 'water_entry', from: local, to: canonical }] }] } };
    };
    expect((await context.engine.sync()).push).toBe('unavailable');
    expect(context.database.read((tx) => context.repository.visible(tx))).toMatchObject([{ id: canonical, amountMl: 300 }]);
    expect(context.database.read((tx) => context.repository.row(tx, local))).toBeUndefined();
    expect(outboxRows(context.database)).toMatchObject([{ entityId: canonical, payload: expect.objectContaining({ amountMl: 300 }) }]);
    context.databases.lock(); context.files.remove();
  });

  it('tauscht beim kanonischen Duplikat ID, fachlichen Schlüssel und offene Outbox-Payload atomar', async () => {
    const context = await setup();
    const local = EntityId.parse(randomUUID());
    const canonical = EntityId.parse(randomUUID());
    context.database.transaction((tx) => context.repository.saveTestCommand(tx, local, `goal:${local}`, water(250)));
    let firstPush = true;
    context.transport.onPush = (request) => {
      if (!firstPush) return { type: 'unavailable' };
      firstPush = false;
      context.database.transaction((tx) => {
        context.writer.command(tx, { type: 'markEventsSeen', businessKey: `attempted:${local}`,
          payload: { referencedId: local, note: `Zitat ${local}` }, knownServerVersion: null, affectedRefs: [],
          referencePaths: [['businessKey'], ['payload', 'referencedId']] });
        const attempted = sqliteOf(tx).select().from(outbox).all().at(-1)!;
        sqliteOf(tx).update(outbox).set({ attemptCount: 1 }).where(eq(outbox.operationId, attempted.operationId)).run();
        context.writer.command(tx, { type: 'markEventsSeen', businessKey: `next:${local}`,
          payload: { referencedId: local, note: `Zitat ${local}` }, knownServerVersion: null, affectedRefs: [],
          referencePaths: [['businessKey'], ['payload', 'referencedId']] });
      });
      return { type: 'ok', body: { results: [{ type: 'applied', operationId: request.operations[0]!.operationId,
        canonical: { type: 'absent', entityType: 'command_result', entityId: request.operations[0]!.operationId },
        changes: [record(canonical, 250, '1')], idMappings: [{ entityType: 'water_entry', from: local, to: canonical }] }] } };
    };
    expect((await context.engine.sync()).push).toBe('unavailable');
    expect(context.database.read((tx) => context.repository.visible(tx))).toMatchObject([{ id: canonical }]);
    expect(context.database.read((tx) => context.repository.row(tx, local))).toBeUndefined();
    expect(outboxRows(context.database)).toMatchObject([
      { businessKey: `attempted:${local}`, payload: { referencedId: local } },
      { businessKey: `next:${canonical}`, payload: { referencedId: canonical, note: `Zitat ${local}` } },
    ]);
    context.databases.lock(); context.files.remove();
  });
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
      expect.objectContaining({ type: 'upsert_entity', entityType: 'water_entry', entityId: kept, sequence: 1, knownServerVersion: null, schemaVersion: 3 }),
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
    const today = { type: 'tag', personId: PERSON, localDate: '2026-10-14' };
    expect(hookCalls[0]).toEqual([{ entityType: 'water_entry', entityId: id, type: 'reconciled', days: [today, today] }]);
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

  it('behält eine schon bestätigte Zeile, auch wenn eine Ablehnung keinen kanonischen Zustand nennt', async () => {
    const { database, repository, transport, engine } = context;
    const id = EntityId.parse(randomUUID());
    database.transaction((tx) => testWaterEntity.applyCanonical(tx, { entityId: id, serverVersion: ServerVersion.parse('5'), data: recordData(250) }));
    database.transaction((tx) => repository.save(tx, id, water(300)));
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
    expect(database.read((tx) => repository.row(tx, id))).toMatchObject({ amountMl: 300, serverVersion: '5' });
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
