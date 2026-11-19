import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';

import type { PushRegistrationTransport } from './push-registration';

// HTTP-Transport der Push-Installation (#139): `POST /v1/push-installations`. Ohne React- oder
// React-Native-Importe, damit der Integrationstest des Backends ihn gegen den echten Server prüft.

const TIMEOUT_MS = 10_000;

/** `fetch` ist das des Auth-Moduls (`AppAuth.fetch`): Es hängt die Sitzung an und sperrt bei `401`. */
export function createPushInstallationTransport({ baseUrl, fetch }: { baseUrl: string; fetch: typeof globalThis.fetch }): PushRegistrationTransport {
  const client = hc<AppType>(baseUrl, { fetch });
  return {
    async register(request) {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
      try {
        const response = await client.v1['push-installations'].$post({ json: request }, { init: { signal: abort.signal } });
        // Die `401` des Guards kennt der RPC-Typ nicht; deshalb als Zahl verglichen.
        const status: number = response.status;
        if (status === 204) return 'ok';
        return status === 401 ? 'unauthorized' : 'failed';
      } catch {
        return 'failed';
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
