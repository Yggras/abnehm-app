import type { BootstrapPersonResult } from '@abnehm/contracts/auth';
import { EntityId, ServerVersion, TimeZone } from '@abnehm/contracts/base';

// Fake-Server für die Endpunkte, die das Auth-Modul der App (#97) beim Registrieren, Anmelden und
// Bootstrap anspricht, für Komponenten- und Modultests ohne Backend. Die Antworten folgen dem
// Verhalten, das `apps/backend/test/` gegen Better Auth prüft: Passwortregeln aus dem Vertrag,
// `422` für eine vergebene E-Mail, ein gemeinsamer Fehler für falsche E-Mail und falsches Passwort
// und ein idempotenter Bootstrap. Fehler im Transport (offline) kommen aus dem Fehler-Adapter (#112).

type Account = { id: string; email: string; password: string };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export type FakeAuthServer = {
  fetch: typeof fetch;
  /** Legt ein bestehendes Konto an; die Person entsteht erst mit `bootstrap`. */
  addAccount(input: { email: string; password: string }): string;
  /** Die Person eines Kontos, sobald der Bootstrap sie angelegt hat. */
  person(accountId: string): BootstrapPersonResult | null;
  /** `false`: Der Bootstrap antwortet mit `503`, etwa bei einem Serverausfall direkt nach der Kontoanlage. */
  setBootstrapAvailable(available: boolean): void;
  /** Die empfangenen Aufrufe als `METHODE /pfad`. */
  calls(): string[];
};

export function createFakeAuthServer(): FakeAuthServer {
  const accounts = new Map<string, Account>();
  const sessions = new Map<string, string>();
  const persons = new Map<string, BootstrapPersonResult>();
  const received: string[] = [];
  let bootstrapAvailable = true;
  let next = 0;
  const id = (kind: number) => `fa${kind}00000-0000-4000-8000-${String(++next).padStart(12, '0')}`;

  function signedIn(account: Account) {
    const token = `token-${account.id}-${++next}`;
    sessions.set(token, account.id);
    return json(200, { token, user: { id: account.id } });
  }

  function addAccount({ email, password }: { email: string; password: string }) {
    const account = { id: id(1), email: email.toLowerCase(), password };
    accounts.set(account.email, account);
    return account.id;
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    received.push(`${method} ${url.pathname}`);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, string>) : {};
    const session = sessions.get(new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '');

    switch (`${method} ${url.pathname}`) {
      case 'POST /v1/auth/sign-up/email': {
        const email = (body.email ?? '').toLowerCase();
        const password = body.password ?? '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(400, { code: 'INVALID_EMAIL' });
        if (password.length < 10) return json(400, { code: 'PASSWORD_TOO_SHORT' });
        if (password.length > 128) return json(400, { code: 'PASSWORD_TOO_LONG' });
        if (password === 'passwort123') return json(400, { code: 'PASSWORD_COMPROMISED' });
        if (accounts.has(email)) return json(422, { code: 'USER_ALREADY_EXISTS' });
        addAccount({ email, password });
        return signedIn(accounts.get(email)!);
      }
      case 'POST /v1/auth/sign-in/email': {
        const account = accounts.get((body.email ?? '').toLowerCase());
        if (account === undefined || account.password !== body.password) return json(401, { code: 'INVALID_EMAIL_OR_PASSWORD' });
        return signedIn(account);
      }
      case 'GET /v1/auth/get-session':
        return json(200, session === undefined ? null : { user: { id: session } });
      case 'POST /v1/person/bootstrap': {
        if (session === undefined) return json(401, {});
        if (!bootstrapAvailable) return new Response(null, { status: 503 });
        const existing = persons.get(session);
        if (existing !== undefined) return json(200, existing);
        const person: BootstrapPersonResult = {
          personId: EntityId.parse(id(2)),
          displayName: body.displayName!,
          onboardingStatus: 'begonnen',
          timeZone: TimeZone.parse(body.timeZone),
          serverVersion: ServerVersion.parse('1'),
        };
        persons.set(session, person);
        return json(200, person);
      }
      default:
        return json(404, {});
    }
  };

  return {
    fetch: fakeFetch,
    addAccount,
    person: (accountId) => persons.get(accountId) ?? null,
    setBootstrapAvailable(available) {
      bootstrapAvailable = available;
    },
    calls: () => [...received],
  };
}
