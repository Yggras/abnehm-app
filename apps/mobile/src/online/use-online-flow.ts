import { useMutation } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import type { EntityId } from '@abnehm/contracts/base';
import type { ContractErrorCode } from '@abnehm/contracts/errors';

import type { OnlineResult } from './online-result';
import { useOnlineFlows } from './OnlineFlowsProvider';

/** Was ein Bildschirm über einen Online-Ablauf sieht: noch nicht gestartet, läuft oder sein Ausgang. */
export type FlowState<T, C extends ContractErrorCode = ContractErrorCode> = Readonly<{ type: 'idle' }> | Readonly<{ type: 'pending' }> | OnlineResult<T, C>;

/**
 * Ein Online-Ablauf als TanStack-Mutation. Eine Absicht ist der Ablauf mit derselben Eingabe (`keyOf`):
 * Bis zum Erfolg trägt jeder Versuch dieselbe `requestId`, damit ein Retry nach verlorener Antwort beim
 * Server dasselbe Ergebnis erhält statt etwa „Code verbraucht“. Nach dem Erfolg beginnt eine neue Absicht.
 */
export function useOnlineFlow<I, T, C extends ContractErrorCode>(
  run: (input: I, requestId: EntityId) => Promise<OnlineResult<T, C>>,
  keyOf: (input: I) => string,
) {
  const { newId } = useOnlineFlows();
  const intent = useRef<{ key: string; requestId: EntityId } | null>(null);
  const mutation = useMutation({
    mutationFn: async ({ input, requestId }: { input: I; requestId: EntityId }): Promise<OnlineResult<T, C>> => {
      try {
        return await run(input, requestId);
      } catch {
        return { type: 'failed' };
      }
    },
    onSuccess: (result, { requestId }) => {
      if (result.type === 'ok' && intent.current?.requestId === requestId) intent.current = null;
    },
  });
  const { mutate, reset } = mutation;

  const start = useCallback(
    (input: I) => {
      const key = keyOf(input);
      if (intent.current?.key !== key) intent.current = { key, requestId: newId() };
      mutate({ input, requestId: intent.current.requestId });
    },
    [keyOf, mutate, newId],
  );

  const state: FlowState<T, C> = mutation.isPending ? { type: 'pending' } : (mutation.data ?? { type: 'idle' });
  return { state, start, reset };
}
