import { z } from 'zod';

import { Instant, MessageKey } from './base.ts';
import { ContractErrorCode } from './errors.ts';
import { UiActionIntent } from './routes.ts';

/**
 * Zustand eines Beitrags zu „Heute“ oder „Wir“ (Spezifikation 0, Abschnitt 6): genau `loading`,
 * `ready(data)`, `empty(reasonKey, action?)`, `stale(data, dataAsOf)` oder `error(code, retryAction?)`.
 * `reasonKey` grenzt die Leer-Gründe eines Beitrags ein, wo die Spezifikation sie festlegt.
 */
export function contributionState<D extends z.ZodType, R extends z.ZodType<string> = typeof MessageKey>(
  data: D,
  reasonKey: R = MessageKey as unknown as R,
) {
  return z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('loading') }),
    z.strictObject({ type: z.literal('ready'), data }),
    z.strictObject({ type: z.literal('empty'), reasonKey, action: UiActionIntent.optional() }),
    z.strictObject({ type: z.literal('stale'), data, dataAsOf: Instant }),
    z.strictObject({ type: z.literal('error'), code: ContractErrorCode, retryAction: UiActionIntent.optional() }),
  ]);
}

export type ContributionState<T, R extends string = MessageKey> =
  | { type: 'loading' }
  | { type: 'ready'; data: T }
  | { type: 'empty'; reasonKey: R; action?: UiActionIntent }
  | { type: 'stale'; data: T; dataAsOf: Instant }
  | { type: 'error'; code: ContractErrorCode; retryAction?: UiActionIntent };
