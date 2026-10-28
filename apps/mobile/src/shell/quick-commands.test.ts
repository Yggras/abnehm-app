/**
 * @jest-environment node
 */
import { eq } from 'drizzle-orm';

import { LocalDatabaseClosedError, type LocalDatabase, type LocalDatabases, type ReadContext } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import * as schema from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { personRow, waterRow } from '../local-db/testing/rows';
import {
  createQuickCommandRegistry,
  MissingQuickCommandError,
  quickCommandHandler,
  type QuickCommand,
  type QuickCommandHandlers,
} from './quick-commands';

// Quick-Command-Registry (Spezifikation 0, Abschnitt 6) am Interface `execute`/`undo`/`expire`,
// gegen eine echte SQLite-Datei. Den echten Handler für `water.quick_add` liefert Spezifikation 3;
// hier belegt ein Test-Handler den Ablauf.

const PERSON = '00000000-0000-4000-8000-00000000000a';
const water = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const addWater: QuickCommand = { type: 'command', commandKey: 'water.quick_add', params: { ml: 250 } };

const waterMl = (tx: ReadContext) =>
  sqliteOf(tx)
    .select()
    .from(schema.waterEntry)
    .all()
    .map((row) => row.amountMl);

let files: ReturnType<typeof createBetterSqliteFiles>;
let databases: LocalDatabases;
let db: LocalDatabase;
let entries: number;
let undoCalls: string[];

/** Test-Handler: bucht einen Wassereintrag und löscht genau diesen beim Undo; `failUndo` wirft danach. */
const testHandlers = ({ failUndo = false } = {}): QuickCommandHandlers => ({
  'water.quick_add': quickCommandHandler<'water.quick_add', string>({
    execute(tx, { ml }) {
      const id = water(++entries);
      sqliteOf(tx).insert(schema.waterEntry).values(waterRow(id, PERSON, ml)).run();
      return { messageKey: 'wasser.hinzugefuegt', values: { ml }, undoData: id };
    },
    undo(tx, id) {
      undoCalls.push(id);
      sqliteOf(tx).delete(schema.waterEntry).where(eq(schema.waterEntry.id, id)).run();
      if (failUndo) throw new Error('Fachfehler');
    },
  }),
});

beforeEach(async () => {
  files = createBetterSqliteFiles();
  entries = 0;
  undoCalls = [];
  databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  db = await openAccount('konto_a');
});

async function openAccount(accountId: string) {
  const database = await databases.open(accountId);
  database.transaction((tx) => sqliteOf(tx).insert(schema.person).values(personRow(PERSON, accountId)).run());
  return database;
}

afterEach(() => files.remove());

/** Registry, der die App-Sitzung die Kontodatenbank samt Handlern gemeldet hat. */
function registryOn(database: LocalDatabase, handlers: QuickCommandHandlers) {
  const registry = createQuickCommandRegistry();
  registry.opened(database, handlers);
  return registry;
}

describe('execute', () => {
  it('führt den Handler in einer lokalen Transaktion aus und liefert `QuickCommandOutcome` mit Undo-Token', () => {
    const registry = registryOn(db, testHandlers());

    const outcome = registry.execute(addWater);

    expect(outcome).toEqual({ messageKey: 'wasser.hinzugefuegt', values: { ml: 250 }, undoToken: expect.any(String) });
    expect(db.read(waterMl)).toEqual([250]);
  });

  it('rollt zurück, wenn der Handler wirft, und vergibt keinen Token', () => {
    const registry = registryOn(db, {
      'water.quick_add': quickCommandHandler<'water.quick_add', string>({
        execute(tx) {
          sqliteOf(tx).insert(schema.waterEntry).values(waterRow(water(1), PERSON)).run();
          throw new Error('Fachfehler');
        },
        undo() {},
      }),
    });

    expect(() => registry.execute(addWater)).toThrow('Fachfehler');
    expect(db.read(waterMl)).toEqual([]);
  });

  it('bucht in der gemeldeten Kontodatenbank und scheitert, sobald die Sitzung sie wieder löst', async () => {
    const registry = createQuickCommandRegistry();
    expect(() => registry.execute(addWater)).toThrow(LocalDatabaseClosedError);

    const konto = await openAccount('konto_b');
    const release = registry.opened(konto, testHandlers());
    registry.execute(addWater);
    expect(konto.read(waterMl)).toEqual([250]);

    release();
    databases.lock();
    expect(() => registry.execute(addWater)).toThrow(LocalDatabaseClosedError);
  });

  it('nutzt die Handler des geöffneten Kontos; das Lösen eines früheren Kontos ändert daran nichts', async () => {
    const registry = createQuickCommandRegistry();
    const releaseA = registry.opened(db, {});
    const konto = await openAccount('konto_b');
    registry.opened(konto, testHandlers());

    releaseA();
    registry.execute(addWater);

    expect(konto.read(waterMl)).toEqual([250]);
  });

  it('meldet einen fehlenden Handler als `MissingQuickCommandError`', () => {
    const registry = registryOn(db, {});

    expect(() => registry.execute(addWater)).toThrow(MissingQuickCommandError);
  });

  it('vergibt je Ausführung einen eigenen Token', () => {
    const registry = registryOn(db, testHandlers());

    const first = registry.execute(addWater);
    const second = registry.execute(addWater);

    expect(first.undoToken).not.toBe(second.undoToken);
  });
});

