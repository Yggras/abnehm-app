import { AppState } from 'react-native';

import { testCapabilities } from '../build-capabilities';
import type { Refresh } from './followed-source';

/**
 * Anstoß für Beiträge zu „Heute“, die ohne Datenbankänderung neu lesen, damit „heute“ zum nächsten
 * Tag wechselt: im Minutentakt und bei Rückkehr in den Vordergrund. Die Rückgabe beendet ihn.
 */
export const todayRefresh: Refresh = (update) => {
  const interval = setInterval(update, 60_000);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') update();
  });
  return () => {
    clearInterval(interval);
    appState.remove();
  };
};

/**
 * Wie `todayRefresh`, in Test-Artefakten zusätzlich bei jedem Sprung der Testuhr (#114). Bereiche, die
 * „heute“ der Geräteuhr zeigen (Mini-Tracker, Protokoll), lesen damit nach dem Uhr-Link sofort neu.
 */
export function appTodayRefresh(update: () => void): () => void {
  const stopTicks = todayRefresh(update);
  // Erst beim Aufruf gelesen: `build-capabilities` lädt die Testfähigkeiten, die selbst Shell-Module laden.
  const stopClock = testCapabilities?.clock.subscribe(update);
  return () => {
    stopTicks();
    stopClock?.();
  };
}
