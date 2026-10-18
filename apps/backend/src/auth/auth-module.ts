import { randomBytes } from 'node:crypto';

import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware, getIP, isAPIError } from 'better-auth/api';
import { bearer } from 'better-auth/plugins';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';
import { authErrorCodes, passwordPolicy } from '@abnehm/contracts/auth';
import { EntityId } from '@abnehm/contracts/base';

import { guard, policies } from '../authorization/authorization.ts';
import type { Database } from '../database.ts';
import { account, session, user, verification } from '../db/schema/index.ts';
import type { SecurityEvent, SecurityLog } from '../security-log/security-log.ts';
import { createLoginLimiter } from './login-limiter.ts';
import type { PasswordBlocklist } from './password-blocklist.ts';

// Auth-Modul (Spezifikation 0, Abschnitt 9). Better Auth bleibt hier gekapselt; Bereichscode erhält
// nur das Interface seiner Rolle:
// - die App die HTTP-Abläufe Registrieren, Anmelden, Sitzung prüfen, Passwort ändern und das
//   Widerrufen der aktuellen Sitzung (`routes`);
// - Backend-Endpunkte ausschließlich `SessionAuthenticator` (Sitzung authentifizieren, Widerruf prüfen);
// - der Betrieb das serverseitige Kommando `AdminPasswordReset`.
// Konto löschen, E-Mail ändern und Sitzungen ohne Passwortwechsel widerrufen sind bewusst nicht
// freigegeben; sie kommen später als weitere Abläufe hinter diese Seams.

/** Die angemeldete Sitzung, wie Fach-Endpunkte sie sehen; das Sitzungstoken bleibt im Auth-Modul. */
export type AuthenticatedSession = Readonly<{ accountId: EntityId; sessionId: EntityId }>;

/** Rolle der Backend-Endpunkte. */
export type SessionAuthenticator = {
  /**
   * Liefert die gültige Sitzung zu den Request-Headern (`Authorization: Bearer …`) oder `null` bei
   * fehlender, widerrufener oder abgelaufener Sitzung. Jeder Aufruf fragt Postgres; eine gültige
   * Sitzung verlängert sich dabei.
   */
  authenticate(headers: Headers): Promise<AuthenticatedSession | null>;
};

/** Rolle des Betriebs: serverseitiges Kommando, kein öffentlicher Ablauf. */
export type AdminPasswordReset = {
  /** Setzt ein zufälliges neues Passwort und widerruft alle Sitzungen des Kontos. */
  resetPassword(email: string): Promise<{ type: 'reset'; password: string } | { type: 'unknown_account' }>;
};

/** Anlass, aus dem eine einzelne Sitzung widerrufen wird. */
export type SingleSessionRevocation = Extract<SecurityEvent, { type: 'sitzungswiderruf' }>['cause'] & ('widerruf' | 'abmeldung');

export type AuthModule = {
  /** Hono-Routen unter `/v1`: Better Auth in seinem Namensraum `/v1/auth` und `/v1/session/revoke`. */
  routes: Hono;
  sessions: SessionAuthenticator;
  admin: AdminPasswordReset;
  /**
   * Serverseitiges Primitive: widerruft genau diese Sitzung und protokolliert es. Idempotent. Nutzer
   * sind `POST /v1/session/revoke` und später das Abmeldemodul (#111) mit `abmeldung`.
   */
  revokeSession(session: AuthenticatedSession, cause: SingleSessionRevocation): Promise<void>;
};

export type AuthSettings = Readonly<{
  /** Better-Auth-Secret aus dem Compose-Secret; signiert u. a. die Sitzungstokens. */
  secret: string;
  /** Öffentliche Basis-URL des Backends, z. B. `https://api.example.org`. */
  baseUrl: string;
  /** Adressen bzw. CIDR-Bereiche des Reverse Proxys, dessen `X-Forwarded-For` gilt. */
  trustedProxies: readonly string[];
}>;

export type AuthDependencies = Readonly<{
  database: Database;
  clock: Clock;
  securityLog: SecurityLog;
  passwordBlocklist: PasswordBlocklist;
  settings: AuthSettings;
}>;

const DAY_SECONDS = 24 * 60 * 60;

