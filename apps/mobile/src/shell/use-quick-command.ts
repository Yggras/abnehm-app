import { useCallback } from 'react';

import { isTestArtifact } from '../test-artifact';
import { appQuickCommands } from './app-quick-commands';
import { useMessageHost } from './MessageHost';
import { MissingQuickCommandError, type QuickCommand } from './quick-commands';
import { useUndoableMessage } from './use-undoable-message';

/**
 * Führt einen Quick-Command ohne Navigation aus und zeigt sein Ergebnis über den Meldungs-Host,
 * mit „Rückgängig“ für genau diese Buchung. Aufrufer sind das ＋-Sheet und die `quickAction` der
 * Mini-Tracker. Fehlt der Handler, zeigt ein Test-Artefakt einen Hinweis; im Release ist das
 * ein Integrationsfehler.
 */
export function useQuickCommand(): (command: QuickCommand) => void {
  const { showMessage } = useMessageHost();
  const message = useUndoableMessage();

  return useCallback(
    (command: QuickCommand) => {
      let outcome;
      try {
        outcome = appQuickCommands.execute(command);
      } catch (error) {
        if (!(error instanceof MissingQuickCommandError)) return message.failed(error);
        if (!isTestArtifact()) throw error;
        return showMessage({ messageKey: 'shell.quick_command.in_arbeit', values: { commandKey: command.commandKey } });
      }

      const { undoToken } = outcome;
      message.show(outcome, { run: () => appQuickCommands.undo(undoToken), expire: () => appQuickCommands.expire(undoToken) });
    },
    [showMessage, message],
  );
}
