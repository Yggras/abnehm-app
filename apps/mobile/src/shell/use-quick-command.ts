import { useCallback } from 'react';

import { appQuickCommands } from './app-quick-commands';
import { useMessageHost } from './MessageHost';
import { MissingQuickCommandError, type QuickCommand } from './quick-commands';

/**
 * Führt einen Quick-Command ohne Navigation aus und zeigt sein Ergebnis über den Meldungs-Host,
 * mit „Rückgängig“ für genau diese Buchung. Aufrufer sind das ＋-Sheet und die `quickAction` der
 * Mini-Tracker. Fehlt der Handler, zeigt der Development Build einen Hinweis; im Release ist das
 * ein Integrationsfehler.
 */
export function useQuickCommand(): (command: QuickCommand) => void {
  const { showMessage } = useMessageHost();

  return useCallback(
    (command: QuickCommand) => {
      const failed = (error: unknown) => {
        console.error(error);
        showMessage({ messageKey: 'shell.nicht_geklappt', values: {} });
      };

      let outcome;
      try {
        outcome = appQuickCommands.execute(command);
      } catch (error) {
        if (!(error instanceof MissingQuickCommandError)) return failed(error);
        if (!__DEV__) throw error;
        return showMessage({ messageKey: 'shell.quick_command.in_arbeit', values: { commandKey: command.commandKey } });
      }

      const { messageKey, values, undoToken } = outcome;
      const expire = () => appQuickCommands.expire(undoToken);
      try {
        showMessage({
          messageKey,
          values,
          undo: {
            run: () => {
              try {
                appQuickCommands.undo(undoToken);
              } catch (error) {
                failed(error);
              }
            },
            expire,
          },
        });
      } catch (error) {
        // Ohne Meldung gibt es kein „Rückgängig“; der Token endet hier (fehlender Text im Release).
        expire();
        throw error;
      }
    },
    [showMessage],
  );
}
