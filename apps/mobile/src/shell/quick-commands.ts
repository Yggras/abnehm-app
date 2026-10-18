import type { MessageKey, MessageValues } from '@abnehm/contracts/base';
import type { QuickCommandKey, QuickCommandOutcome, TrackerQuickAction } from '@abnehm/contracts/today';

import { LocalDatabaseClosedError, type LocalDatabase, type TransactionContext } from '../local-db';

// Quick-Command-Registry der App-Shell (Spezifikation 0, Abschnitt 6): Bereiche registrieren je
// `commandKey` aus dem festen Katalog einen Handler. Die Registry öffnet die lokale Transaktion,
// bindet den flüchtigen Undo-Token an den erzeugenden Handler und löst ihn höchstens einmal ein.

/** Ein Quick-Command, wie ihn `TrackerQuickAction` und das ＋-Sheet auslösen. */
export type QuickCommand = Extract<TrackerQuickAction, { type: 'command' }>;

export type QuickCommandParams<K extends QuickCommandKey> = Extract<QuickCommand, { commandKey: K }>['params'];

/** Ergebnis eines Handlers: Meldung und die Daten, die sein eigenes Undo braucht (etwa die Eintrags-ID). */
export type QuickCommandResult<U> = { messageKey: MessageKey; values: MessageValues; undo: U };

/**
 * Handler eines Bereichs. Beide Methoden arbeiten in der Transaktion, die die Registry öffnet, und
 * reichen den opaken Kontext an ihre Repositories weiter: Fachänderung, Outbox und
 * `reevaluateDailyGoals` laufen darin atomar. Wirft eine Methode, wird alles zurückgerollt.
 */
export type QuickCommandHandler<K extends QuickCommandKey, U = unknown> = {
  execute(tx: TransactionContext, params: QuickCommandParams<K>): QuickCommandResult<U>;
  undo(tx: TransactionContext, undo: U): void;
};

/** Typisiert einen Handler, sodass `undo` die Daten aus `execute` kennt. */
export function quickCommandHandler<K extends QuickCommandKey, U>(handler: QuickCommandHandler<K, U>): QuickCommandHandler<K> {
  return handler as QuickCommandHandler<K>;
}

export type QuickCommandHandlers = { readonly [K in QuickCommandKey]?: QuickCommandHandler<K> };

/** Ergebnis von `undo`: rückgängig gemacht oder nichts zu tun, weil der Token nicht mehr gilt. */
export type QuickCommandUndoOutcome = { type: 'undone' } | { type: 'noop' };

export type QuickCommandRegistry = {
  /**
   * Führt den Befehl in einer lokalen Transaktion der geöffneten Kontodatenbank aus. Wirft, wenn sie
   * scheitert, keine Datenbank geöffnet ist (`LocalDatabaseClosedError`) oder der Handler fehlt.
   */
  execute(command: QuickCommand): QuickCommandOutcome;
  /**
   * Macht die Buchung zum Token genau einmal rückgängig. Eingelöste, abgelaufene, unbekannte und
   * Tokens einer geschlossenen Datenbank sind ein No-op. Scheitert das Undo, ist der Token trotzdem
   * verbraucht und der Fehler wird geworfen.
   */
  undo(token: string): QuickCommandUndoOutcome;
  /** Beendet die Lebensdauer eines Tokens, sobald seine Meldung kein „Rückgängig“ mehr anbietet. */
  expire(token: string): void;
};

/** Für einen Quick-Command fehlt der Handler seines Bereichs. */
export class MissingQuickCommandError extends Error {
  constructor(commandKey: QuickCommandKey) {
    super(`Integrationsfehler: Für den Quick-Command ${commandKey} fehlt der Handler.`);
    this.name = 'MissingQuickCommandError';
  }
}

type PendingUndo = { database: LocalDatabase; handler: QuickCommandHandler<QuickCommandKey>; undo: unknown };

// Fortlaufend über alle Registries, damit ein Token nie zu einer späteren Registry passt.
let issuedTokens = 0;

/**
 * Registry über der jeweils geöffneten Kontodatenbank (`LocalDatabases.current`). Ein Token gehört
 * zu der Datenbank, in der er entstand, und lebt von `execute` bis `undo`, `expire` oder dem
 * Schließen dieser Datenbank, etwa bei `401` oder Kontowechsel.
 */
export function createQuickCommandRegistry(
  currentDatabase: () => LocalDatabase | null,
  handlers: QuickCommandHandlers,
): QuickCommandRegistry {
  const pending = new Map<string, PendingUndo>();

  return {
    execute(command) {
      const handler = handlers[command.commandKey];
      if (!handler) throw new MissingQuickCommandError(command.commandKey);
      const database = currentDatabase();
      if (!database) throw new LocalDatabaseClosedError();
      const { messageKey, values, undo } = database.transaction((tx) => handler.execute(tx, command.params));
      const undoToken = `undo-${++issuedTokens}`;
      pending.set(undoToken, { database, handler, undo });
      return { messageKey, values, undoToken };
    },
    undo(token) {
      const claimed = pending.get(token);
      if (!claimed) return { type: 'noop' };
      // Vor der Transaktion beansprucht: Ein zweiter Aufruf findet den Token nicht mehr.
      pending.delete(token);
      try {
        claimed.database.transaction((tx) => claimed.handler.undo(tx, claimed.undo));
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
