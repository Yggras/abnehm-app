import { useEffect, useState, useSyncExternalStore } from 'react';

import type { Island } from './island';
import type { IslandStage } from './role-choice';

// Der Spieldienst des geöffneten Kontos für den Tab „Momo“. Die App-Sitzung meldet ihn je geöffneter
// Kontodatenbank mit `opened` an und löst ihn beim Sperren wieder (`src/session/device-session.ts`),
// wie das Tracker-Modul.

export type OpenedIsland = {
  /** Meldet den Spieldienst eines geöffneten Kontos an; die Rückgabe löst ihn wieder. */
  opened(island: Island): () => void;
  current(): Island | null;
  subscribe(listener: () => void): () => void;
};

export function createOpenedIsland(): OpenedIsland {
  let current: Island | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    opened(island) {
      current = island;
      changed();
      return () => {
        if (current !== island) return;
        current = null;
        changed();
      };
    },
    current: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const appIsland = createOpenedIsland();

/** Der Spieldienst des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useAppIsland(): Island | null {
  return useSyncExternalStore(appIsland.subscribe, appIsland.current);
}

/** Die Stufe von Momo im Spieldienst; `null`, bis die erste Lesung da ist. */
export function useIslandStage(island: Island | null): IslandStage | null {
  const [stage, setStage] = useState<{ island: Island; value: IslandStage } | null>(null);
  useEffect(() => island?.observeStage((value) => setStage({ island, value })), [island]);
  return stage !== null && stage.island === island ? stage.value : null;
}
