/** Lifecycle-Quellen sind Adapter: React Native und Expo Network hängen erst am Composition Root. */
export function startSyncTriggers({ initialActive, sync, observePending, observeForeground, observeNetwork }: {
  initialActive: boolean;
  sync(): Promise<unknown>;
  observePending(listener: (signature: string) => void): () => void;
  observeForeground(listener: (active: boolean) => void): () => void;
  observeNetwork(listener: (online: boolean) => void): () => void;
}) {
  let active = initialActive;
  let online: boolean | null = null;
  let pending = '';
  let initialized = false;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const run = () => { void sync().catch(() => {}); };
  const stopPending = observePending((signature) => {
    const changed = initialized && signature !== pending;
    initialized = true;
    pending = signature;
    if (!changed || !active) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { debounce = null; run(); }, 2000);
  });
  const stopForeground = observeForeground((next) => {
    if (next && !active) run();
    active = next;
    if (!next && debounce) { clearTimeout(debounce); debounce = null; }
  });
  const stopNetwork = observeNetwork((next) => {
    // Der erste positive Status darf ebenfalls auslösen: der Offline-Zustand kann vor der
    // Listener-Registrierung eingetreten sein und bleibt sonst bis zum Minutentakt unbemerkt.
    if (next && online !== true && pending && active) run();
    online = next;
  });
  // Der Takt läuft nur bei offener Kontodatenbank; im Hintergrund erfolgt kein allgemeiner Sync.
  const interval = setInterval(() => { if (active) run(); }, 60_000);
  if (active) run();
  return {
    dispose() {
      stopPending(); stopForeground(); stopNetwork(); clearInterval(interval);
      if (debounce) clearTimeout(debounce);
    },
  };
}
