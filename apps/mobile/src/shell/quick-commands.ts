import type { MessageKey, MessageValues } from '@abnehm/contracts/base';
import type { QuickCommandKey, QuickCommandOutcome, TrackerQuickAction } from '@abnehm/contracts/today';

import { LocalDatabaseClosedError, type LocalDatabase, type TransactionContext } from '../local-db';
import { createUndoTokens, type UndoOutcome } from './undo-tokens';

// Quick-Command-Registry der App-Shell (Spezifikation 0, Abschnitt 6): Bereiche liefern je
// `commandKey` aus dem festen Katalog einen Handler, die App-Sitzung meldet sie mit der geöffneten
// Kontodatenbank an. Die Registry öffnet die lokale Transaktion, bindet den flüchtigen Undo-Token an
// den erzeugenden Handler und löst ihn höchstens einmal ein (`./undo-tokens`).

/** Ein Quick-Command, wie ihn `TrackerQuickAction` und das ＋-Sheet auslösen. */
export type QuickCommand = Extract<TrackerQuickAction, { type: 'command' }>;

export type QuickCommandParams<K extends QuickCommandKey> = Extract<QuickCommand, { commandKey: K }>['params'];

/** Ergebnis eines Handlers: Meldung und die Daten, die sein eigenes Undo braucht (etwa die Eintrags-ID). */
export type QuickCommandResult<U> = { messageKey: MessageKey; values: MessageValues; undoData: U };

/**
 * Handler eines Bereichs. Beide Methoden arbeiten in der Transaktion, die die Registry öffnet, und
 * reichen den opaken Kontext an ihre Repositories weiter: Fachänderung, Outbox und
 * `reevaluateDailyGoals` laufen darin atomar. Wirft eine Methode, wird alles zurückgerollt.
 */
export type QuickCommandHandler<K extends QuickCommandKey, U = unknown> = {
  execute(tx: TransactionContext, params: QuickCommandParams<K>): QuickCommandResult<U>;
  undo(tx: TransactionContext, undoData: U): void;
};

/** Typisiert einen Handler, sodass `undo` die `undoData` aus `execute` kennt. */
export function quickCommandHandler<K extends QuickCommandKey, U>(handler: QuickCommandHandler<K, U>): QuickCommandHandler<K> {
  return handler as QuickCommandHandler<K>;
}

export type QuickCommandHandlers = { readonly [K in QuickCommandKey]?: QuickCommandHandler<K> };

/** Ergebnis von `undo`: rückgängig gemacht oder nichts zu tun, weil der Token nicht mehr gilt. */
export type QuickCommandUndoOutcome = UndoOutcome;

export type QuickCommandRegistry = {
  /**
   * Führt den Befehl in einer lokalen Transaktion der geöffneten Kontodatenbank aus, mit dem Handler
   * dieses Kontos. Wirft, wenn sie scheitert, keine Datenbank geöffnet ist (`LocalDatabaseClosedError`)
   * oder der Handler fehlt.
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
  /**
   * Die App-Sitzung meldet die geöffnete Kontodatenbank samt den Handlern ihrer Bereiche; die
   * Rückgabe löst sie beim Sperren wieder. Ein später geöffnetes Konto löst das frühere ab.
   */
  opened(database: LocalDatabase, handlers: QuickCommandHandlers): () => void;
};

/** Für einen Quick-Command fehlt der Handler seines Bereichs. */
export class MissingQuickCommandError extends Error {
  constructor(commandKey: QuickCommandKey) {
    super(`Integrationsfehler: Für den Quick-Command ${commandKey} fehlt der Handler.`);
    this.name = 'MissingQuickCommandError';
  }
}

type OpenedAccount = Readonly<{ database: LocalDatabase; handlers: QuickCommandHandlers }>;

/**
 * Registry über der jeweils geöffneten Kontodatenbank. Ein Token gehört zu der Datenbank, in der er
 * entstand, und lebt von `execute` bis `undo`, `expire` oder dem Schließen dieser Datenbank.
 */
export function createQuickCommandRegistry(): QuickCommandRegistry {
  const tokens = createUndoTokens();
  let account: OpenedAccount | null = null;

  return {
    execute(command) {
      const handler = account?.handlers[command.commandKey];
      if (!account) throw new LocalDatabaseClosedError();
      if (!handler) throw new MissingQuickCommandError(command.commandKey);
      const { database } = account;
      const { messageKey, values, undoData } = database.transaction((tx) => handler.execute(tx, command.params));
      return { messageKey, values, undoToken: tokens.issue(database, (tx) => handler.undo(tx, undoData)) };
    },
    undo: (token) => tokens.undo(token),
    expire: (token) => tokens.expire(token),
    opened(database, handlers) {
      const opened = { database, handlers };
      account = opened;
      return () => {
        if (account === opened) account = null;
      };
    },
  };
}
