import type { SqliteDatabase } from './connection';

declare const readBrand: unique symbol;
declare const writeBrand: unique symbol;

/**
 * Opake Lesetransaktion. Bereichscode reicht sie an fachliche Repositories und Lese-Ports weiter;
 * nur Repositories öffnen sie mit `sqliteOf` aus `sqlite.ts`.
 */
export type ReadContext = { readonly [readBrand]: true };

/** Opake Schreibtransaktion; kann auch lesen. */
export type TransactionContext = ReadContext & {
  readonly [writeBrand]: true;
  /**
   * Läuft nach erfolgreichem Commit, nie nach einem Rollback. Die Rückmeldung kann die Transaktion
   * weder verlängern noch zurückrollen; Fehler darin meldet die Datenbank an ihren `onError`.
   */
  afterCommit(callback: () => void): void;
};

type ContextState = { db: SqliteDatabase; open: boolean };

// Der Drizzle-Zugang steckt nicht im Kontext selbst, damit dessen Typ keine Bibliothekstypen nennt.
const states = new WeakMap<object, ContextState>();

export function createReadContext(db: SqliteDatabase): ReadContext {
  const context = {} as ReadContext;
  states.set(context, { db, open: true });
  return context;
}

export function createTransactionContext(db: SqliteDatabase, afterCommit: (callback: () => void) => void): TransactionContext {
  const context = {
    afterCommit(callback: () => void) {
      sqliteOf(context);
      afterCommit(callback);
    },
  } as TransactionContext;
  states.set(context, { db, open: true });
  return context;
}

/** Beendet einen Kontext; danach ist jeder Zugriff ein Fehler, auch ein aufgehobener Verweis. */
export function endContext(context: ReadContext): void {
  const state = states.get(context);
  if (state) state.open = false;
}

/**
 * Drizzle-Datenbank der laufenden Transaktion; schlägt fehl, sobald die Transaktion beendet ist.
 * Nur für fachliche Repositories, die es über `./sqlite` beziehen.
 */
export function sqliteOf(context: ReadContext): SqliteDatabase {
  const state = states.get(context);
  if (!state) throw new TypeError('Unbekannter Transaktionskontext');
  if (!state.open) throw new Error('Transaktionskontext ist beendet');
  return state.db;
}
