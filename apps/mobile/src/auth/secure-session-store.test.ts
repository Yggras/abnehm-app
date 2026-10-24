import * as SecureStore from 'expo-secure-store';

import { secureLogoutStore, secureSessionStore } from './secure-session-store';

// Ein Schlüsselbund im Speicher statt des nativen Moduls; geprüft wird, was das Modul dort ablegt.
const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  ...jest.requireActual<Record<string, unknown>>('expo-secure-store'),
  getItemAsync: jest.fn(async (key: string) => mockKeychain.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockKeychain.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockKeychain.delete(key);
  }),
}));

beforeEach(() => {
  mockKeychain.clear();
  jest.clearAllMocks();
});

test('legt Konto und Token in SecureStore ab, lesbar ab dem ersten Entsperren', async () => {
  const session = { accountId: '7b0c6f3e-2a4d-4e8b-9c1f-5d6e7f8a9b0c', token: 'sitzungstoken' };

  await secureSessionStore.write(session);

  expect(await secureSessionStore.read()).toEqual(session);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('abnehm.sitzung', JSON.stringify(session), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
});

test('behält nach einer Sperre das Konto ohne Token', async () => {
  await secureSessionStore.write({ accountId: 'konto', token: null });

  expect(await secureSessionStore.read()).toEqual({ accountId: 'konto', token: null });
});

test('liefert ohne Eintrag, nach dem Löschen und bei unlesbarem Inhalt keine Sitzung', async () => {
  expect(await secureSessionStore.read()).toBeNull();

  await secureSessionStore.write({ accountId: 'konto', token: 'sitzungstoken' });
  await secureSessionStore.clear();
  expect(await secureSessionStore.read()).toBeNull();

  mockKeychain.set('abnehm.sitzung', 'kein json');
  expect(await secureSessionStore.read()).toBeNull();
  mockKeychain.set('abnehm.sitzung', JSON.stringify({ accountId: 'konto', token: 'x', password: 'geheim' }));
  expect(await secureSessionStore.read()).toBeNull();
});

const revocation = { accountId: '7b0c6f3e-2a4d-4e8b-9c1f-5d6e7f8a9b0c', requestId: '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d', token: 'sitzungstoken' };

test('legt den Ausweis von logout_pending wie die Sitzung in SecureStore ab', async () => {
  await secureLogoutStore.write({ phase: 'logout_pending', revocation });

  expect(await secureLogoutStore.read()).toEqual({ phase: 'logout_pending', revocation });
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('abnehm.abmeldung', expect.any(String), {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
  });
});

test('ersetzt logout_pending durch cleanup_pending und vergisst die Abmeldung danach', async () => {
  await secureLogoutStore.write({ phase: 'logout_pending', revocation });
  await secureLogoutStore.write({ phase: 'cleanup_pending', revocation });
  expect(await secureLogoutStore.read()).toEqual({ phase: 'cleanup_pending', revocation });

  await secureLogoutStore.clear();
  expect(await secureLogoutStore.read()).toBeNull();
});

test('liest unlesbare Einträge als keine Abmeldung', async () => {
  mockKeychain.set('abnehm.abmeldung', 'kein json');
  expect(await secureLogoutStore.read()).toBeNull();
  mockKeychain.set('abnehm.abmeldung', JSON.stringify({ phase: 'cleanup_pending' }));
  expect(await secureLogoutStore.read()).toBeNull();
  mockKeychain.set('abnehm.abmeldung', JSON.stringify({ phase: 'cleanup_pending', revocation, password: 'geheim' }));
  expect(await secureLogoutStore.read()).toBeNull();
});
