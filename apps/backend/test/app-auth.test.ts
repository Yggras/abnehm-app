import { describe, expect, it, vi } from 'vitest';

import { TimeZone } from '@abnehm/contracts/base';

import { createAppAuth, type AccountData, type AppAuth, type SessionStore, type StoredSession } from '../../mobile/src/auth/app-auth.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import { defaultPassword, newDevice } from './support/auth-client.ts';

// Auth-Modul der App an seiner Schnittstelle, gegen die echte Hono-App mit Postgres (#97). So fällt
// auf, wenn App und Backend das Protokoll unterschiedlich verstehen. Speicher und lokale Datenbank
// sind Test-Adapter; SecureStore selbst prüft `secure-session-store.test.ts` in der App.

const person = { displayName: 'Anna', timeZone: TimeZone.parse('Europe/Berlin') };

function memoryStore(): SessionStore & { value: StoredSession | null } {
  const store = {
    value: null as StoredSession | null,
    read: async () => store.value,
    write: async (session: StoredSession) => {
      store.value = session;
    },
    clear: async () => {
      store.value = null;
    },
  };
  return store;
}

/** Kontogetrennte Datenbanken wie `LocalDatabases`: höchstens eine offen, Dateien bleiben erhalten. */
function accountDataModel(): AccountData & { open: ReturnType<typeof vi.fn>; opened: string | null; files: Set<string> } {
  const model = {
    opened: null as string | null,
    files: new Set<string>(),
    open: vi.fn(async (accountId: string) => {
      model.files.add(accountId);
      model.opened = accountId;
    }),
    lock: () => {
      model.opened = null;
    },
  };
  return model;
}

type Phone = { auth: AppAuth; store: ReturnType<typeof memoryStore>; data: ReturnType<typeof accountDataModel>; online: boolean };

/** Ein Gerät mit eigenem Speicher, eigener Datenbank und eigener Quelladresse. */
function phone(backend: TestBackend): Phone {
  const store = memoryStore();
  const data = accountDataModel();
  const { ip } = newDevice();
  const device: Phone = {
    store,
    data,
    online: true,
    auth: createAppAuth({
      baseUrl: testBaseUrl,
      sessionStore: store,
      accountData: data,
      onError: (error) => {
        throw error;
      },
      fetch: async (input, init) => {
        if (!device.online) throw new TypeError('Network request failed');
        const headers = new Headers(init?.headers);
        headers.set('x-forwarded-for', ip);
        return backend.app.request(input instanceof Request ? input : String(input), { ...init, headers });
      },
    }),
  };
  return device;
}

async function registered(backend: TestBackend, email = 'anna@example.test') {
  const device = phone(backend);
  const result = await device.auth.register({ email, password: defaultPassword, ...person });
  if (result.type !== 'registered') throw new Error(`Registrierung: ${result.type}`);
  return { device, accountId: result.accountId, person: result.person };
}

