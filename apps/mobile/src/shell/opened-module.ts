import { useSyncExternalStore } from 'react';

// Das Fachmodul eines Bereichs für das gerade geöffnete Konto. Die App-Sitzung meldet es je geöffneter
// Kontodatenbank mit `opened` an und löst es beim Sperren wieder (`src/session/device-session.ts`);
// die Bildschirme des Bereichs lesen es mit `useOpenedModule`. Gemeinsam genutzt von Ernährung,
// Trackern und Spieldienst.

export type OpenedModule<T> = Readonly<{
  /** Meldet das Modul eines geöffneten Kontos an; die Rückgabe löst es wieder. */
  opened(module: T): () => void;
  current(): T | null;
  subscribe(listener: () => void): () => void;
}>;

export function createOpenedModule<T>(): OpenedModule<T> {
  let current: T | null = null;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    opened(module) {
      current = module;
      changed();
      return () => {
        if (current !== module) return;
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

/** Das Modul des geöffneten Kontos; `null`, solange keines geöffnet ist. */
export function useOpenedModule<T>(holder: OpenedModule<T>): T | null {
  return useSyncExternalStore(holder.subscribe, holder.current);
}
