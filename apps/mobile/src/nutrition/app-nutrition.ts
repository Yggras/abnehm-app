import { useSyncExternalStore } from 'react';

import type { Nutrition } from './nutrition';

// Das Ernährungsmodul des geöffneten Kontos für die Bildschirme des Bereichs. Die App-Sitzung meldet es
// an, sobald eine Kontodatenbank offen ist (`src/session/device-session.ts`), und löst es beim Sperren
// wieder. Ohne geöffnetes Konto liefert `useNutrition` `null`; die Bildschirme zeigen dann ihr Skelett.

let current: Nutrition | null = null;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const appNutrition = {
  /** Meldet das Modul des gerade geöffneten Kontos an; die Rückgabe löst es beim Sperren wieder. */
  opened(nutrition: Nutrition): () => void {
    current = nutrition;
    changed();
    return () => {
      if (current !== nutrition) return;
      current = null;
      changed();
    };
  },
};

/** Das Ernährungsmodul des geöffneten Kontos; `null`, solange keines offen ist. */
export function useNutrition(): Nutrition | null {
  return useSyncExternalStore(subscribe, () => current);
}
