/**
 * @jest-environment node
 */
import { LocalDatabaseClosedError, type LocalDatabase, type ReadContext, type TransactionContext } from '.';
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { createSyncEngine, readSyncState } from '../sync/engine';
import { createSyncRegistry } from '../sync/registry';
import { appendOperation } from '../sync/outbox';
import { createLocalDatabases } from './local-databases';
import * as schema from './schema';
import { sqliteOf } from './sqlite';
import { createBetterSqliteFiles } from './testing/better-sqlite';
import { personRow, waterRow } from './testing/rows';

// Kontogetrennte lokale Datenbanken (Spezifikation 0, Abschnitt 9): Nach `401` und Kontowechsel
// liefern weder alte Handles noch Beobachtungen Daten eines anderen Kontos.

const PERSON_A = '00000000-0000-4000-8000-00000000000a';
const PERSON_B = '00000000-0000-4000-8000-00000000000b';

// Stellvertreter für fachliche Repositories: Sie arbeiten nur mit dem opaken Kontext.
const addWater = (tx: TransactionContext, id: string, personId: string, ml: number) =>
  sqliteOf(tx).insert(schema.waterEntry).values(waterRow(id, personId, ml)).run();
const addPerson = (tx: TransactionContext, id: string, accountId: string) =>
  sqliteOf(tx).insert(schema.person).values(personRow(id, accountId)).run();
const waterMl = (tx: ReadContext) =>
  sqliteOf(tx)
    .select({ personId: schema.waterEntry.personId, amountMl: schema.waterEntry.amountMl })
    .from(schema.waterEntry)
    .all();
const persons = (tx: ReadContext) => sqliteOf(tx).select({ accountId: schema.person.accountId }).from(schema.person).all();

function setup() {
  const files = createBetterSqliteFiles();
  const errors: unknown[] = [];
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => errors.push(error) });
  return { files, errors, databases };
}

