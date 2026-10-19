import type { Clock } from '@abnehm/clock';

import { secureSessionStore } from '../auth/secure-session-store';
import { backendBaseUrl } from '../backend/client';
import { testCapabilities } from '../build-capabilities';
import { deviceClock } from '../clock/device-clock';
import { createDeviceLocalDatabases } from '../local-db';
import { attachTodayPerson } from '../shell/app-today';
import { createAppSession, type AppSession } from './app-session';

// Composition Root der App-Sitzung auf dem Gerät. Im Development Build umhüllen die Testfähigkeiten
// Uhr, `fetch` und SessionStore mit ihren steuerbaren Adaptern (#112); im Produktions-Bundle ist
// `testCapabilities` `null` und die Adapter fehlen ganz.

/** Uhr der App: die Geräteuhr, im Development Build die Testuhr, die ein Seed stellen kann. */
export const appClock: Clock = testCapabilities?.clock ?? deviceClock;

const onError = (error: unknown) => console.error('[sitzung]', error);
let session: AppSession | null = null;

/** Die Sitzung des Geräts; beim ersten Aufruf angelegt. */
export function deviceSession(): AppSession {
  if (session !== null) return session;
  const baseUrl = backendBaseUrl();
  if (baseUrl === undefined) throw new Error('EXPO_PUBLIC_API_URL fehlt im Produktionsbuild');
  const adapters = testCapabilities?.adapters;
  session = createAppSession({
    baseUrl,
    fetch: adapters?.fetch(globalThis.fetch) ?? globalThis.fetch,
    sessionStore: adapters?.sessionStore(secureSessionStore) ?? secureSessionStore,
    databases: createDeviceLocalDatabases({ onError }),
    clock: appClock,
    onAccountOpened: (database) => attachTodayPerson(database, appClock),
    onError,
  });
  return session;
}
