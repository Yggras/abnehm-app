/**
 * @jest-environment node
 */
import type { LocalDatabase, ReadContext, TransactionContext } from '.';
import { createLocalDatabases } from './local-databases';
import * as schema from './schema';
import { sqliteOf } from './sqlite';
import { createBetterSqliteFiles } from './testing/better-sqlite';
import { personRow, waterRow } from './testing/rows';

// Transaktions-Runner (Spezifikation 0, Abschnitte 3 und 10): atomare Mehrfachschreibvorgänge,
// Rollback und Nach-Commit-Verhalten, geprüft am Interface `LocalDatabase`.

const PERSON = '00000000-0000-4000-8000-00000000000a';
const water = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const addWater = (tx: TransactionContext, n: number, ml = 250) =>
  sqliteOf(tx).insert(schema.waterEntry).values(waterRow(water(n), PERSON, ml)).run();
const waterCount = (tx: ReadContext) => sqliteOf(tx).select().from(schema.waterEntry).all().length;

let files: ReturnType<typeof createBetterSqliteFiles>;
let errors: unknown[];
let db: LocalDatabase;

beforeEach(async () => {
  files = createBetterSqliteFiles();
  errors = [];
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => errors.push(error) });
  db = await databases.open('konto_a');
  db.transaction((tx) => sqliteOf(tx).insert(schema.person).values(personRow(PERSON, 'konto_a')).run());
});

afterEach(() => files.remove());

describe('transaction', () => {
  it('schreibt mehrere Zeilen atomar und liefert das Ergebnis von `work`', () => {
    const result = db.transaction((tx) => {
      addWater(tx, 1);
      addWater(tx, 2);
      return 'fertig';
    });

    expect(result).toBe('fertig');
    expect(db.read(waterCount)).toBe(2);
  });

  it('rollt alle Schreibvorgänge zurück, wenn `work` wirft', () => {
    expect(() =>
      db.transaction((tx) => {
        addWater(tx, 1);
        throw new Error('Fachfehler');
      }),
    ).toThrow('Fachfehler');

    expect(db.read(waterCount)).toBe(0);
  });

  it('rollt zurück, wenn ein späterer Schreibvorgang einen Constraint verletzt', () => {
    expect(() =>
      db.transaction((tx) => {
        addWater(tx, 1);
        addWater(tx, 2, 5000);
      }),
    ).toThrow(/water_entry_amount_check/);

    expect(db.read(waterCount)).toBe(0);
  });

  it('lehnt asynchrone Arbeit ab und rollt sie zurück', () => {
    expect(() =>
      db.transaction(async (tx) => {
        addWater(tx, 1);
      }),
    ).toThrow(/synchron/);

    expect(db.read(waterCount)).toBe(0);
  });

  it('lehnt verschachtelte Transaktionen ab', () => {
    expect(() => db.transaction(() => db.transaction(() => undefined))).toThrow(/Verschachtelte/);
    expect(() => db.transaction(() => db.read(waterCount))).toThrow(/Verschachtelte/);
  });

  it('macht den Kontext nach der Transaktion unbrauchbar', () => {
    let leaked: TransactionContext | undefined;
    db.transaction((tx) => {
      leaked = tx;
    });

    expect(() => addWater(leaked!, 1)).toThrow(/beendet/);
    expect(() => leaked!.afterCommit(() => {})).toThrow(/beendet/);
  });
});

describe('afterCommit', () => {
  it('läuft nach dem Commit in Registrierungsreihenfolge und sieht die geschriebenen Daten', () => {
    const calls: string[] = [];
    db.transaction((tx) => {
      tx.afterCommit(() => calls.push(`erste:${db.read(waterCount)}`));
      addWater(tx, 1);
      tx.afterCommit(() => calls.push('zweite'));
      calls.push('in der Transaktion');
    });

    expect(calls).toEqual(['in der Transaktion', 'erste:1', 'zweite']);
  });

  it('läuft nach einem Rollback nicht', () => {
    const callback = jest.fn();
    expect(() =>
      db.transaction((tx) => {
        tx.afterCommit(callback);
        throw new Error('Fachfehler');
      }),
    ).toThrow();

    expect(callback).not.toHaveBeenCalled();
  });

  it('kann den Commit nicht zurückrollen; Fehler gehen an `onError`, weitere Rückmeldungen laufen trotzdem', () => {
    const failure = new Error('Beobachter kaputt');
    const later = jest.fn();
    db.transaction((tx) => {
      addWater(tx, 1);
      tx.afterCommit(() => {
        throw failure;
      });
      tx.afterCommit(later);
    });

    expect(db.read(waterCount)).toBe(1);
    expect(errors).toEqual([failure]);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('darf selbst eine neue Transaktion starten', () => {
    db.transaction((tx) => {
      addWater(tx, 1);
      tx.afterCommit(() => db.transaction((next) => addWater(next, 2)));
    });

    expect(db.read(waterCount)).toBe(2);
  });
});

describe('read und observe', () => {
  it('liest in einer Lesetransaktion, in der Schreiben scheitert', () => {
    expect(() =>
      db.read((tx) => sqliteOf(tx).insert(schema.waterEntry).values(waterRow(water(1), PERSON)).run()),
    ).toThrow(/readonly/i);
    // Danach ist Schreiben wieder möglich.
    db.transaction((tx) => addWater(tx, 1));
    expect(db.read(waterCount)).toBe(1);
  });

  it('meldet den Stand sofort und nach jedem Commit, nicht nach einem Rollback', () => {
    const seen: number[] = [];
    const stop = db.observe(waterCount, (count) => seen.push(count));
    db.transaction((tx) => addWater(tx, 1));
    expect(() =>
      db.transaction((tx) => {
        addWater(tx, 2);
        throw new Error('Fachfehler');
      }),
    ).toThrow();
    db.transaction((tx) => addWater(tx, 3));
    stop();
    db.transaction((tx) => addWater(tx, 4));

    expect(seen).toEqual([0, 1, 2]);
  });

  it('meldet Lesefehler eines Beobachters an `onError`, ohne andere Beobachter aufzuhalten', () => {
    const failure = new Error('Abfrage kaputt');
    const seen: number[] = [];
    db.observe(
      () => {
        throw failure;
      },
      () => {},
    );
    db.observe(waterCount, (count) => seen.push(count));
    db.transaction((tx) => addWater(tx, 1));

    expect(seen).toEqual([0, 1]);
    expect(errors).toEqual([failure, failure]);
  });

  it('meldet Fehler eines Beobachters an `onError`; der Commit bleibt, andere Beobachter laufen weiter', () => {
    const failure = new Error('Beobachter kaputt');
    const seen: number[] = [];
    db.observe(waterCount, (count) => {
      if (count > 0) throw failure;
    });
    db.observe(waterCount, (count) => seen.push(count));

    expect(() => db.transaction((tx) => addWater(tx, 1))).not.toThrow();

    expect(db.read(waterCount)).toBe(1);
    expect(seen).toEqual([0, 1]);
    expect(errors).toEqual([failure]);
  });
});
