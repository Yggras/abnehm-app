import { sql } from 'drizzle-orm';

import type { SqliteConnection } from './connection';
import { createReadContext, createTransactionContext, endContext, type ReadContext, type TransactionContext } from './context';

/** Lokale Datenbank genau eines Kontos. Alle Zugriffe sind synchron und laufen in Transaktionen. */
export type LocalDatabase = {
  readonly accountId: string;
  /**
   * Führt `work` atomar in einer Schreibtransaktion aus: Wirft `work`, wird alles zurückgerollt.
   * `work` muss synchron sein; verschachtelte Transaktionen gibt es nicht.
   */
  transaction<T>(work: (tx: TransactionContext) => T): T;
  /** Führt `work` in einer Lesetransaktion aus; Schreibversuche scheitern. */
  read<T>(work: (tx: ReadContext) => T): T;
  /**
   * Liest sofort und nach jedem Commit dieser Datenbank erneut und meldet das Ergebnis. Endet mit dem
   * Abmelden oder Schließen der Datenbank; danach kommt keine Meldung mehr.
   */
  observe<T>(read: (tx: ReadContext) => T, listener: (value: T) => void): () => void;
};

/** Zugriff auf eine geschlossene Datenbank, etwa nach `401` oder Kontowechsel. */
export class LocalDatabaseClosedError extends Error {
  override name = 'LocalDatabaseClosedError';
  constructor() {
    super('Die lokale Datenbank dieses Kontos ist geschlossen');
  }
}

type Observer = { read: (tx: ReadContext) => unknown; listener: (value: unknown) => void };

export function openLocalDatabase(
  accountId: string,
  connection: SqliteConnection,
  onError: (error: unknown) => void,
): { database: LocalDatabase; close(): void } {
  const { db } = connection;
  let open = true;
  let inTransaction = false;
  const observers = new Set<Observer>();

  function enter() {
    if (!open) throw new LocalDatabaseClosedError();
    if (inTransaction) throw new Error('Verschachtelte lokale Transaktionen gibt es nicht');
  }

  function read<T>(work: (tx: ReadContext) => T): T {
    enter();
    inTransaction = true;
    try {
      return db.transaction((tx) => {
        tx.run(sql`PRAGMA query_only = ON`);
        const context = createReadContext(tx);
        try {
          return synchronous(work(context));
        } finally {
          endContext(context);
          tx.run(sql`PRAGMA query_only = OFF`);
        }
      });
    } finally {
      inTransaction = false;
    }
  }

  function notify(observer: Observer) {
    let value: unknown;
    try {
      value = read(observer.read);
    } catch (error) {
      onError(error);
      return;
    }
    // Ein Beobachter, der sich beim Lesen abgemeldet hat oder dessen Datenbank geschlossen wurde, bekommt nichts mehr.
    if (open && observers.has(observer)) observer.listener(value);
  }

  const database: LocalDatabase = {
    accountId,
    transaction(work) {
      enter();
      const callbacks: (() => void)[] = [];
      inTransaction = true;
      let result;
      try {
        result = db.transaction(
          (tx) => {
            const context = createTransactionContext(tx, (callback) => callbacks.push(callback));
            try {
              return synchronous(work(context));
            } finally {
              endContext(context);
            }
          },
          { behavior: 'immediate' },
        );
      } finally {
        inTransaction = false;
      }
      for (const callback of callbacks) {
        try {
          callback();
        } catch (error) {
          onError(error);
        }
      }
      for (const observer of [...observers]) notify(observer);
      return result;
    },
    read,
    observe(readValue, listener) {
      if (!open) throw new LocalDatabaseClosedError();
      const observer: Observer = { read: readValue, listener: listener as (value: unknown) => void };
      observers.add(observer);
      notify(observer);
      return () => {
        observers.delete(observer);
      };
    },
  };

  return {
    database,
    close() {
      if (!open) return;
      open = false;
      observers.clear();
      connection.close();
    },
  };
}

function synchronous<T>(result: T): T {
  if (typeof (result as { then?: unknown } | null)?.then === 'function') {
    throw new TypeError('Lokale Transaktionen sind synchron; `work` darf kein Promise liefern');
  }
  return result;
}