describe('Auth-Modul der App gegen das Backend', () => {
  it('registriert, legt genau eine Person an und hält die Sitzung nur im Sitzungsspeicher', async () => {
    const backend = await createTestBackend();

    const { device, accountId, person: created } = await registered(backend);

    expect(created).toMatchObject({ displayName: 'Anna', onboardingStatus: 'begonnen', timeZone: 'Europe/Berlin' });
    expect(device.auth.state()).toEqual({ type: 'angemeldet', accountId });
    expect(device.store.value).toEqual({ accountId, token: expect.any(String) });
    expect(device.data.opened).toBe(accountId);
    expect(await device.auth.checkSession()).toEqual({ type: 'gueltig', accountId });
    expect(await device.auth.bootstrapPerson({ displayName: 'Anderer Name', timeZone: TimeZone.parse('UTC') })).toEqual({ type: 'bootstrapped', person: created });
  });

  it('meldet abgelehnte Passwörter und eine vergebene E-Mail als eigene Gründe', async () => {
    const backend = await createTestBackend();
    await registered(backend);
    const device = phone(backend);

    expect(await device.auth.register({ email: 'neu@example.test', password: 'kurz-9-zz', ...person })).toEqual({
      type: 'rejected',
      reason: 'password_too_short',
    });
    expect(await device.auth.register({ email: 'neu@example.test', password: 'iloveyou12', ...person })).toEqual({
      type: 'rejected',
      reason: 'password_compromised',
    });
    expect(await phone(backend).auth.register({ email: 'anna@example.test', password: defaultPassword, ...person })).toEqual({
      type: 'rejected',
      reason: 'email_taken',
    });
    expect(device.store.value).toBeNull();
  });

  it('meldet falsche Zugangsdaten gleich, ob die E-Mail registriert ist oder nicht', async () => {
    const backend = await createTestBackend();
    await registered(backend);

    expect(await phone(backend).auth.signIn({ email: 'anna@example.test', password: 'falsches-passwort' })).toEqual({ type: 'invalid_credentials' });
    expect(await phone(backend).auth.signIn({ email: 'niemand@example.test', password: 'falsches-passwort' })).toEqual({ type: 'invalid_credentials' });
  });

  it('sperrt nach dem Widerruf, behält die Datenbank des Kontos und öffnet sie bei erneuter Anmeldung wieder', async () => {
    const backend = await createTestBackend();
    const { device, accountId } = await registered(backend);
    const hook = vi.fn();
    device.auth.onUnauthorized(hook);

    expect(await device.auth.revokeCurrentSession()).toEqual({ type: 'revoked' });
    expect(await device.auth.checkSession()).toEqual({ type: 'ungueltig' });

    expect(device.auth.state()).toEqual({ type: 'gesperrt', accountId });
    expect(device.data.opened).toBeNull();
    expect(device.data.files).toEqual(new Set([accountId]));
    expect(device.store.value).toEqual({ accountId, token: null });
    expect(hook).toHaveBeenCalledTimes(1);
    expect(await device.auth.checkSession()).toEqual({ type: 'ungueltig' });
    expect(hook).toHaveBeenCalledTimes(1);

    expect(await device.auth.signIn({ email: 'anna@example.test', password: defaultPassword })).toEqual({ type: 'signed_in', accountId });
    expect(device.auth.state()).toEqual({ type: 'angemeldet', accountId });
    expect(device.data.opened).toBe(accountId);
  });

  it('öffnet nach der Sperre bei einem anderen Konto nur dessen Datenbank', async () => {
    const backend = await createTestBackend();
    const anna = await registered(backend, 'anna@example.test');
    const philipp = await registered(backend, 'philipp@example.test');
    await anna.device.auth.revokeCurrentSession();
    await anna.device.auth.checkSession();

    await anna.device.auth.signIn({ email: 'philipp@example.test', password: defaultPassword });

    expect(anna.device.auth.state()).toEqual({ type: 'angemeldet', accountId: philipp.accountId });
    expect(anna.device.data.opened).toBe(philipp.accountId);
    expect(anna.device.data.open).toHaveBeenLastCalledWith(philipp.accountId);
  });

  it('sperrt ein anderes Gerät beim nächsten Fachaufruf nach einer Passwortänderung und ruft den 401-Haken auf', async () => {
    const backend = await createTestBackend();
    const { device: first, accountId } = await registered(backend);
    const second = phone(backend);
    await second.auth.signIn({ email: 'anna@example.test', password: defaultPassword });
    const cancelCheckIns = vi.fn(async () => {});
    second.auth.onUnauthorized(cancelCheckIns);

    expect(await first.auth.changePassword({ currentPassword: defaultPassword, newPassword: 'qwertzuiop' })).toEqual({
      type: 'rejected',
      reason: 'password_compromised',
    });
    expect(await first.auth.changePassword({ currentPassword: 'falsches-passwort', newPassword: 'ganz-neue-passphrase' })).toEqual({
      type: 'current_password_wrong',
    });
    expect(await first.auth.changePassword({ currentPassword: defaultPassword, newPassword: 'ganz-neue-passphrase' })).toEqual({ type: 'changed' });

    const response = await second.auth.fetch(`${testBaseUrl}/v1/person/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(person),
    });
    expect(response.status).toBe(401);
    expect(await response.text()).toBe('');
    expect(second.auth.state()).toEqual({ type: 'gesperrt', accountId });
    expect(cancelCheckIns).toHaveBeenCalledTimes(1);
    expect(await first.auth.checkSession()).toEqual({ type: 'gueltig', accountId });
  });

  it('bleibt ohne Netz mit der gespeicherten Sitzung angemeldet, bis der Server sie ablehnt', async () => {
    const backend = await createTestBackend();
    const { device, accountId } = await registered(backend);
    device.online = false;

    expect(await device.auth.checkSession()).toEqual({ type: 'offline', accountId });
    expect(device.auth.state()).toEqual({ type: 'angemeldet', accountId });
    expect(device.data.opened).toBe(accountId);
    expect(await device.auth.revokeCurrentSession()).toEqual({ type: 'unreachable' });
    expect(await device.auth.signIn({ email: 'anna@example.test', password: defaultPassword })).toEqual({ type: 'unreachable' });
  });

  it('meldet ohne gespeicherte Sitzung „abgemeldet“', async () => {
    const backend = await createTestBackend();
    const device = phone(backend);

    expect(await device.auth.checkSession()).toEqual({ type: 'abgemeldet' });
    expect(device.auth.state()).toEqual({ type: 'abgemeldet' });
  });
});
