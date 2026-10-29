import type { MessageKey, MessageValues } from '@abnehm/contracts/base';
import { useMemo } from 'react';

import { useMessageHost } from './MessageHost';

// Meldung einer Buchung samt „Rückgängig“ über den Meldungs-Host (Spezifikation 0, Abschnitt 6). Quick-
// Commands und die Erfassen-Bildschirme der Bereiche teilen sie: dieselbe Regel für ein scheiterndes
// Undo und für eine Meldung, die sich nicht zeigen lässt.

/** Was eine Buchung für ihre Meldung liefert, etwa ein Quick-Command oder „Eintrag hinzufügen“. */
export type UndoableOutcome = Readonly<{ messageKey: MessageKey; values: MessageValues }>;

export type UndoableMessage = Readonly<{
  /**
   * Zeigt die Meldung mit „Rückgängig“. Der Host ruft `undo.run` höchstens einmal auf; scheitert es,
   * erscheint „Das hat nicht geklappt …“. `undo.expire` läuft, sobald „Rückgängig“ ungenutzt endet.
   */
  show(outcome: UndoableOutcome, undo: Readonly<{ run: () => void; expire: () => void }>): void;
  /** Eine Buchung ist technisch gescheitert; die Person sieht „Das hat nicht geklappt …“. */
  failed(error: unknown): void;
}>;

export function useUndoableMessage(): UndoableMessage {
  const { showMessage } = useMessageHost();
  return useMemo(() => {
    const failed = (error: unknown) => {
      console.error(error);
      showMessage({ messageKey: 'shell.nicht_geklappt', values: {} });
    };
    return {
      failed,
      show({ messageKey, values }, undo) {
        try {
          showMessage({
            messageKey,
            values,
            undo: {
              run: () => {
                try {
                  undo.run();
                } catch (error) {
                  failed(error);
                }
              },
              expire: undo.expire,
            },
          });
        } catch (error) {
          // Ohne Meldung gibt es kein „Rückgängig“; der Token endet hier (fehlender Text im Release).
          undo.expire();
          throw error;
        }
      },
    };
  }, [showMessage]);
}
