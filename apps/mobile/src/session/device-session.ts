import { uuid } from 'expo';
import { AppState } from 'react-native';

import type { Clock } from '@abnehm/clock';
import { EntityId } from '@abnehm/contracts/base';

import { secureSessionStore } from '../auth/secure-session-store';
import { backendBaseUrl } from '../backend/client';
import { testCapabilities } from '../build-capabilities';
import { deviceClock } from '../clock/device-clock';
import { createDeviceLocalDatabases, type LocalDatabase } from '../local-db';
import { appTodayRegistry, followTodayPerson } from '../shell/app-today';
import { createLocalCommandRegistry, createSyncRegistry, createSyncWriter, foundationLocalCommands, foundationSyncEntities } from '../sync';
import { createAppSession, type AppSession } from './app-session';
import { followSessionGate, type SessionGateSource } from './session-gate';
import { followPersonTimeZone } from './time-zone-follower';

// Composition Root der App-Sitzung auf dem Gerät. Im Development Build umhüllen die Testfähigkeiten
// Uhr, `fetch` und SessionStore mit ihren steuerbaren Adaptern (#112); im Produktions-Bundle ist
// `testCapabilities` `null` und die Adapter fehlen ganz.

/** Uhr der App: die Geräteuhr, im Development Build die Testuhr, die ein Seed stellt. */
export const appClock: Clock = testCapabilities?.clock ?? deviceClock;

const onError = (error: unknown) => console.error('[sitzung]', error);
const newId = () => EntityId.parse(uuid.v4());
/** Der Kopf von „Heute“ ist ab dem Start registriert und folgt der geöffneten Kontodatenbank. */
const todayPersonOpened = followTodayPerson(appTodayRegistry, appClock);
const syncWriter = createSyncWriter({ registry: createSyncRegistry(foundationSyncEntities), clock: appClock, newId });
/** Setzt die Zone der Person beim Start und bei jedem Wechsel (#110). */
const timeZone = followPersonTimeZone({
  clock: appClock,
  newId,
  onError,
  commandsFor: (database) => createLocalCommandRegistry({ database, writer: syncWriter, commands: foundationLocalCommands }),
});
let session: AppSession | null = null;
let gate: SessionGateSource | null = null;
let sessionChecked = false;

/** Kontobezogene Beobachter an der geöffneten Datenbank; beim Sperren lösen sie sich wieder. */
function accountOpened(database: LocalDatabase) {
  const stops = [todayPersonOpened(database), timeZone.opened(database), gate?.opened(database)];
  return () => {
    for (const stop of stops) stop?.();
  };
}

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
    onAccountOpened: accountOpened,
    onError,
  });
  // Die Weiche folgt dem Auth-Modul ab seiner Entstehung; vorher öffnet es keine Kontodatenbank.
  gate = followSessionGate(session.auth);
  // Ein Zeitzonenwechsel zeigt sich spätestens bei der Rückkehr in den Vordergrund
  // (https://docs.expo.dev/versions/v58.0.0/sdk/localization/).
  AppState.addEventListener('change', (state) => {
    if (state === 'active') timeZone.check();
  });
  return session;
}

/** Die Sitzungs-Weiche des Geräts; beim ersten Aufruf prüft das Auth-Modul die gespeicherte Sitzung. */
export function deviceGate(): SessionGateSource {
  const { auth } = deviceSession();
  if (!sessionChecked) {
    sessionChecked = true;
    void auth.checkSession().catch(onError);
  }
  return gate!;
}
