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
  /**
   * Löscht die Datei des Kontos endgültig, beim vollständigen Abmelden; ist sie geöffnet, wird sie vorher
   * geschlossen. Idempotent: Eine fehlende Datei gilt als gelöscht.
   */
  remove(accountId: string): void;
  /** Die geöffnete Datenbank oder `null`. */
  current(): LocalDatabase | null;
};

export type LocalDatabasesOptions = {
  openSqlite: OpenSqlite;
  /** Fehler außerhalb der auslösenden Transaktion: Nach-Commit-Rückmeldungen und Beobachter. */
  onError: (error: unknown) => void;
};

// Die Kontokennung landet im Dateinamen; die Prüfung hält Pfadzeichen fern. Welches Format Better
// Auth vergibt, legt das Auth-Modul fest; dass es in dieses Muster passt, ist hier nicht belegt.
const accountIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

/** Dateiname der Datenbank eines Kontos; eine Kennung mit Pfadzeichen ist ein Fehler. */
export function databaseFileName(accountId: string): string {
  if (!accountIdPattern.test(accountId)) throw new TypeError('Ungültige Kontokennung');
  return `konto-${accountId}.db`;
}

export function createLocalDatabases({ openSqlite, onError }: LocalDatabasesOptions): LocalDatabases {
  let opened: { database: LocalDatabase; close(): void } | null = null;
  // Eine laufende Öffnung; ein zweiter Aufruf für dasselbe Konto wartet auf sie, statt sie zu überholen.
  let pending: { accountId: string; promise: Promise<LocalDatabase> } | null = null;
  // Jede Öffnung oder Sperre erhöht den Zähler; eine überholte Öffnung schließt sich selbst wieder.
  let generation = 0;

  function closeCurrent() {
    opened?.close();
    opened = null;
  }

  function lock() {
    generation++;
    pending = null;
    closeCurrent();
  }

  async function openFresh(accountId: string, fileName: string, ticket: number): Promise<LocalDatabase> {
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
  }

  return {
    open(accountId) {
      let fileName: string;
      try {
        fileName = databaseFileName(accountId);
      } catch (error) {
        return Promise.reject(error);
      }
      if (opened?.database.accountId === accountId) return Promise.resolve(opened.database);
      if (pending?.accountId === accountId) return pending.promise;
      const ticket = ++generation;
      closeCurrent();
      const promise = openFresh(accountId, fileName, ticket).finally(() => {
        if (pending?.promise === promise) pending = null;
      });
      pending = { accountId, promise };
      return promise;
    },
    lock,
    remove(accountId) {
      const fileName = databaseFileName(accountId);
      if (opened?.database.accountId === accountId || pending?.accountId === accountId) lock();
      // Öffnen legt eine fehlende Datei an; so löscht auch eine Wiederholung ohne Sonderfall.
      openSqlite(fileName).destroy();
    },
    current() {
      return opened?.database ?? null;
    },
  };
}
