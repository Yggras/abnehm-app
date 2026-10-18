import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';
import type { z } from 'zod';

import { ContractError } from '@abnehm/contracts/errors';
import { PullResponse, PushResponse } from '@abnehm/contracts/sync';

import type { SyncTransport, TransportReply } from './engine';

/** Was der Transport von einer Antwort des RPC-Clients braucht. */
type Reply = { status: number; json(): Promise<unknown> };

/**
 * Push und Pull über die versionierten Endpunkte `/v1/sync/push` und `/v1/sync/pull`. `fetch` ist das des
 * Auth-Moduls: Es hängt die Sitzung an und sperrt bei `401`. Antworten prüft der Transport gegen die
 * Verträge; Netzfehler, `5xx` und unlesbare Antworten gelten als vorübergehend.
 */
export function createHttpSyncTransport({ baseUrl, fetch }: { baseUrl: string; fetch: typeof globalThis.fetch }): SyncTransport {
  const client = hc<AppType>(baseUrl, { fetch });

  async function exchange<T>(send: () => Promise<Reply>, schema: z.ZodType<T>): Promise<TransportReply<T>> {
    let response: Reply;
    try {
      response = await send();
    } catch {
      return { type: 'unavailable' };
    }
    if (response.status === 401) return { type: 'unauthorized' };
    const body = await response.json().catch(() => undefined);
    if (response.status === 200) {
      const parsed = schema.safeParse(body);
      return parsed.success ? { type: 'ok', body: parsed.data } : { type: 'unavailable' };
    }
    if (response.status >= 400 && response.status < 500) {
      const error = ContractError.safeParse(body);
      if (error.success) return { type: 'rejected', error: error.data };
    }
    return { type: 'unavailable' };
  }

  return {
    push: (request) => exchange(() => client.v1.sync.push.$post({ json: request }), PushResponse),
    pull: (request) => exchange(() => client.v1.sync.pull.$post({ json: request }), PullResponse),
  };
}
