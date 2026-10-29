import { useSyncExternalStore } from 'react';

import type { Trackers } from './trackers';

// Das Tracker-Modul des geöffneten Kontos für die Bildschirme des Bereichs. Die App-Sitzung meldet es
// je geöffneter Kontodatenbank mit `opened` an und löst es beim Sperren wieder
// (`src/session/device-session.ts`), wie die Handler der Quick-Command-Registry.

export type OpenedTrackers = {
  /** Meldet das Tracker-Modul eines geöffneten Kontos an; die Rückgabe löst es wieder. */
  opened(trackers: Trackers): () => void;
  current(): Trackers | null;
  subscribe(listener: () => void): () => void;
};

function createOpenedTrackers(): OpenedTrackers {
  let current: Trackers | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    opened(trackers) {
      current = trackers;
      changed();
      return () => {
        if (current !== trackers) return;
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

export const appTrackers = createOpenedTrackers();

/** Das Tracker-Modul des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useAppTrackers(): Trackers | null {
  return useSyncExternalStore(appTrackers.subscribe, appTrackers.current);
}
