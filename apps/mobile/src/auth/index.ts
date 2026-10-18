import { backendBaseUrl } from '../backend/client';
import { createAppAuth, type AccountData, type AppAuth } from './app-auth';
import { secureSessionStore } from './secure-session-store';

// Auth-Modul der App (Spezifikation 0, Abschnitt 9). Bildschirme und Bereiche kennen nur `AppAuth`.
export type {
  AppAuth,
  AuthState,
  BootstrapResult,
  ChangePasswordResult,
  PasswordRejection,
  RegisterResult,
  RevokeResult,
  SessionCheck,
  SignInResult,
} from './app-auth';

/** Das Auth-Modul des Geräts: Sitzung in SecureStore, kontogetrennte Datenbank aus `LocalDatabases`. */
export function createDeviceAuth(options: { accountData: AccountData; onError: (error: unknown) => void }): AppAuth {
  const baseUrl = backendBaseUrl();
  if (baseUrl === undefined) throw new Error('EXPO_PUBLIC_API_URL fehlt im Produktionsbuild');
  return createAppAuth({ baseUrl, sessionStore: secureSessionStore, ...options });
}
