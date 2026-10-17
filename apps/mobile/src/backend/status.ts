import type { Instant } from '@abnehm/contracts/base';
import { StatusResponse } from '@abnehm/contracts/status';
import type { InferResponseType } from 'hono/client';

import { createBackendClient, type BackendClient } from './client';

export type BackendStatus =
  | { type: 'ok'; databaseTime: Instant }
  | { type: 'database_unavailable' }
  | { type: 'unreachable' }
  | { type: 'invalid_response' };

const TIMEOUT_MS = 5_000;

/** Fragt den versionierten Status-Endpunkt ab; das Backend antwortet erst nach einer Postgres-Abfrage. */
export async function fetchBackendStatus(client: BackendClient = createBackendClient()): Promise<BackendStatus> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const response = await client.v1.status.$get(undefined, { init: { signal: abort.signal } });
    if (response.status !== 200 && response.status !== 503) return { type: 'invalid_response' };
    const parsed = StatusResponse.safeParse(await response.json());
    return parsed.success ? parsed.data : { type: 'invalid_response' };
  } catch {
    return { type: 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

// Typprüfung über Hono RPC: Liefert das Backend etwas anderes als genau den gemeinsamen Vertrag
// (oder geht die Typableitung verloren und wird `any`), scheitert die Typprüfung der App hier
// mit „Type 'true' is not assignable to type 'false'“.
type StatusFromBackend = InferResponseType<BackendClient['v1']['status']['$get']>;
type IsExactly<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const statusMatchesContract: IsExactly<StatusFromBackend, StatusResponse> = true;
void statusMatchesContract;
