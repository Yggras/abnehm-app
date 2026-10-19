import { uuid } from 'expo';
import * as Network from 'expo-network';
import { AppState } from 'react-native';
import { eq } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, type Instant as InstantType } from '@abnehm/contracts/base';

import { secureSessionStore } from '../auth/secure-session-store';
import { backendBaseUrl } from '../backend/client';
import { testCapabilities } from '../build-capabilities';
import { deviceClock } from '../clock/device-clock';
import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCommands, dailyGoalCompletionEntity } from '../daily-goals';
import { energyBookingEntity } from '../energy';
import { createDeviceLocalDatabases } from '../local-db';
import { createDeviceInvitationFlows } from '../online';
import type { LocalDatabase } from '../local-db';
import { deviceState as deviceStateTable, outbox } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { appTodayRegistry, followTodayPerson } from '../shell/app-today';
import { createHttpSyncTransport, createLocalCommandRegistry, createSyncEngine, createSyncRegistry, createSyncWriter, foundationLocalCommands, foundationSyncEntities, type SyncEngine } from '../sync';
import { startSyncTriggers } from '../sync/triggers';
import { createAppSession, type AppSession } from './app-session';
import { followSessionGate, type SessionGateSource } from './session-gate';
import { followPersonTimeZone } from './time-zone-follower';
import { syncStatusSource } from './sync-status-source';

// Composition Root der App-Sitzung auf dem Gerät. Im Development Build umhüllen die Testfähigkeiten
// Uhr, `fetch` und SessionStore mit ihren steuerbaren Adaptern (#112); im Produktions-Bundle ist
// `testCapabilities` `null` und die Adapter fehlen ganz.

/** Uhr der App: die Geräteuhr, im Development Build die Testuhr, die ein Seed stellt. */
export const appClock: Clock = testCapabilities?.clock ?? deviceClock;

const onError = (error: unknown) => console.error('[sitzung]', error);
const newId = () => EntityId.parse(uuid.v4());
/** Der Kopf von „Heute“ ist ab dem Start registriert und folgt der geöffneten Kontodatenbank. */
const todayPersonOpened = followTodayPerson(appTodayRegistry, appClock);
const syncRegistry = createSyncRegistry([...foundationSyncEntities, dailyGoalCompletionEntity, energyBookingEntity]);
const syncWriter = createSyncWriter({ registry: syncRegistry, clock: appClock, newId });
let activeEngine: SyncEngine | null = null;

function installationId(database: LocalDatabase) {
  return database.transaction((tx) => {
    const db = sqliteOf(tx);
    const existing = db.select().from(deviceStateTable).where(eq(deviceStateTable.key, 'sync_installation_id')).get();
    if (existing) return EntityId.parse(existing.value);
    const id = newId();
    db.insert(deviceStateTable).values({ key: 'sync_installation_id', value: id, updatedAt: Instant.parse(appClock.read().instant) }).run();
    return id;
  });
}
/** Setzt die Zone der Person beim Start und bei jedem Wechsel (#110). */
const timeZone = followPersonTimeZone({
  clock: appClock,
  newId,
  onError,
  commandsFor: (database) => createLocalCommandRegistry({ database, writer: syncWriter, commands: foundationLocalCommands }),
});
let device: { session: AppSession; gate: SessionGateSource } | null = null;
let sessionChecked = false;

