import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';
import { LogoutRequest, LogoutResult } from '@abnehm/contracts/auth';

import type { AuthModule } from '../auth/auth-module.ts';
import { forbiddenError, guard, policies, type Actor } from '../authorization/authorization.ts';
import { jsonBody } from '../contract-validation.ts';
import { transactionWithRetry, type Database, type DbExecutor } from '../database.ts';
import { onlineRequestHash, storedOnlineRequest, storeOnlineResult } from '../online/online-requests.ts';
import type { SecurityLog } from '../security-log/security-log.ts';

// Serverseitiger Teil des vollständigen Abmeldens (Spezifikation 0, Abschnitt 9; #111). Ein
// idempotenter Ablauf unter der `requestId` der App: registrierte Abmelde-Haken in ihrer Reihenfolge,
// dann Sicherheitslog und Widerruf der Sitzung, alles in einer Transaktion. Das terminale Ergebnis ist
// an genau die vorgelegte Sitzung gebunden (Hash-Schlüssel aus ihrem Token): Ein identischer Retry
// erhält es auch, nachdem sie widerrufen ist, und mit ihr nichts anderes.

/** Ein serverseitiger Abmelde-Haken, etwa die Deaktivierung der Push-Installation (Spezifikation 5). */
export type LogoutHook = Readonly<{
  name: string;
  /** Läuft in der Transaktion des Ablaufs vor Sicherheitslog und Widerruf; wirft er, bleibt alles unverändert. */
  run(tx: DbExecutor, actor: Actor): Promise<void>;
}>;

export type LogoutDependencies = Readonly<{
  database: Database;
  clock: Clock;
  auth: Pick<AuthModule, 'revokeSession' | 'presentedSessionKey'>;
  securityLog: SecurityLog;
}>;

type Outcome =
  | Readonly<{ type: 'ok'; value: LogoutResult }>
  | Readonly<{ type: 'unauthorized' }>
  | Readonly<{ type: 'error'; error: typeof forbiddenError | typeof operationConflict }>;

const operationConflict = { code: 'operation_conflict', retryable: false } as const;

export function createLogout({ database, clock, auth, securityLog }: LogoutDependencies) {
  const hooks: LogoutHook[] = [];

  async function logout(actor: Actor | null, sessionKey: string | null, request: LogoutRequest): Promise<Outcome> {
    if (sessionKey === null) return { type: 'unauthorized' };
    const requestHash = onlineRequestHash({ hashKey: sessionKey, flow: 'abmelden', request });
    return transactionWithRetry(database, async (tx) => {
      const stored = await storedOnlineRequest(tx, request.requestId);
      // Der Hash-Schlüssel stammt aus dem Token: Stimmt der Hash, ist es dieselbe Sitzung, gültig oder nicht.
      if (stored?.flow === 'abmelden' && stored.requestHash === requestHash) return { type: 'ok', value: LogoutResult.parse(stored.result) };
      // Ohne gültige Sitzung gibt es nur das eigene gespeicherte Ergebnis.
      if (actor === null) return { type: 'unauthorized' };
      if (stored !== null) return { type: 'error', error: stored.accountId === actor.accountId ? operationConflict : forbiddenError };
      const binding = { requestId: request.requestId, accountId: actor.accountId, flow: 'abmelden', requestHash } as const;
      for (const hook of hooks) await hook.run(tx, actor);
      await securityLog.record({ type: 'abmeldung', accountId: actor.accountId }, tx);
      await auth.revokeSession(actor, 'abmeldung', tx);
      const at = new Date(clock.read().instant);
      const result = LogoutResult.parse({ loggedOutAt: at.toISOString() });
      // Eine gleichzeitige identische Anfrage scheitert hier am Primärschlüssel; ihr Retry findet das Ergebnis.
      await storeOnlineResult(tx, binding, result, at);
      return { type: 'ok', value: result };
    });
  }

  const routes = new Hono().post('/session/logout', guard(policies.logout()), jsonBody(LogoutRequest), async (c) => {
    const outcome = await logout(c.var.actor, auth.presentedSessionKey(c.req.raw.headers), c.req.valid('json'));
    if (outcome.type === 'ok') return c.json(outcome.value, 200);
    if (outcome.type === 'unauthorized') return c.body(null, 401);
    return c.json(outcome.error, outcome.error.code === 'forbidden' ? 403 : 409);
  });

  return {
    /** `POST /v1/session/logout`. */
    routes,
    /** Meldet einen Haken an; die Haken laufen in der Reihenfolge ihrer Anmeldung. */
    registerHook(hook: LogoutHook) {
      if (hooks.some((registered) => registered.name === hook.name)) throw new Error(`Abmelde-Haken ${hook.name} ist schon angemeldet`);
      hooks.push(hook);
    },
  };
}

export type Logout = ReturnType<typeof createLogout>;
