import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { EntityId } from '@abnehm/contracts/base';

import type { InvitationFlows } from './invitation-flows';

// TanStack Query v5 orchestriert die Online-Abläufe nur flüchtig (Spezifikation 0, Abschnitte 1 und 9;
// #41): Zustand eines laufenden Aufrufs, sonst nichts. Kein Ergebnis bleibt nach dem Schließen des
// Bildschirms im Cache (`gcTime: 0`), und nichts wird persistiert. Fachdaten kommen per Pull in SQLite.
// Wiederholt wird nie still im Hintergrund, sondern nur, wenn die Person es auslöst; dabei bleibt die
// `requestId` derselben Absicht erhalten (`use-online-flow.ts`).

type OnlineFlowsProps = Readonly<{ invitations: InvitationFlows; newId: () => EntityId }>;

type OnlineFlowsContext = OnlineFlowsProps &
  Readonly<{
    /** Ob mit diesen Abläufen schon ein Code entstand; der Onboarding-Schritt `partner` meldet dann `partner_invite_created`. */
    invitationCreated: boolean;
    markInvitationCreated(): void;
  }>;

const Context = createContext<OnlineFlowsContext | null>(null);

export function OnlineFlowsProvider({ invitations, newId, children }: OnlineFlowsProps & { children: ReactNode }) {
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
  // Nur das Wissen, dass ein Code entstand, nicht der Code selbst; es gilt für diese Abläufe, also dieses Konto.
  const [createdWith, setCreatedWith] = useState<InvitationFlows | null>(null);
  // Neue Abläufe, etwa nach einem Kontowechsel, ersetzen die bisherigen; der flüchtige Cache bleibt leer.
  const value = useMemo<OnlineFlowsContext>(
    () => ({ invitations, newId, invitationCreated: createdWith === invitations, markInvitationCreated: () => setCreatedWith(invitations) }),
    [invitations, newId, createdWith],
  );
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