/** Sitzung und Weiche des Geräts; beim ersten Aufruf angelegt. */
function deviceState() {
  if (device !== null) return device;
  const baseUrl = backendBaseUrl();
  if (baseUrl === undefined) throw new Error('EXPO_PUBLIC_API_URL fehlt im Produktionsbuild');
  const adapters = testCapabilities?.adapters;
  let gate: SessionGateSource | null = null;
  const session = createAppSession({
    baseUrl,
    fetch: adapters?.fetch(globalThis.fetch) ?? globalThis.fetch,
    sessionStore: adapters?.sessionStore(secureSessionStore) ?? secureSessionStore,
    databases: createDeviceLocalDatabases({ onError }),
    // Kontobezogene Beobachter an der geöffneten Datenbank; beim Sperren lösen sie sich wieder.
    onAccountOpened(database) {
      const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError });
      const persistence = createDailyGoalPersistence({
        registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock: appClock, writer: syncWriter, dispatcher,
      });
      const engine = createSyncEngine({ database, registry: syncRegistry,
        transport: createHttpSyncTransport({ baseUrl, fetch: session.auth.fetch }), clock: appClock,
        installationId: installationId(database), onCanonicalChanges: persistence.onCanonicalChanges,
        commands: createLocalCommandRegistry({ database, writer: syncWriter, commands: [...foundationLocalCommands, ...dailyGoalCommands] }),
      });
      activeEngine = engine;
      void dispatcher.deliver();
      const stops = [todayPersonOpened(database), timeZone.opened(database), gate?.opened(database)];
      const publishStatus = () => syncStatusSource.publish(engine.status());
      const stopStatus = database.observe((tx) => sqliteOf(tx).select({ operationId: outbox.operationId }).from(outbox).all(), publishStatus);
      const statusTimer = setInterval(publishStatus, 60_000);
      const triggers = startSyncTriggers({ sync: () => engine.sync(),
        observePending(listener) {
          return database.observe((tx) => sqliteOf(tx).select({ operationId: outbox.operationId }).from(outbox).orderBy(outbox.sequence).all(),
            (rows) => listener(rows.map((row) => row.operationId).join(',')));
        },
        observeForeground(listener) {
          const subscription = AppState.addEventListener('change', (state) => listener(state === 'active'));
          return () => subscription.remove();
        },
        observeNetwork(listener) {
          const subscription = Network.addNetworkStateListener((state) => listener(state.isInternetReachable === true));
          return () => subscription.remove();
        },
      });
      return () => {
        triggers.dispose(); stopStatus(); clearInterval(statusTimer);
        if (activeEngine === engine) activeEngine = null;
        syncStatusSource.publish({ type: 'secured' });
        for (const stop of stops) stop?.();
      };
    },
    onError,
  });
  // Die Weiche folgt dem Auth-Modul ab seiner Entstehung; vorher öffnet es keine Kontodatenbank.
  gate = followSessionGate(session.auth);
  // Ein Zeitzonenwechsel zeigt sich spätestens bei der Rückkehr in den Vordergrund
  // (https://docs.expo.dev/versions/v58.0.0/sdk/localization/), bei offener App im selben Takt wie
  // der Kopf von „Heute“.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') timeZone.check();
  });
  setInterval(() => timeZone.check(), 60_000);
  device = { session, gate };
  return device;
}

/** Die Sitzung des Geräts; beim ersten Aufruf angelegt. */
export function deviceSession(): AppSession {
  return deviceState().session;
}

/** Health-Hintergrundfenster: prüft die gespeicherte Sitzung, öffnet bei Bedarf SQLite und pusht ohne React. */
export async function pushDeviceNow({ deadline }: { deadline: InstantType }) {
  try {
    const session = deviceSession();
    if (!session.databases.current()) await session.auth.checkSession();
    return activeEngine ? await activeEngine.pushNow({ deadline }) : 'failed' as const;
  } catch {
    return 'failed' as const;
  }
}

/** Pull-to-Refresh für Bereichsbildschirme: geteilter Engine-Zyklus des geöffneten Kontos. */
export function refreshDeviceSync() {
  return activeEngine?.sync();
}

/** Derselbe ID-Erzeuger wie für Outbox-Operationen; Online-Flows benötigen nur den Sync-Trigger. */
export function deviceInvitationFlows() {
  return { invitations: createDeviceInvitationFlows({ fetch: deviceSession().auth.fetch,
    sync: { sync: () => activeEngine?.sync() ?? Promise.resolve() } }), newId };
}

/** Die Sitzungs-Weiche des Geräts; beim ersten Aufruf prüft das Auth-Modul die gespeicherte Sitzung. */
export function deviceGate(): SessionGateSource {
  const { session, gate } = deviceState();
  if (!sessionChecked) {
    sessionChecked = true;
    void session.auth.checkSession().catch(onError);
  }
  return gate;
}
