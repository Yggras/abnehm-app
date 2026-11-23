import { useQuery } from '@tanstack/react-query';

import type { ContractErrorCode } from '@abnehm/contracts/errors';

import type { OnlineResult } from './online-result';
import type { FlowState } from './use-online-flow';

/**
 * Ein flüchtiger Online-Lesevorgang als TanStack-Query, etwa der Bildabruf eines Mahlzeitenfotos (#164) oder
 * die Fotoliste „Fotos von heute“ (#122). Das Ergebnis lebt nur, solange ein Bildschirm es zeigt: `gcTime: 0`
 * aus dem `OnlineFlowsProvider` wirft es nach dem Schließen weg, nichts wird persistiert. Solange es angezeigt
 * wird, lädt es nicht von selbst neu (`staleTime: Infinity`); `retry` lädt es erneut, etwa wieder online, und
 * behält bis zur Antwort das bisherige Ergebnis.
 * Gleiche `key` teilen sich einen Abruf. Mit `enabled: false` fragt es nicht ab und ist ohne früheres
 * Ergebnis `idle`, etwa offline oder solange der Bildschirm nicht sichtbar ist.
 */
export function useOnlineRead<T, C extends ContractErrorCode>(
  key: readonly (string | number)[],
  read: () => Promise<OnlineResult<T, C>>,
  { enabled = true }: { enabled?: boolean } = {},
): { state: FlowState<T, C>; retry(): Promise<unknown> } {
  const query = useQuery({
    queryKey: ['online-read', ...key],
    queryFn: async (): Promise<OnlineResult<T, C>> => {
      try {
        return await read();
      } catch {
        return { type: 'failed' };
      }
    },
    staleTime: Infinity,
    enabled,
  });
  const state: FlowState<T, C> = query.data ?? (enabled ? { type: 'pending' } : { type: 'idle' });
  // `refetch` ist im QueryObserver gebunden und bleibt über Renderläufe gleich, taugt also als Effekt-Abhängigkeit.
  return { state, retry: query.refetch };
}
