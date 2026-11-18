import { useEffect } from 'react';

import { useMessageHost } from '../shell/MessageHost';
import { useGameService } from './app-game-service';
import { messageOfReaction } from './momo-reactions';

/**
 * Zeigt Momos Reaktionen über den Meldungs-Host (Spezifikation 4, Abschnitt 6; #188). Eingebunden im
 * Tab-Layout, das während der ganzen geöffneten Sitzung steht. Solange es angemeldet ist, beansprucht der
 * Spieldienst neue Ereignisse und löst die Haptik aus; ein erneutes Rendern oder Anmelden zeigt nichts doppelt.
 */
export function useMomoReactions(): void {
  const game = useGameService();
  const { showMessage } = useMessageHost();
  useEffect(
    () =>
      // Eine Meldung je Reaktion: Meldungen ohne „Rückgängig“ ersetzen einander, deshalb fasst der Spieldienst
      // alles aus einem Commit zusammen (#188).
      game?.observeReactions((reaction) => showMessage(messageOfReaction(reaction))),
    [game, showMessage],
  );
}
