import { useEffect, useState } from 'react';

import { createOpenedModule, useOpenedModule } from '../shell/opened-module';
import type { GameService } from './game-service';
import type { IslandStage } from './role-choice';

// Der Spieldienst des geöffneten Kontos für den Tab „Momo“. Die App-Sitzung meldet ihn je geöffneter
// Kontodatenbank mit `opened` an und löst ihn beim Sperren wieder (`src/session/device-session.ts`).

export const appGameService = createOpenedModule<GameService>();

/** Der Spieldienst des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useGameService(): GameService | null {
  return useOpenedModule(appGameService);
}

/** Die Stufe von Momo im Spieldienst; `null`, bis die erste Lesung da ist. */
export function useIslandStage(game: GameService | null): IslandStage | null {
  const [stage, setStage] = useState<{ game: GameService; value: IslandStage } | null>(null);
  useEffect(() => game?.observeStage((value) => setStage({ game, value })), [game]);
  return stage !== null && stage.game === game ? stage.value : null;
}
