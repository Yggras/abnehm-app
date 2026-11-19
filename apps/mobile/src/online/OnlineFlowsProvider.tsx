import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { EntityId } from '@abnehm/contracts/base';

import type { InvitationFlows } from './invitation-flows';

// TanStack Query v5 orchestriert die Online-Abläufe nur flüchtig (Spezifikation 0, Abschnitte 1 und 9;
// #41): Zustand eines laufenden Aufrufs, sonst nichts. Kein Ergebnis bleibt nach dem Schließen des
// Bildschirms im Cache (`gcTime: 0`), und nichts wird persistiert. Fachdaten kommen per Pull in SQLite.
// Wiederholt wird nie still im Hintergrund, sondern nur, wenn die Person es auslöst; dabei bleibt die
// `requestId` derselben Absicht erhalten (`use-online-flow.ts`).

type OnlineFlowsContext = Readonly<{ invitations: InvitationFlows; newId: () => EntityId }>;

const Context = createContext<OnlineFlowsContext | null>(null);

export function OnlineFlowsProvider({ invitations, newId, children }: OnlineFlowsContext & { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // `always`: Ohne Netz meldet der Ablauf selbst „offline“, statt still pausiert zu warten
          // (https://tanstack.com/query/v5/docs/framework/react/guides/network-mode).
          mutations: { retry: false, gcTime: 0, networkMode: 'always' },
          queries: { retry: false, gcTime: 0, networkMode: 'always' },
        },
      }),
  );
  // Neue Abläufe, etwa nach einem Kontowechsel, ersetzen die bisherigen; der flüchtige Cache bleibt leer.
  const value = useMemo<OnlineFlowsContext>(() => ({ invitations, newId }), [invitations, newId]);
  return (
    <QueryClientProvider client={client}>
      <Context.Provider value={value}>{children}</Context.Provider>
    </QueryClientProvider>
  );
}

export function useOnlineFlows(): OnlineFlowsContext {
  const context = useContext(Context);
  if (context === null) throw new Error('Online-Abläufe brauchen den OnlineFlowsProvider');
  return context;
}