describe('kontogetrennte lokale Datenbanken', () => {
  let context: ReturnType<typeof setup>;
  beforeEach(() => {
    context = setup();
  });
  afterEach(() => {
    context.databases.lock();
    context.files.remove();
  });

  it('wechselt über 401 von Konto A zu B und zurück, ohne fremde Daten zu zeigen', async () => {
    const { databases, files, errors } = context;

    const a = await databases.open('konto_a');
    a.transaction((tx) => {
      addPerson(tx, PERSON_A, 'konto_a');
      addWater(tx, '10000000-0000-4000-8000-000000000001', PERSON_A, 250);
    });
    const seenA: unknown[] = [];
    a.observe(waterMl, (value) => seenA.push(value));
    a.transaction((tx) => addWater(tx, '10000000-0000-4000-8000-000000000002', PERSON_A, 500));
    expect(seenA).toEqual([
      [{ personId: PERSON_A, amountMl: 250 }],
      [
        { personId: PERSON_A, amountMl: 250 },
        { personId: PERSON_A, amountMl: 500 },
      ],
    ]);

    // 401: Die Fachoberfläche sperrt, die Datei bleibt.
    databases.lock();
    expect(databases.current()).toBeNull();
    expect(() => a.read(waterMl)).toThrow(LocalDatabaseClosedError);
    expect(() => a.transaction((tx) => addWater(tx, '10000000-0000-4000-8000-000000000003', PERSON_A, 1))).toThrow(
      LocalDatabaseClosedError,
    );
    expect(() => a.observe(waterMl, () => {})).toThrow(LocalDatabaseClosedError);

    const b = await databases.open('konto_b');
    expect(b.read(waterMl)).toEqual([]);
    expect(b.read(persons)).toEqual([]);
    const seenB: unknown[] = [];
    b.observe(waterMl, (value) => seenB.push(value));
    b.transaction((tx) => {
      addPerson(tx, PERSON_B, 'konto_b');
      addWater(tx, '20000000-0000-4000-8000-000000000001', PERSON_B, 750);
    });
    expect(seenB).toEqual([[], [{ personId: PERSON_B, amountMl: 750 }]]);
    // Die alte Beobachtung von A hat nichts mehr bekommen.
    expect(seenA).toHaveLength(2);
    expect(() => a.read(waterMl)).toThrow(LocalDatabaseClosedError);

    const aAgain = await databases.open('konto_a');
    expect(aAgain.read(waterMl)).toEqual([
      { personId: PERSON_A, amountMl: 250 },
      { personId: PERSON_A, amountMl: 500 },
    ]);
    expect(aAgain.read(persons)).toEqual([{ accountId: 'konto_a' }]);
    expect(() => b.read(waterMl)).toThrow(LocalDatabaseClosedError);
    expect(seenB).toHaveLength(2);

    expect(files.openedFileNames()).toEqual(['konto-konto_a.db', 'konto-konto_b.db']);
    expect(errors).toEqual([]);
  });

  it('beendet beim Kontowechsel ohne Sperre ebenfalls alle Handles des bisherigen Kontos', async () => {
    const { databases } = context;
    const a = await databases.open('konto_a');
    const b = await databases.open('konto_b');

    expect(databases.current()).toBe(b);
    expect(() => a.read(waterMl)).toThrow(LocalDatabaseClosedError);
  });

  it('gibt für das bereits geöffnete Konto dasselbe Handle zurück', async () => {
    const { databases } = context;
    const first = await databases.open('konto_a');

    expect(await databases.open('konto_a')).toBe(first);
  });

  it('verwirft eine Öffnung, die ein späterer Kontowechsel überholt hat', async () => {
    const { databases } = context;
    const pendingA = databases.open('konto_a');
    const b: Promise<LocalDatabase> = databases.open('konto_b');

    await expect(pendingA).rejects.toThrow(LocalDatabaseClosedError);
    expect(databases.current()).toBe(await b);
  });

  it('verwirft eine Öffnung, die eine Sperre überholt hat', async () => {
    const { databases } = context;
    const pending = databases.open('konto_a');
    databases.lock();

    await expect(pending).rejects.toThrow(LocalDatabaseClosedError);
    expect(databases.current()).toBeNull();
  });

  it('wartet bei zwei gleichzeitigen Öffnungen desselben Kontos auf dieselbe Datenbank', async () => {
    const { databases } = context;
    const [first, second] = await Promise.all([databases.open('konto_a'), databases.open('konto_a')]);

    expect(second).toBe(first);
    expect(databases.current()).toBe(first);
  });

  it('beendet nach einer Sperre in einer Nach-Commit-Rückmeldung die Beobachtungen ohne Fehlermeldung', async () => {
    const { databases, errors } = context;
    const a = await databases.open('konto_a');
    const seen: unknown[] = [];
    a.observe(waterMl, (value) => seen.push(value));

    a.transaction((tx) => {
      addPerson(tx, PERSON_A, 'konto_a');
      addWater(tx, '10000000-0000-4000-8000-000000000001', PERSON_A, 250);
      tx.afterCommit(() => databases.lock());
    });

    expect(seen).toEqual([[]]);
    expect(errors).toEqual([]);
  });

  it('bewahrt bei einem Offline-Update über zwei Versionen Upsert, Delete und Fachbefehl samt Identität und Reihenfolge', async () => {
    const { databases } = context;
    const db = await databases.open('konto_a');
    const id = EntityId.parse('10000000-0000-4000-8000-000000000001');
    const at = Instant.parse('2026-10-14T12:00:00.000Z');
    const operations = [
      { type: 'upsert_entity' as const, operationId: id, entityType: 'water_entry', entityId: id,
        payload: { amountMl: 250 }, knownServerVersion: null, schemaVersion: 1, createdAt: at },
      { type: 'delete_entity' as const, operationId: EntityId.parse('10000000-0000-4000-8000-000000000002'),
        entityType: 'water_entry', entityId: id, knownServerVersion: null, schemaVersion: 1, createdAt: at },
      { type: 'completeDailyGoal' as const, operationId: EntityId.parse('10000000-0000-4000-8000-000000000003'),
        businessKey: 'goal:1', payload: { goalId: id }, knownServerVersion: null, schemaVersion: 1, createdAt: at },
    ];
    db.transaction((tx) => { for (const operation of operations) appendOperation(tx, operation); });
    databases.lock();
    const upgraded = await databases.open('konto_a');
    expect(upgraded.read(readSyncState).outbox).toEqual(operations.map((operation) => ({ ...operation, schemaVersion: 3 })));
  });

  it('bewahrt bereits gesendete Originaloperationen für sichere Wiederholungen', async () => {
    const { databases } = context;
    const db = await databases.open('konto_a');
    const operation = { type: 'delete_entity' as const, operationId: EntityId.parse('10000000-0000-4000-8000-000000000001'),
      entityType: 'water_entry', entityId: EntityId.parse('10000000-0000-4000-8000-000000000002'),
      knownServerVersion: null, schemaVersion: 1, createdAt: Instant.parse('2026-10-14T12:00:00.000Z') };
    db.transaction((tx) => {
      appendOperation(tx, operation);
      sqliteOf(tx).update(schema.outbox).set({ attemptCount: 1 }).run();
    });
    databases.lock();
    const upgraded = await databases.open('konto_a');
    expect(upgraded.read(readSyncState).outbox).toEqual([operation]);
  });

  it('meldet eine nicht transformierbare Operation diagnostizierbar und lässt die Absicht erhalten', async () => {
    const { databases } = context;
    const db = await databases.open('konto_a');
    const operation = { type: 'delete_entity' as const, operationId: EntityId.parse('10000000-0000-4000-8000-000000000001'),
      entityType: 'water_entry', entityId: EntityId.parse('10000000-0000-4000-8000-000000000002'),
      knownServerVersion: null, schemaVersion: 99, createdAt: Instant.parse('2026-10-14T12:00:00.000Z') };
    db.transaction((tx) => appendOperation(tx, operation));
    databases.lock();
    const upgraded = await databases.open('konto_a');
    const engine = createSyncEngine({ database: upgraded, registry: createSyncRegistry([]), installationId: operation.operationId,
      clock: createTestClock({ instant: operation.createdAt, timeZone: TimeZone.parse('Europe/Berlin') }),
      transport: { push: async () => { throw new Error('Darf nicht senden'); },
        pull: async () => ({ type: 'ok', body: { changes: [], next: { type: 'complete', cursor: '0' as never } } }) } });
    expect(engine.status()).toEqual({ type: 'migration_failed', operationId: operation.operationId });
    expect((await engine.sync()).push).toBe('rejected');
    expect(upgraded.read(readSyncState).outbox).toEqual([operation]);
  });

  it('lässt keine Pfadzeichen in den Dateinamen', async () => {
    const { databases, files } = context;
    await databases.open('abc_DEF-123');
    for (const accountId of ['', '../konto', 'a/b', 'a b', 'x'.repeat(129)]) {
      await expect(databases.open(accountId)).rejects.toThrow(TypeError);
    }
    expect(files.openedFileNames()).toEqual(['konto-abc_DEF-123.db']);
  });
});
