import { z } from 'zod';

import { authErrorCodes, BootstrapPersonRequest, BootstrapPersonResult, LogoutResult } from '@abnehm/contracts/auth';

// Auth-Modul der App (Spezifikation 0, Abschnitt 9). Bildschirme und Bereichscode kennen nur `AppAuth`,
// nicht Better Auth: Registrieren, Anmelden, Sitzung prüfen und Passwort ändern, dazu den Sperrzustand
// bei `401`. Das Widerrufen der aktuellen Sitzung erhält nur das Abmeldemodul (#111) als eigene Rolle
// `SessionRevocations`; es orchestriert darauf die vollständige Abmeldung.
//
// Das Backend spricht Better Auth über dessen REST-Endpunkte unter `/v1/auth` an
// (https://www.better-auth.com/docs/concepts/api) und weist sich mit dem Sitzungstoken als
// `Authorization: Bearer …` aus (Bearer-Plugin, https://www.better-auth.com/docs/plugins/bearer).
// Sitzungsdaten liegen ausschließlich im `SessionStore` (auf dem Gerät SecureStore).
//
// Die Datei hat bewusst keine relativen Importe: Der Integrationstest des Backends prüft sie gegen
// den echten Server.

/** Was das Gerät über die Sitzung speichert. Nach `401` bleibt das Konto ohne Token stehen. */
export type StoredSession = Readonly<{ accountId: string; token: string | null }>;

/**
 * Ausweis für den Widerruf der aktuellen Sitzung im Abmeldeablauf. Er hält das Sitzungstoken fest, damit
 * ein identischer Retry auch nach dem Widerruf (und der Sperre nach `401`) dasselbe Token vorlegt. Das
 * Abmeldemodul speichert ihn deshalb ebenso geschützt wie die Sitzung.
 */
export type SessionRevocation = Readonly<{ accountId: string; requestId: string; token: string }>;