describe('undo', () => {
  it('ruft das Undo des erzeugenden Handlers mit seinen Daten auf und macht die Buchung rückgängig', () => {
    const registry = registryOn(db, testHandlers());
    const first = registry.execute(addWater);
    registry.execute(addWater);

    expect(registry.undo(first.undoToken)).toEqual({ type: 'undone' });

    expect(undoCalls).toEqual([water(1)]);
    expect(db.read(waterMl)).toEqual([250]);
  });

  it('löst einen Token höchstens einmal ein, auch bei zweitem Aufruf', () => {
    const registry = registryOn(db, testHandlers());
    const { undoToken } = registry.execute(addWater);

    registry.undo(undoToken);

    expect(registry.undo(undoToken)).toEqual({ type: 'noop' });
    expect(undoCalls).toHaveLength(1);
  });

  it('liefert für einen abgelaufenen Token einen No-op und ruft kein Undo auf', () => {
    const registry = registryOn(db, testHandlers());
    const { undoToken } = registry.execute(addWater);

    registry.expire(undoToken);

    expect(registry.undo(undoToken)).toEqual({ type: 'noop' });
    expect(undoCalls).toEqual([]);
    expect(db.read(waterMl)).toEqual([250]);
  });

  it('liefert für einen unbekannten Token einen No-op', () => {
    const registry = registryOn(db, testHandlers());

    expect(registry.undo('undo-unbekannt')).toEqual({ type: 'noop' });
  });

  it('kennt keine Tokens einer anderen Registry', () => {
    const other = registryOn(db, testHandlers());
    const { undoToken } = other.execute(addWater);

    expect(registryOn(db, testHandlers()).undo(undoToken)).toEqual({ type: 'noop' });
    expect(undoCalls).toEqual([]);
  });

  it('verbraucht den Token auch, wenn das Undo scheitert, und rollt das Undo zurück', () => {
    const registry = registryOn(db, testHandlers({ failUndo: true }));
    const { undoToken } = registry.execute(addWater);

    expect(() => registry.undo(undoToken)).toThrow('Fachfehler');

    expect(db.read(waterMl)).toEqual([250]);
    expect(registry.undo(undoToken)).toEqual({ type: 'noop' });
    expect(undoCalls).toHaveLength(1);
  });

  it('endet mit der Datenbank: Nach dem Sperren des Kontos ist der Token ein No-op', () => {
    const registry = registryOn(db, testHandlers());
    const { undoToken } = registry.execute(addWater);

    databases.lock();

    expect(registry.undo(undoToken)).toEqual({ type: 'noop' });
    expect(undoCalls).toEqual([]);
  });

  it('nach einem Kontowechsel macht ein Token des vorigen Kontos nichts im neuen rückgängig', async () => {
    const registry = registryOn(db, testHandlers());
    const { undoToken } = registry.execute(addWater);

    const konto = await openAccount('konto_b');
    registry.opened(konto, testHandlers());
    registry.execute(addWater);

    expect(registry.undo(undoToken)).toEqual({ type: 'noop' });
    expect(undoCalls).toEqual([]);
    expect(konto.read(waterMl)).toEqual([250]);
  });
});
