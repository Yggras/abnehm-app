import { AppState } from 'react-native';

/**
 * Anstoß für Beiträge zu „Heute“, die ohne Datenbankänderung neu lesen, damit „heute“ zum nächsten
 * Tag wechselt: im Minutentakt und bei Rückkehr in den Vordergrund. Die Rückgabe beendet ihn.
 */
export function todayRefresh(update: () => void): () => void {
  const interval = setInterval(update, 60_000);
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') update();
  });
  return () => {
    clearInterval(interval);
    appState.remove();
  };
}
