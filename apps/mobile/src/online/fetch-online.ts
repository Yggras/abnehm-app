import { ContractError } from '@abnehm/contracts/errors';

import type { OnlineResult } from './online-result';

// Gemeinsamer Rahmen der flüchtigen Online-Lesevorgänge: Bildabruf eigener Mahlzeitenfotos (#164), Fotoliste
// und Bildabruf der Partnerfotos (#122). Die Datei hat bewusst keine React- oder React-Native-Importe:
// Integrationstests des Backends laden sie.

/** Längste Wartezeit auf eine Antwort (Designwert, nicht belegt), wie bei den Einladungsabläufen. */
const TIMEOUT_MS = 10_000;

/** Was der Rahmen von einer Antwort liest; der Erfolgszweig darf mehr verlangen. */
export type OnlineResponse = Pick<Response, 'status' | 'json'>;

/**
 * Führt `request` mit Zeitlimit aus, etwa einen Hono-RPC-Aufruf mit dem `fetch` des Auth-Moduls, und liest eine
 * `200`-Antwort mit `success`. Ohne Netz, nach Zeitüberschreitung oder bei einem Serverfehler ist das Ergebnis
 * `offline`, bei `401` `unauthorized`, bei `403 forbidden` `rejected`, sonst `failed`.
 */
export async function fetchOnline<R extends OnlineResponse, T>(
  request: (signal: AbortSignal) => Promise<R>,
  success: (response: R) => Promise<OnlineResult<T, 'forbidden'>>,
): Promise<OnlineResult<T, 'forbidden'>> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    let response: R;
    try {
      response = await request(abort.signal);
    } catch {
      return { type: 'offline' };
    }
    if (response.status === 401) return { type: 'unauthorized' };
    if (response.status >= 500) return { type: 'offline' };
    if (response.status === 200) return await success(response);
    const error = ContractError.safeParse(await response.json().catch(() => undefined));
    return error.success && error.data.code === 'forbidden' ? { type: 'rejected', code: 'forbidden' } : { type: 'failed' };
  } catch {
    // Abgebrochen oder unterwegs abgerissen.
    return { type: 'offline' };
  } finally {
    clearTimeout(timeout);
  }
}
