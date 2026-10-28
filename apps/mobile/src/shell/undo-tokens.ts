import type { LocalDatabase, TransactionContext } from '../local-db';
// Direkt aus dem Modul statt über den Index, der expo-sqlite lädt: Node-Integrationstests nutzen die Tokens.
import { LocalDatabaseClosedError } from '../local-db/local-database';

// Flüchtige Undo-Tokens für „Rückgängig“ im Meldungs-Host (Spezifikation 0, Abschnitt 6;
// Spezifikation 3, Abschnitt 4). Ein Token ist nie synchronisiert, wird höchstens einmal eingelöst
// und gehört zu der Kontodatenbank, in der die Buchung entstand. Er lebt bis zum Einlösen, bis
// `expire` oder bis diese Datenbank schließt, etwa bei `401` oder Kontowechsel.

/** Ergebnis von `undo`: rückgängig gemacht oder nichts zu tun, weil der Token nicht mehr gilt. */
export type UndoOutcome = { type: 'undone' } | { type: 'noop' };

export type UndoTokens = {
  /** Merkt das Undo einer gerade bestätigten Buchung vor und liefert seinen Token. */
  issue(database: LocalDatabase, undo: (tx: TransactionContext) => void): string;
  /**
   * Führt das Undo zum Token genau einmal in einer Transaktion seiner Datenbank aus. Eingelöste,
   * abgelaufene, unbekannte und Tokens einer geschlossenen Datenbank sind ein No-op. Scheitert das
   * Undo, ist der Token trotzdem verbraucht und der Fehler wird geworfen.
   */
  undo(token: string): UndoOutcome;
  /** Beendet die Lebensdauer eines Tokens, sobald seine Meldung kein „Rückgängig“ mehr anbietet. */
  expire(token: string): void;
};

type PendingUndo = { database: LocalDatabase; undo: (tx: TransactionContext) => void };

// Fortlaufend über alle Token-Speicher, damit ein Token nie zu einem anderen passt.
let issuedTokens = 0;

export function createUndoTokens(): UndoTokens {
  const pending = new Map<string, PendingUndo>();
  return {
    issue(database, undo) {
      const token = `undo-${++issuedTokens}`;
      pending.set(token, { database, undo });
      return token;
    },
    undo(token) {
      const claimed = pending.get(token);
      if (!claimed) return { type: 'noop' };
      // Vor der Transaktion beansprucht: Ein zweiter Aufruf findet den Token nicht mehr.
      pending.delete(token);
      try {
        claimed.database.transaction((tx) => claimed.undo(tx));
      } catch (error) {
        if (error instanceof LocalDatabaseClosedError) return { type: 'noop' };
        throw error;
      }
      return { type: 'undone' };
    },
    expire(token) {
      pending.delete(token);
    },
  };
}
