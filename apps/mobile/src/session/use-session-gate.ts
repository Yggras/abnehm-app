import { useSyncExternalStore } from 'react';

import { deviceGate } from './device-session';
import type { SessionGate } from './session-gate';

/** Zustand der Sitzungs-Weiche des Geräts; `null`, bis die gespeicherte Sitzung geprüft ist. */
export function useSessionGate(): SessionGate | null {
  const gate = deviceGate();
  return useSyncExternalStore(gate.subscribe, gate.get);
}