/** Geschützter Speicher der Sitzung; auf dem Gerät SecureStore. */
export type SessionStore = {
  read(): Promise<StoredSession | null>;
  write(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
};

/** Die kontogetrennte lokale Datenbank (`LocalDatabases`), soweit das Auth-Modul sie braucht. */
export type AccountData = {
  /** Öffnet die Datenbank des Kontos; die eines anderen Kontos wird dabei geschlossen. */
  open(accountId: string): Promise<unknown>;
  /** Schließt die geöffnete Datenbank; die Datei bleibt bis zur erneuten Anmeldung erhalten. */
  lock(): void;
};

/**
 * Sperrzustand des Moduls. `gesperrt` heißt: Der Server hat die Sitzung abgelehnt; die Fachoberfläche
 * ist zu, die lokale Datenbank des Kontos geschlossen, aber erhalten.
 */
export type AuthState =
  | { type: 'unbekannt' }
  | { type: 'abgemeldet' }
  | { type: 'angemeldet'; accountId: string }
  | { type: 'gesperrt'; accountId: string };

export type PasswordRejection = 'password_too_short' | 'password_too_long' | 'password_compromised';
type Offline = { type: 'unreachable' };
type Unauthorized = { type: 'unauthorized' };
type RateLimited = { type: 'rate_limited' };

export type RegisterResult =
  | { type: 'registered'; accountId: string; person: BootstrapPersonResult }
  /** Konto angelegt und angemeldet, die Person aber noch nicht: später `bootstrapPerson` aufrufen. */
  | { type: 'person_pending'; accountId: string }
  | { type: 'rejected'; reason: PasswordRejection | 'email_invalid' | 'email_taken' }
  | RateLimited
  | Offline;
/** Falsche E-Mail und falsches Passwort sind bewusst derselbe Fall. */
export type SignInResult = { type: 'signed_in'; accountId: string } | { type: 'invalid_credentials' } | RateLimited | Offline;
export type SessionCheck =
  | { type: 'gueltig'; accountId: string }
  /**
   * Der Server hat weder bestätigt noch abgelehnt (kein Netz, Begrenzung, Serverfehler): Die
   * gespeicherte Sitzung gilt weiter, bis der Server sie ablehnt.
   */
  | { type: 'offline'; accountId: string }
  | { type: 'ungueltig' }
  | { type: 'abgemeldet' };
export type BootstrapResult = { type: 'bootstrapped'; person: BootstrapPersonResult } | Unauthorized | Offline;
export type ChangePasswordResult =
  | { type: 'changed' }
  | { type: 'current_password_wrong' }
  | { type: 'rejected'; reason: PasswordRejection }
  | RateLimited
  | Unauthorized
  | Offline;
export type RevokeResult = { type: 'revoked' } | Unauthorized | Offline;

export type AppAuth = {
  /** Legt das Konto an, meldet das Gerät an und erzeugt die eine Person (Bootstrap). */
  register(input: { email: string; password: string } & BootstrapPersonRequest): Promise<RegisterResult>;
  signIn(input: { email: string; password: string }): Promise<SignInResult>;
  /** Fragt beim Server, ob die gespeicherte Sitzung gilt; widerrufene und abgelaufene sind `ungueltig`. */
  checkSession(): Promise<SessionCheck>;
  /** Idempotenter Bootstrap der Person, falls `register` ihn nicht erreicht hat. */
  bootstrapPerson(input: BootstrapPersonRequest): Promise<BootstrapResult>;
  /** Widerruft alle Sitzungen des Kontos; dieses Gerät erhält eine neue. */
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<ChangePasswordResult>;
  state(): AuthState;
  subscribe(listener: (state: AuthState) => void): () => void;
  /** Haken für `401`, etwa zum Abbrechen geplanter Tages-Check-ins (Spezifikation 5). */
  onUnauthorized(hook: () => void | Promise<void>): () => void;
  /** `fetch` für Fach-Endpunkte: hängt die Sitzung an und sperrt bei `401`. */
  fetch: typeof fetch;
};

/** Wie ein Ausweis zur Sitzung des Geräts steht. */
export type RevocationStatus =
  /** Dasselbe Token oder, nach der Sperre bei `401`, dasselbe Konto ohne Token. */
  | 'aktuell'
  /** Das Gerät hat keine Sitzung mehr gespeichert. */
  | 'keine'
  /** Eine andere Sitzung, nach erneuter Anmeldung; der Ausweis ist veraltet. */
  | 'andere';

/**
 * Rolle des Abmeldemoduls (`src/logout/`): das Widerrufen der aktuellen Sitzung samt dem, was der
 * idempotente Abmeldeablauf dafür braucht. Bildschirme und Bereiche erhalten nur `AppAuth`.
 */
export type SessionRevocations = {
  /** Der Ausweis für den Widerruf der aktuellen Sitzung unter `requestId`; `null` ohne Sitzungstoken. */
  prepareRevocation(requestId: string): Promise<SessionRevocation | null>;
  revocationStatus(revocation: SessionRevocation): Promise<RevocationStatus>;
  /**
   * Widerruft serverseitig die Sitzung des Ausweises im idempotenten Abmeldeablauf. Ein identischer
   * Retry erhält dasselbe Ergebnis, auch nach erfolgtem Widerruf. Lokale Daten bleiben Sache des
   * Abmeldemoduls. Ein `401` ohne gespeichertes Ergebnis sperrt wie jeder Fachaufruf, aber nur, solange
   * der Ausweis die Sitzung des Geräts betrifft; eine spätere Anmeldung bleibt unberührt.
   */
  revokeSession(revocation: SessionRevocation): Promise<RevokeResult>;
  /** Vergisst die Sitzung auf dem Gerät und schließt die Kontodatenbank; danach ist das Modul `abgemeldet`. */
  forgetSession(): Promise<void>;
};

export type AppAuthOptions = {
  /** Basis-URL des Backends, ohne `/v1`. */
  baseUrl: string;
  sessionStore: SessionStore;
  accountData: AccountData;
  /** Fehler in Haken und Beobachtern; sie unterbrechen den Ablauf nicht. */
  onError: (error: unknown) => void;
  fetch?: typeof fetch;
};

const TIMEOUT_MS = 10_000;

function statusOf(session: StoredSession | null, revocation: SessionRevocation): RevocationStatus {
  if (session === null) return 'keine';
  return session.accountId === revocation.accountId && (session.token === null || session.token === revocation.token) ? 'aktuell' : 'andere';
}

const SignedIn = z.object({ token: z.string().min(1), user: z.object({ id: z.string().min(1) }) });
const CurrentSession = z.object({ user: z.object({ id: z.string().min(1) }) }).nullable();
const ChangedPassword = z.object({ token: z.string().min(1) });
const AuthError = z.object({ code: z.string() }).partial();

type Reply = { status: number; body: unknown } | Offline;

// Better-Auth-Codes laut https://github.com/better-auth/better-auth/blob/v1.7.10/packages/core/src/error/codes.ts
const passwordRejections: Record<string, PasswordRejection> = {
  PASSWORD_TOO_SHORT: 'password_too_short',
  PASSWORD_TOO_LONG: 'password_too_long',
  [authErrorCodes.passwordCompromised]: 'password_compromised',
};

export function createAppAuth({
  baseUrl,
  sessionStore,
  accountData,
  onError,
  fetch: fetchImpl = globalThis.fetch,
}: AppAuthOptions): AppAuth & SessionRevocations {
  let current: AuthState = { type: 'unbekannt' };
  let stored: StoredSession | null | undefined;
  const listeners = new Set<(state: AuthState) => void>();
  const unauthorizedHooks = new Set<() => void | Promise<void>>();

  function setState(next: AuthState) {
    current = next;
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (error) {
        onError(error);
      }
    }
  }

  async function storedSession(): Promise<StoredSession | null> {
    stored ??= await sessionStore.read();
    return stored;
  }

  async function remember(session: StoredSession) {
    await sessionStore.write(session);
    stored = session;
  }

  /** Öffnet die Datenbank des Kontos und entsperrt die Fachoberfläche. */
  async function enter(accountId: string) {
    await accountData.open(accountId);
    setState({ type: 'angemeldet', accountId });
  }

  async function signedIn(accountId: string, token: string) {
    await remember({ accountId, token });
    await enter(accountId);
  }

  /** Sperrt nach `401`: Fachoberfläche zu, Datenbank geschlossen, Token verworfen, Haken einmal je Sperre. */
  async function lock() {
    const session = await storedSession();
    if (session === null) {
      accountData.lock();
      setState({ type: 'abgemeldet' });
      return;
    }
    if (session.token !== null) await remember({ accountId: session.accountId, token: null });
    accountData.lock();
    if (current.type === 'gesperrt') return;
    setState({ type: 'gesperrt', accountId: session.accountId });
    const results = await Promise.allSettled([...unauthorizedHooks].map(async (hook) => hook()));
    for (const result of results) if (result.status === 'rejected') onError(result.reason);
  }

  const authorizedFetch: typeof fetch = async (input, init) => {
    const session = await storedSession();
    const headers = new Headers(init?.headers);
    if (session?.token != null) headers.set('authorization', `Bearer ${session.token}`);
    const response = await fetchImpl(input, { ...init, headers, credentials: 'omit' });
    if (response.status === 401) await lock();
    return response;
  };

  async function request(method: 'GET' | 'POST', path: string, body: unknown, viaFetch: typeof fetch): Promise<Reply> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const response = await viaFetch(`${baseUrl}${path}`, {
        method,
        // Die Sitzung reist nur als Bearer-Token. Ohne `omit` speichert React Native das Cookie von
        // Better Auth und sendet es mit (`withCredentials` ist dort standardmäßig an); Better Auth
        // verlangt dann einen Origin-Header und lehnt jede weitere Anmeldung auf dem Gerät ab.
        credentials: 'omit',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
      });
      if (response.status >= 500) return { type: 'unreachable' };
      const text = await response.text();
      let parsed: unknown = null;
      try {
        parsed = text === '' ? null : (JSON.parse(text) as unknown);
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed };
    } catch {
      return { type: 'unreachable' };
    } finally {
      clearTimeout(timeout);
    }
  }

  const errorCode = (body: unknown) => AuthError.safeParse(body).data?.code ?? '';

  async function bootstrapPerson(input: BootstrapPersonRequest): Promise<BootstrapResult> {
    const reply = await request('POST', '/v1/person/bootstrap', BootstrapPersonRequest.parse(input), authorizedFetch);
    if ('type' in reply) return reply;
    if (reply.status === 401) return { type: 'unauthorized' };
    const person = BootstrapPersonResult.safeParse(reply.body);
    return reply.status === 200 && person.success ? { type: 'bootstrapped', person: person.data } : { type: 'unreachable' };
  }

  return {
    async register({ email, password, displayName, timeZone }) {
      const reply = await request('POST', '/v1/auth/sign-up/email', { email, password, name: '' }, fetchImpl);
      if ('type' in reply) return reply;
      if (reply.status === 429) return { type: 'rate_limited' };
      const code = errorCode(reply.body);
      if (code in passwordRejections) return { type: 'rejected', reason: passwordRejections[code]! };
      if (code === 'INVALID_EMAIL') return { type: 'rejected', reason: 'email_invalid' };
      if (reply.status === 422) return { type: 'rejected', reason: 'email_taken' };
      const account = SignedIn.safeParse(reply.body);
      if (reply.status !== 200 || !account.success) return { type: 'unreachable' };
      await signedIn(account.data.user.id, account.data.token);
      const bootstrapped = await bootstrapPerson({ displayName, timeZone });
      return bootstrapped.type === 'bootstrapped'
        ? { type: 'registered', accountId: account.data.user.id, person: bootstrapped.person }
        : { type: 'person_pending', accountId: account.data.user.id };
    },

    async signIn({ email, password }) {
      const reply = await request('POST', '/v1/auth/sign-in/email', { email, password }, fetchImpl);
      if ('type' in reply) return reply;
      if (reply.status === 429) return { type: 'rate_limited' };
      const account = SignedIn.safeParse(reply.body);
      if (reply.status !== 200 || !account.success) return { type: 'invalid_credentials' };
      await signedIn(account.data.user.id, account.data.token);
      return { type: 'signed_in', accountId: account.data.user.id };
    },

    async checkSession() {
      const session = await storedSession();
      if (session === null) {
        setState({ type: 'abgemeldet' });
        return { type: 'abgemeldet' };
      }
      if (session.token === null) {
        await lock();
        return { type: 'ungueltig' };
      }
      // Better Auth antwortet auf eine fehlende, widerrufene oder abgelaufene Sitzung mit `200` und
      // `null`; `401` sperrt schon das `fetch` des Moduls.
      const reply = await request('GET', '/v1/auth/get-session', undefined, authorizedFetch);
      const found = 'type' in reply || reply.status !== 200 ? null : CurrentSession.safeParse(reply.body);
      if (('status' in reply && reply.status === 401) || (found?.success === true && found.data?.user.id !== session.accountId)) {
        await lock();
        return { type: 'ungueltig' };
      }
      await enter(session.accountId);
      return found?.success === true ? { type: 'gueltig', accountId: session.accountId } : { type: 'offline', accountId: session.accountId };
    },

    bootstrapPerson,

    async changePassword({ currentPassword, newPassword }) {
      // Den Widerruf aller Sitzungen erzwingt das Backend; die App muss ihn nicht anfordern.
      const reply = await request('POST', '/v1/auth/change-password', { currentPassword, newPassword }, authorizedFetch);
      if ('type' in reply) return reply;
      if (reply.status === 401) return { type: 'unauthorized' };
      if (reply.status === 429) return { type: 'rate_limited' };
      const code = errorCode(reply.body);
      if (code in passwordRejections) return { type: 'rejected', reason: passwordRejections[code]! };
      if (code === 'INVALID_PASSWORD') return { type: 'current_password_wrong' };
      const changed = ChangedPassword.safeParse(reply.body);
      const session = await storedSession();
      if (reply.status !== 200 || !changed.success || session === null) return { type: 'unreachable' };
      await remember({ accountId: session.accountId, token: changed.data.token });
      return { type: 'changed' };
    },

    async prepareRevocation(requestId) {
      const session = await storedSession();
      return session?.token == null ? null : { accountId: session.accountId, requestId, token: session.token };
    },

    async revokeSession(revocation) {
      const { requestId, token } = revocation;
      // Immer das Token des Ausweises, nicht das gespeicherte: Nach dem Widerruf hat die Sperre es verworfen,
      // und ein veralteter Ausweis gehört zu einer früheren Sitzung.
      const withRevocationToken: typeof fetch = (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${token}`);
        return fetchImpl(input, { ...init, headers, credentials: 'omit' });
      };
      const reply = await request('POST', '/v1/session/logout', { requestId }, withRevocationToken);
      if ('type' in reply) return reply;
      if (reply.status === 401) {
        if (statusOf(await storedSession(), revocation) === 'aktuell') await lock();
        return { type: 'unauthorized' };
      }
      return reply.status === 200 && LogoutResult.safeParse(reply.body).success ? { type: 'revoked' } : { type: 'unreachable' };
    },

    revocationStatus: async (revocation) => statusOf(await storedSession(), revocation),

    async forgetSession() {
      // Zuerst zu: Scheitert das Löschen im Speicher, zeigt die App trotzdem keine Fachdaten mehr.
      stored = null;
      accountData.lock();
      setState({ type: 'abgemeldet' });
      await sessionStore.clear();
    },

    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onUnauthorized(hook) {
      unauthorizedHooks.add(hook);
      return () => unauthorizedHooks.delete(hook);
    },
    fetch: authorizedFetch,
  };
}
