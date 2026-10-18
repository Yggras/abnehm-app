import type { OpenSqlite } from './connection';
import { LocalDatabaseClosedError, openLocalDatabase, type LocalDatabase } from './local-database';
import { migrateLocalDatabase } from './migrate';

/**
 * Kontogetrennte lokale Datenbanken (Spezifikation 0, Abschnitt 9): je Konto eine eigene Datei, und
 * höchstens eine ist geöffnet. Wer eine andere öffnet oder sperrt, beendet alle Handles und
 * Beobachtungen der bisherigen; sie liefern danach keine Daten mehr.
 */
export type LocalDatabases = {
  /** Öffnet und migriert die Datenbank des Kontos; ein bereits geöffnetes Konto bleibt offen. */
  open(accountId: string): Promise<LocalDatabase>;
  /**
   * Schließt die geöffnete Datenbank, etwa bei `401`. Die Datei bleibt erhalten, bis sich dasselbe
   * Konto wieder anmeldet.
   */
  lock(): void;
  /** Die geöffnete Datenbank oder `null`. */
  current(): LocalDatabase | null;
};

export type LocalDatabasesOptions = {
  openSqlite: OpenSqlite;
  /** Fehler außerhalb der auslösenden Transaktion: Nach-Commit-Rückmeldungen und Beobachter. */
  onError: (error: unknown) => void;
};

// Kontokennungen von Better Auth; die Prüfung hält Pfadzeichen aus dem Dateinamen fern.
const accountIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

/** Dateiname der lokalen Datenbank eines Kontos. */
export function databaseFileName(accountId: string): string {
  if (!accountIdPattern.test(accountId)) throw new TypeError('Ungültige Kontokennung');
  return `konto-${accountId}.db`;
}

export function createLocalDatabases({ openSqlite, onError }: LocalDatabasesOptions): LocalDatabases {
  let opened: { database: LocalDatabase; close(): void } | null = null;
  // Jede Öffnung oder Sperre erhöht den Zähler; eine überholte Öffnung schließt sich selbst wieder.
  let generation = 0;

  function closeCurrent() {
    opened?.close();
    opened = null;
  }

  return {
    async open(accountId) {
      const fileName = databaseFileName(accountId);
      if (opened?.database.accountId === accountId) return opened.database;
      const ticket = ++generation;
      closeCurrent();
      const connection = openSqlite(fileName);
      try {
        await migrateLocalDatabase(connection.db);
      } catch (error) {
        connection.close();
        throw error;
      }
      if (ticket !== generation) {
        connection.close();
        throw new LocalDatabaseClosedError();
      }
      opened = openLocalDatabase(accountId, connection, onError);
      return opened.database;
    },
    lock() {
      generation++;
      closeCurrent();
    },
    current() {
      return opened?.database ?? null;
    },
  };
}
