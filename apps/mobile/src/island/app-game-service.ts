import type { ChallengeShare } from '@abnehm/game-rules/challenges';
import { useEffect, useState } from 'react';

import { createOpenedModule, useOpenedModule } from '../shell/opened-module';
import type { ChallengeStage } from './challenges';
import type { GameService } from './game-service';
import type { IslandStage } from './role-choice';

// Der Spieldienst des geöffneten Kontos für den Tab „Momo“. Die App-Sitzung meldet ihn je geöffneter
// Kontodatenbank mit `opened` an und löst ihn beim Sperren wieder (`src/session/device-session.ts`).

export const appGameService = createOpenedModule<GameService>();

/** Der Spieldienst des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useGameService(): GameService | null {
  return useOpenedModule(appGameService);
}

/** Der zuletzt gemeldete Wert einer Beobachtung des Spieldienstes; `null`, bis die erste Lesung da ist. */
function useObserved<T>(game: GameService | null, observe: (game: GameService, listener: (value: T) => void) => () => void): T | null {
  const [latest, setLatest] = useState<{ game: GameService; value: T } | null>(null);
  useEffect(() => (game === null ? undefined : observe(game, (value) => setLatest({ game, value }))), [game, observe]);
  return latest !== null && latest.game === game ? latest.value : null;
}

const observeStage = (game: GameService, listener: (stage: IslandStage) => void) => game.observeStage(listener);
const observeChallenges = (game: GameService, listener: (stage: ChallengeStage) => void) => game.observeChallenges(listener);

/** Die Stufe von Momo im Spieldienst; `null`, bis die erste Lesung da ist. */
export function useIslandStage(game: GameService | null): IslandStage | null {
  return useObserved(game, observeStage);
}

/** Wo das Paar mit Challenges steht (#210); `null`, bis die erste Lesung da ist. */
export function useChallengeStage(game: GameService | null): ChallengeStage | null {
  return useObserved(game, observeChallenges);
}

/** Vorschau des eigenen Anteils je Challenge-Vorlage (#210); `null`, bis sie berechnet ist. */
export function useChallengeShares(game: GameService | null): Readonly<Record<string, ChallengeShare>> | null {
  const [shares, setShares] = useState<{ game: GameService; value: Readonly<Record<string, ChallengeShare>> } | null>(null);
  useEffect(() => {
    if (game === null) return;
    let active = true;
    void game.challengeShares().then((value) => {
      if (active) setShares({ game, value });
    });
    return () => {
      active = false;
    };
  }, [game]);
  return shares !== null && shares.game === game ? shares.value : null;
}
