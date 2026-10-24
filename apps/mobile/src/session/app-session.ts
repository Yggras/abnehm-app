import { createAppAuth, type AccountData, type AppAuth, type SessionRevocations, type SessionStore } from '../auth/app-auth';
import type { LocalDatabase, LocalDatabases } from '../local-db';

// App-Sitzung: setzt Auth-Modul und kontogetrennte lokale Datenbanken zusammen. Öffnet das
// Auth-Modul die Datenbank eines Kontos, hängen sich die kontobezogenen Beobachter an (etwa der
// Kopf von „Heute“); beim Sperren lösen sie sich wieder. Die Datei kennt weder React Native noch
// Expo, damit Integrationstests sie gegen die echte Hono-App laufen lassen.

export type AppSession = Readonly<{
  auth: AppAuth;
  /** Dasselbe Auth-Modul in der Rolle des Abmeldemoduls; nur dieses erhält sie. */
  revocations: SessionRevocations;
  databases: LocalDatabases;
  /** `fetch` der Sitzung ohne Sitzungstoken, etwa für öffentliche Endpunkte. */
  fetch: typeof fetch;
  /** Basis-URL des Backends, ohne `/v1`. */
  baseUrl: string;
}>;

export type AppSessionOptions = Readonly<{
  baseUrl: string;
  fetch: typeof fetch;
  sessionStore: SessionStore;
  databases: LocalDatabases;
  /** Hängt kontobezogene Beobachter an die geöffnete Datenbank; die Rückgabe löst sie wieder. */
  onAccountOpened?: (database: LocalDatabase) => () => void;
  onError: (error: unknown) => void;
}>;

export function createAppSession({ baseUrl, fetch, sessionStore, databases, onAccountOpened, onError }: AppSessionOptions): AppSession {
  let detach: (() => void) | null = null;
  const release = () => {
    detach?.();
    detach = null;
  };
  const accountData: AccountData = {
    async open(accountId) {
      const database = await databases.open(accountId);
      release();
      detach = onAccountOpened?.(database) ?? null;
      return database;
    },
    lock() {
      release();
      databases.lock();
    },
  };
  const auth = createAppAuth({ baseUrl, fetch, sessionStore, accountData, onError });
  return { auth, revocations: auth, databases, fetch, baseUrl };
}
