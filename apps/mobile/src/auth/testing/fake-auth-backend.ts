import { authErrorCodes, passwordPolicy } from '@abnehm/contracts/auth';
import type { Instant } from '@abnehm/contracts/base';

// Online-Test-Adapter des Auth-Moduls für Komponententests, eingeführt mit „Konto“ in den
// Einstellungen (#119; kein Adapter des Fundaments): ein kleiner Nachbau genau der Endpunkte, die
// `AppAuth` und das Abmeldemodul aufrufen, mit den Statuscodes und Fehlercodes von Better Auth und dem
// Backend. Dass er dieselben Ergebnisse liefert wie die echte Hono-App, prüft
// `apps/backend/test/fake-auth-backend.test.ts`. Netz- und Serverfehler kommen über `faultyFetch` aus
// den Testfähigkeiten dazu, nicht über diesen Adapter.

export type FakeAuthAccount = Readonly<{ accountId: string; email: string; password: string }>;

export type FakeAuthBackend = {
  /** `fetch` für `AppAuth`; jede Basis-URL ist recht. */
  fetch: typeof fetch;
  /** Meldet das Konto auf einem weiteren Gerät an; die Rückgabe ist dessen Sitzungstoken. */
  signInElsewhere(): string;
  /** Ob der Server die Sitzung zu diesem Token annimmt. */
  isValid(token: string): boolean;
  /** Das aktuelle Passwort des Kontos. */
  password(): string;
  /** Beantwortet den nächsten Aufruf des Pfads mit diesem Status ohne Body, etwa `429`. */
  answerOnce(path: string, status: number): void;
  readonly calls: readonly Readonly<{ method: string; path: string }>[];
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function fakeAuthBackend({
  account,
  loggedOutAt,
  blocklist = ['iloveyou12', 'qwertzuiop'],
}: {
  account: FakeAuthAccount;
  /** Zeitpunkt im Abmeldeergebnis (`LogoutResult`). */
  loggedOutAt: Instant;
  /** Wie die Blocklist des Backends: zu häufige Passwörter. */
  blocklist?: readonly string[];
}): FakeAuthBackend {
  let password = account.password;
  let issued = 0;
  const sessions = new Set<string>();
  /** Gespeicherte Abmeldeergebnisse je Token und `requestId`, wie `online_request` im Backend. */
  const logouts = new Map<string, unknown>();
  const answers = new Map<string, number>();
  const calls: { method: string; path: string }[] = [];
  const user = { id: account.accountId, email: account.email, name: '' };

  function newSession() {
    const token = `sitzung-${++issued}`;
    sessions.add(token);
    return token;
  }

  async function handle(method: string, path: string, token: string | null, body: Record<string, unknown>): Promise<Response> {
    const signedIn = token !== null && sessions.has(token);
    switch (`${method} ${path}`) {
      case 'POST /v1/auth/sign-in/email':
        if (body.email !== account.email || body.password !== password) return json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 401);
        return json({ redirect: false, token: newSession(), url: null, user });
      case 'GET /v1/auth/get-session':
        return json(signedIn ? { session: { token }, user } : null);
      case 'POST /v1/auth/change-password': {
        if (!signedIn) return new Response(null, { status: 401 });
        const next = String(body.newPassword);
        // Reihenfolge wie im Backend: Die Blocklist prüft ein Haken vor Better Auth (`auth-module.ts`).
        if (blocklist.includes(next)) return json({ code: authErrorCodes.passwordCompromised }, 400);
        if (next.length < passwordPolicy.minLength) return json({ code: 'PASSWORD_TOO_SHORT' }, 400);
        if (next.length > passwordPolicy.maxLength) return json({ code: 'PASSWORD_TOO_LONG' }, 400);
        if (body.currentPassword !== password) return json({ code: 'INVALID_PASSWORD' }, 400);
        // Wie das Backend: Eine Passwortänderung widerruft alle Sitzungen; dieses Gerät erhält eine neue.
        password = next;
        sessions.clear();
        return json({ token: newSession(), user });
      }
      case 'POST /v1/session/logout': {
        const key = `${token ?? ''} ${String(body.requestId)}`;
        const stored = logouts.get(key);
        if (stored !== undefined) return json(stored);
        if (!signedIn) return new Response(null, { status: 401 });
        sessions.delete(token);
        const result = { loggedOutAt };
        logouts.set(key, result);
        return json(result);
      }
      default:
        return new Response(null, { status: 404 });
    }
  }

  return {
    async fetch(input, init) {
      const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
      const method = init?.method ?? 'GET';
      calls.push({ method, path });
      const answer = answers.get(path);
      if (answer !== undefined) {
        answers.delete(path);
        return new Response(null, { status: answer });
      }
      const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '') ?? null;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      return handle(method, path, token, body);
    },
    signInElsewhere: newSession,
    isValid: (token) => sessions.has(token),
    password: () => password,
    answerOnce(path, status) {
      answers.set(path, status);
    },
    calls,
  };
}