export function createAuthModule({ database, clock, securityLog, passwordBlocklist, settings }: AuthDependencies): AuthModule {
  const limiter = createLoginLimiter({ clock });
  const ipOptions = { advanced: { ipAddress: { trustedProxies: [...settings.trustedProxies] } } };
  const ipOf = (request: Request | undefined) => (request === undefined ? null : getIP(request, ipOptions));

  const rejectCompromised = (password: unknown) => {
    if (typeof password === 'string' && passwordBlocklist.includes(password)) {
      // Derselbe Code wie im Better-Auth-Plugin `haveIBeenPwned`
      // (https://github.com/better-auth/better-auth/blob/v1.7.10/packages/better-auth/src/plugins/haveibeenpwned/index.ts).
      throw APIError.from('BAD_REQUEST', { code: authErrorCodes.passwordCompromised, message: 'Password is compromised' });
    }
  };
  const returnedError = (context: object) => {
    const returned = (context as { returned?: unknown }).returned;
    return isAPIError(returned) ? returned : null;
  };

  type SignInContext = { body?: { email?: unknown }; request?: Request };
  /** E-Mail und Quelladresse eines Anmeldeversuchs, wie Begrenzung und Sicherheitslog sie sehen. */
  const attemptOf = (ctx: SignInContext) => ({
    email: typeof ctx.body?.email === 'string' ? ctx.body.email : '',
    ipAddress: ipOf(ctx.request),
  });
  /** Protokolliert einen Fehlschlag mit dem Konto zur E-Mail, falls es eines gibt, nie mit der E-Mail. */
  const recordFailedSignIn = async (
    findUserByEmail: (email: string) => Promise<{ user: { id: string } } | null>,
    attempt: { email: string; ipAddress: string | null },
    reason: 'zugangsdaten_falsch' | 'begrenzt',
  ) => {
    const found = await findUserByEmail(attempt.email.toLowerCase());
    await securityLog.record({ type: 'anmeldung_fehlgeschlagen', accountId: found?.user.id ?? null, reason, ipAddress: attempt.ipAddress });
  };

  const policy = {
    id: 'abnehm-auth-policy',
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === '/sign-up/email',
          handler: createAuthMiddleware(async (ctx) => rejectCompromised(ctx.body?.password)),
        },
        {
          // Eine Passwortänderung widerruft immer alle Sitzungen; das Gerät erhält eine neue.
          matcher: (ctx) => ctx.path === '/change-password',
          handler: createAuthMiddleware(async (ctx) => {
            rejectCompromised(ctx.body?.newPassword);
            return { context: { body: { ...ctx.body, revokeOtherSessions: true } } };
          }),
        },
        {
          matcher: (ctx) => ctx.path === '/sign-in/email',
          handler: createAuthMiddleware(async (ctx) => {
            const attempt = attemptOf(ctx);
            if (!limiter.isBlocked(attempt)) return;
            await recordFailedSignIn(ctx.context.internalAdapter.findUserByEmail, attempt, 'begrenzt');
            throw APIError.from('TOO_MANY_REQUESTS', { code: authErrorCodes.tooManyLoginAttempts, message: 'Too many login attempts' });
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === '/sign-in/email',
          handler: createAuthMiddleware(async (ctx) => {
            const attempt = attemptOf(ctx);
            const error = returnedError(ctx.context);
            const signedIn = ctx.context.newSession;
            if (error === null && signedIn !== null) {
              limiter.recordSuccess(attempt);
              await securityLog.record({ type: 'anmeldung', accountId: signedIn.user.id, ipAddress: attempt.ipAddress });
            } else if (error?.statusCode === 401) {
              limiter.recordFailure(attempt);
              await recordFailedSignIn(ctx.context.internalAdapter.findUserByEmail, attempt, 'zugangsdaten_falsch');
            }
          }),
        },
        {
          matcher: (ctx) => ctx.path === '/change-password',
          handler: createAuthMiddleware(async (ctx) => {
            const accountId = ctx.context.session?.user.id;
            if (returnedError(ctx.context) !== null || accountId === undefined) return;
            await securityLog.record({ type: 'passwortaenderung', accountId });
            await securityLog.record({ type: 'sitzungswiderruf', accountId, scope: 'alle', cause: 'passwortaenderung' });
          }),
        },
      ],
    },
  } satisfies BetterAuthPlugin;

  const auth = betterAuth({
    appName: 'Abnehm-App',
    baseURL: settings.baseUrl,
    basePath: '/v1/auth',
    secret: settings.secret,
    database: drizzleAdapter(database.db, { provider: 'pg', schema: { user, session, account, verification }, transaction: true }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: passwordPolicy.minLength,
      maxPasswordLength: passwordPolicy.maxLength,
    },
    // Sitzungen nur in Postgres, ohne Cookie-Cache: Ein Widerruf wirkt beim nächsten Aufruf jedes
    // Geräts (https://www.better-auth.com/docs/concepts/session-management). 30 Tage ohne Nutzung bis
    // zum Ablauf; bei Nutzung verlängert Better Auth höchstens einmal täglich (`updateAge`).
    session: { expiresIn: 30 * DAY_SECONDS, updateAge: DAY_SECONDS, cookieCache: { enabled: false } },
    // Die eingebaute Begrenzung pro IP und Pfad bleibt zusätzlich zur eigenen Begrenzung der
    // Fehlversuche an; für Anmelden, Registrieren und Passwort ändern sind das 3 Anfragen in 10 Sekunden
    // (`getDefaultSpecialRules`, https://github.com/better-auth/better-auth/blob/v1.7.10/packages/better-auth/src/api/rate-limiter/index.ts).
    rateLimit: { enabled: true },
    advanced: { database: { generateId: 'uuid' }, ...ipOptions.advanced },
    databaseHooks: {
      // Der Anzeigename gehört der Person (Bootstrap), nicht dem Konto.
      user: { create: { before: async (created) => ({ data: { ...created, name: '' } }) } },
    },
    // Nur Meldungstexte ab Warnstufe, keine Zusatzdaten. Die Registrierung schreibt eine vorhandene
    // E-Mail auf Info-Ebene ins Log, also unterhalb dieser Stufe
    // (https://github.com/better-auth/better-auth/blob/v1.7.10/packages/better-auth/src/api/routes/sign-up.ts).
    logger: { level: 'warn', log: (level, message) => console[level === 'error' ? 'error' : 'warn'](`[auth] ${message}`) },
    telemetry: { enabled: false },
    plugins: [bearer(), policy],
  });

  const sessions: SessionAuthenticator = {
    async authenticate(headers) {
      const found = await auth.api.getSession({ headers });
      if (found === null) return null;
      return { accountId: EntityId.parse(found.user.id), sessionId: EntityId.parse(found.session.id) };
    },
  };

  async function revokeSession(current: AuthenticatedSession, cause: 'widerruf' | 'abmeldung') {
    await database.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(session)
        .where(and(eq(session.id, current.sessionId), eq(session.userId, current.accountId)))
        .returning({ id: session.id });
      if (deleted.length === 0) return;
      await securityLog.record({ type: 'sitzungswiderruf', accountId: current.accountId, scope: 'aktuelle', cause }, tx);
    });
  }

  const admin: AdminPasswordReset = {
    async resetPassword(email) {
      const context = await auth.$context;
      const found = await context.internalAdapter.findUserByEmail(email.trim().toLowerCase());
      if (found === null) {
        await securityLog.record({ type: 'administrativer_zugriff', command: 'passwort_reset', targetAccountId: null });
        return { type: 'unknown_account' };
      }
      const accountId = EntityId.parse(found.user.id);
      // 18 Zufallsbytes ergeben 24 Zeichen; das liegt sicher über der Mindestlänge und auf keiner Liste.
      const password = randomBytes(18).toString('base64url');
      const hash = await context.password.hash(password);
      await database.db.transaction(async (tx) => {
        await tx
          .update(account)
          .set({ password: hash, updatedAt: new Date(clock.read().instant) })
          .where(and(eq(account.userId, accountId), eq(account.providerId, 'credential')));
        await tx.delete(session).where(eq(session.userId, accountId));
        await securityLog.record({ type: 'administrativer_zugriff', command: 'passwort_reset', targetAccountId: accountId }, tx);
        await securityLog.record({ type: 'passwort_reset', accountId }, tx);
        await securityLog.record({ type: 'sitzungswiderruf', accountId, scope: 'alle', cause: 'passwort_reset' }, tx);
      });
      return { type: 'reset', password };
    },
  };

  // Nur diese Better-Auth-Pfade sind freigegeben; alles andere im Namensraum antwortet mit 404.
  // Registrieren, Anmelden und „Sitzung prüfen“ sind öffentlich; Better Auth prüft dort die
  // Zugangsdaten bzw. liefert ohne Sitzung `null`. Passwort ändern verlangt eine Sitzung.
  const handle = (c: { req: { raw: Request } }) => auth.handler(c.req.raw);
  const routes = new Hono()
    .post('/auth/sign-up/email', guard(policies.public()), handle)
    .post('/auth/sign-in/email', guard(policies.public()), handle)
    .post('/auth/change-password', guard(policies.authenticated()), handle)
    .get('/auth/get-session', guard(policies.public()), handle)
    .post('/session/revoke', guard(policies.authenticated()), async (c) => {
      await revokeSession(c.var.actor, 'widerruf');
      return c.body(null, 204);
    });

  return { routes, sessions, admin, revokeSession };
}
