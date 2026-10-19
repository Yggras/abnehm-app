import { useSyncExternalStore } from 'react';

import type { SessionGate } from '../session-gate';

// Test-Adapter der Sitzungs-Weiche für Komponententests mit dem echten `src/app`: ersetzt
// `use-session-gate` per `jest.mock` und lässt den Test den Zustand stellen. Ohne Zutun steht die
// Weiche auf „Heute“, damit Tests der Fachoberfläche nichts davon wissen müssen.
//
// jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));

let current: SessionGate | null = 'today';
const listeners = new Set<() => void>();

export function setTestGate(gate: SessionGate | null) {
  current = gate;
  for (const listener of [...listeners]) listener();
}

export function useSessionGate(): SessionGate | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
