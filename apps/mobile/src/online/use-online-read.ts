import { useQuery } from '@tanstack/react-query';

import type { ContractErrorCode } from '@abnehm/contracts/errors';

import type { OnlineResult } from './online-result';
import type { FlowState } from './use-online-flow';

/**
 * Ein flüchtiger Online-Lesevorgang als TanStack-Query, etwa der Bildabruf eines Mahlzeitenfotos (#164).
 * Das Ergebnis lebt nur, solange ein Bildschirm es zeigt: `gcTime: 0` aus dem `OnlineFlowsProvider` wirft
 * es nach dem Schließen weg, nichts wird persistiert. Solange es angezeigt wird, lädt es nicht von selbst
 * neu (`staleTime: Infinity`); `retry` lädt es erneut, etwa wieder online. Gleiche `key` teilen sich einen
 * Abruf.
 */
export function useOnlineRead<T, C extends ContractErrorCode>(
  key: readonly string[],
  read: () => Promise<OnlineResult<T, C>>,
): { state: FlowState<T, C>; retry(): void } {
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
  });
  const state: FlowState<T, C> = query.data ?? { type: 'pending' };
  return { state, retry: () => void query.refetch() };
}
