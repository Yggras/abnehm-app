import { requiredBackendBaseUrl } from '../backend/client';
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
  SessionRevocation,
  SessionCheck,
  SignInResult,
} from './app-auth';

/** Das Auth-Modul des Geräts: Sitzung in SecureStore, kontogetrennte Datenbank aus `LocalDatabases`. */
export function createDeviceAuth(options: { accountData: AccountData; onError: (error: unknown) => void }): AppAuth {
  return createAppAuth({ baseUrl: requiredBackendBaseUrl(), sessionStore: secureSessionStore, ...options });
}
