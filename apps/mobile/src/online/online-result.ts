import type { ContractErrorCode } from '@abnehm/contracts/errors';

/**
 * Ausgang eines Online-Ablaufs. `rejected` trägt den fachlichen Code des Ablaufs. `offline` heißt:
 * Server nicht erreicht, „Braucht Internet“. `unauthorized`: Die Sitzung ist abgelehnt; das Auth-Modul
 * sperrt schon. `failed` ist alles Unerwartete, etwa eine fremd verwendete `requestId`.
 */
export type OnlineResult<T, C extends ContractErrorCode = ContractErrorCode> =
  | Readonly<{ type: 'ok'; value: T }>
  | Readonly<{ type: 'rejected'; code: C }>
  | Readonly<{ type: 'offline' }>
  | Readonly<{ type: 'unauthorized' }>
  | Readonly<{ type: 'failed' }>;
