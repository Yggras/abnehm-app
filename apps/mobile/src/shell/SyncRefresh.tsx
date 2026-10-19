import { createContext, useContext, type ReactNode } from 'react';

const SyncRefreshContext = createContext<(() => Promise<unknown>) | null>(null);

/** Der App-Root stellt einen Sync-Trigger bereit; Bereichsbildschirme bleiben von der Engine getrennt. */
export function SyncRefreshProvider({ refresh, children }: { refresh: () => Promise<unknown>; children: ReactNode }) {
  return <SyncRefreshContext.Provider value={refresh}>{children}</SyncRefreshContext.Provider>;
}

export function useSyncRefresh() {
  return useContext(SyncRefreshContext);
}
