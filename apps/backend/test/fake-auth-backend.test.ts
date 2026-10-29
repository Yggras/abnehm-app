import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { Instant } from '@abnehm/contracts/base';

import { createAppAuth, type StoredSession } from '../../mobile/src/auth/app-auth.ts';
import { fakeAuthBackend } from '../../mobile/src/auth/testing/fake-auth-backend.ts';
import { createTestBackend, testBaseUrl } from './support/app.ts';
import { defaultPassword, newDevice, sessionIsValid, signIn } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';

// Abgleich des Online-Test-Adapters `fakeAuthBackend` (#119) mit der echten Hono-App: Dieselbe Folge von
// Abläufen des App-Moduls `AppAuth` ergibt gegen den Nachbau und gegen Better Auth samt Backend dieselben
// Ergebnisse. Darauf stützen sich die Komponententests der Einstellungen (`src/settings/`).

const email = 'anna@example.test';

/** Was ein Server für die Folge bieten muss: `fetch` für das Gerät und ein zweites angemeldetes Gerät. */
type Server = Readonly<{
  fetch: typeof fetch;
  signInElsewhere(): Promise<string>;
  isValid(token: string): Promise<boolean>;
}>;

/** Die Folge aus Anmelden, E-Mail, Passwortwechsel mit Fehlerfällen und Abmelden samt identischem Retry. */
async function journey(server: Server, accountId: string) {
  let stored: StoredSession | null = null;
  const auth = createAppAuth({
    baseUrl: testBaseUrl,
    sessionStore: {
      read: async () => stored,
      write: async (session) => {
        stored = session;
      },
      clear: async () => {
        stored = null;
      },
    },
    accountData: { open: async () => undefined, lock: () => undefined },
    onError: (error) => {
      throw error;
    },
    fetch: server.fetch,
  });
  const results: unknown[] = [];
  results.push(await auth.signIn({ email, password: 'falsches-passwort' }));
  results.push(await auth.signIn({ email, password: defaultPassword }));
  results.push(await auth.accountEmail());
  results.push(await auth.changePassword({ currentPassword: 'falsches-passwort', newPassword: 'ganz-neue-passphrase' }));
  results.push(await auth.changePassword({ currentPassword: defaultPassword, newPassword: 'kurz-9-zz' }));
  results.push(await auth.changePassword({ currentPassword: 'falsches-passwort', newPassword: 'iloveyou12' }));
  const other = await server.signInElsewhere();
  results.push(await auth.changePassword({ currentPassword: defaultPassword, newPassword: 'ganz-neue-passphrase' }));
  results.push({ andereSitzungGueltig: await server.isValid(other) });
  results.push(await auth.checkSession());
  const revocation = await auth.prepareRevocation(randomUUID());
  if (revocation === null) throw new Error('Keine Sitzung zum Widerrufen');
  results.push(await auth.revokeSession(revocation));
  results.push(await auth.revokeSession(revocation));
  results.push(await auth.checkSession());
  // Die Kontokennung vergibt jeder Server selbst.
  return JSON.parse(JSON.stringify(results).replaceAll(accountId, '<konto>')) as unknown[];
}

describe('fakeAuthBackend', () => {
  it('ergibt dieselben Ergebnisse wie die echte Hono-App', async () => {
    const backend = await createTestBackend();
    const anna = await personWithSession(backend, email, 'Anna');
    const real = await journey(
      {
        // Jede Anfrage mit eigener Quelladresse: Better Auth begrenzt sonst auf 3 Anfragen je 10 s, IP und Pfad.
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set('x-forwarded-for', newDevice().ip);
          return backend.app.request(String(input), { ...init, headers });
        },
        signInElsewhere: async () => (await signIn(backend, email, defaultPassword)).device.token!,
        isValid: (token) => sessionIsValid(backend, { ip: newDevice().ip, token }),
      },
      anna.accountId,
    );

    const fake = fakeAuthBackend({
      account: { accountId: 'konto_anna', email, password: defaultPassword },
      loggedOutAt: Instant.parse('2026-10-14T12:00:00.000Z'),
    });
    const faked = await journey(
      { fetch: fake.fetch, signInElsewhere: async () => fake.signInElsewhere(), isValid: async (token) => fake.isValid(token) },
      'konto_anna',
    );

    expect(faked).toEqual(real);
    // Gegenprobe, dass die Folge die Fälle wirklich trifft.
    expect(real).toEqual([
      { type: 'invalid_credentials' },
      { type: 'signed_in', accountId: '<konto>' },
      { type: 'known', email },
      { type: 'current_password_wrong' },
      { type: 'rejected', reason: 'password_too_short' },
      { type: 'rejected', reason: 'password_compromised' },
      { type: 'changed' },
      { andereSitzungGueltig: false },
      { type: 'gueltig', accountId: '<konto>' },
      { type: 'revoked' },
      { type: 'revoked' },
      { type: 'ungueltig' },
    ]);
  });
});
