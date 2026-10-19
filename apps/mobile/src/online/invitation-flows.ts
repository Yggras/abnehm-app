import type { AppType } from '@abnehm/backend/rpc';
import { hc } from 'hono/client';
import type { z } from 'zod';

import type { EntityId } from '@abnehm/contracts/base';
import {
  AcceptInvitationResult,
  CheckInvitationResult,
  CreateInvitationResult,
  InvitationErrorCode,
  type InviteCode,
} from '@abnehm/contracts/coupling';
import { ContractError } from '@abnehm/contracts/errors';

// Online-Abläufe zum Koppeln (Spezifikation 0, Abschnitt 9; #103). Sie laufen nur mit Netz, gehören
// nicht zum Fach-Sync und halten keine Fachdaten: Nach der Annahme kommen Kopplung, Mitglieder, Insel
// und Freigaben ausschließlich per Pull in SQLite. Bildschirme nutzen die Hooks aus `./index`.
//
// Die Datei hat bewusst keine React- oder React-Native-Importe: Der Integrationstest des Backends prüft
// sie gegen den echten Server.

/**
 * Ausgang eines Online-Ablaufs. `rejected` trägt den fachlichen Code; die App zeigt für ungültige,
 * abgelaufene, verbrauchte und eigene Codes denselben Text. `offline` heißt: Server nicht erreicht,
 * „Braucht Internet“. `unauthorized`: Die Sitzung ist abgelehnt; das Auth-Modul sperrt schon.
 * `failed` ist alles Unerwartete, etwa eine fremd verwendete `requestId`.
 */
export type OnlineResult<T> =
  | Readonly<{ type: 'ok'; value: T }>
  | Readonly<{ type: 'rejected'; code: InvitationErrorCode }>
  | Readonly<{ type: 'offline' }>
  | Readonly<{ type: 'unauthorized' }>
  | Readonly<{ type: 'failed' }>;

export type InvitationFlows = {
  /** Erzeugt einen Code; ein Retry mit derselben `requestId` liefert denselben Code. */
  createCode(requestId: EntityId): Promise<OnlineResult<CreateInvitationResult>>;
  /** Nennt die einladende Person und ob die Annahme reaktiviert, ohne den Code zu verbrauchen. */
  checkCode(code: InviteCode): Promise<OnlineResult<CheckInvitationResult>>;
  /**
   * Nimmt die Einladung an und stößt danach einen Sync an, der die Kopplung in SQLite holt. Scheitert
   * nur dieser Sync, gilt die Annahme trotzdem; die Daten kommen mit dem nächsten Sync.
   */
  acceptCode(requestId: EntityId, code: InviteCode): Promise<OnlineResult<AcceptInvitationResult>>;
};

/** Was die Abläufe vom Sync brauchen: einen Zyklus, der die Kopplung per Pull holt. */
export type SyncTrigger = { sync(): Promise<unknown> };

const TIMEOUT_MS = 10_000;

/** Was der Ablauf von einer Antwort des RPC-Clients braucht. */
type Reply = { status: number; json(): Promise<unknown> };

/**
 * `fetch` ist das des Auth-Moduls (`AppAuth.fetch`): Es hängt die Sitzung an und sperrt bei `401`.
 * Antworten werden gegen die Verträge geprüft.
 */
export function createInvitationFlows({ baseUrl, fetch, sync }: { baseUrl: string; fetch: typeof globalThis.fetch; sync: SyncTrigger }): InvitationFlows {
  const client = hc<AppType>(baseUrl, { fetch });

  async function exchange<T>(send: (init: RequestInit) => Promise<Reply>, schema: z.ZodType<T>): Promise<OnlineResult<T>> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
    let response: Reply;
    let body: unknown;
    try {
      response = await send({ signal: abort.signal });
      body = await response.json().catch(() => undefined);
    } catch {
      return { type: 'offline' };
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 200) {
      const parsed = schema.safeParse(body);
      return parsed.success ? { type: 'ok', value: parsed.data } : { type: 'failed' };
    }
    if (response.status === 401) return { type: 'unauthorized' };
    if (response.status >= 500) return { type: 'offline' };
    const error = ContractError.safeParse(body);
    const code = InvitationErrorCode.safeParse(error.data?.code);
    return code.success ? { type: 'rejected', code: code.data } : { type: 'failed' };
  }

  const invitations = client.v1.invitations;
  return {
    createCode: (requestId) => exchange((init) => invitations.$post({ json: { requestId } }, { init }), CreateInvitationResult),
    checkCode: (code) => exchange((init) => invitations.check.$post({ json: { code } }, { init }), CheckInvitationResult),
    async acceptCode(requestId, code) {
      const result = await exchange((init) => invitations.accept.$post({ json: { requestId, code } }, { init }), AcceptInvitationResult);
      if (result.type === 'ok') await sync.sync().catch(() => undefined);
      return result;
    },
  };
}
