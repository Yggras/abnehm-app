import { uuid } from 'expo';
import * as Network from 'expo-network';
import { AppState, Platform } from 'react-native';
import type { Clock } from '@abnehm/clock';
import { EntityId, type Instant } from '@abnehm/contracts/base';

import { secureLogoutStore, secureSessionStore } from '../auth/secure-session-store';
import { backendBaseUrl } from '../backend/client';
import { testCapabilities } from '../build-capabilities';
import { deviceClock } from '../clock/device-clock';
import { createDailyGoalPersistence, createDailyGoalRegistry, createDaysChangedDispatcher, dailyGoalCommands, dailyGoalCompletionEntity } from '../daily-goals';
import { energyBookingEntity } from '../energy';
import { createHealthImport, unavailableHealthPlatform } from '../health';
import { appHealthImport } from '../health/app-health';
import { appGameService } from '../island/app-game-service';
import { createGameService } from '../island/game-service';
import { islandSyncEntities } from '../island/island-entities';
import { sharedActionCommands } from '../island/shared-action-commands';
import { createDeviceLocalDatabases } from '../local-db/device-databases';
import { createLogout, syncBeforeLogout, type Logout } from '../logout';
import { appNutrition, createNutrition, mealPhotoEntity, nutritionEntryEntity, confirmPhotoDraftCommand, ownFoodEntity } from '../nutrition';
import { createOnboarding, type Onboarding } from '../onboarding/onboarding';
import { createDeviceInvitationFlows } from '../online';
import { createPlan, followDailyGoalTriggers, goalVersionEntity, planCommands, planReaderOf, weeklyPlanVersionEntity } from '../plan';
import { followOwnDisplayName, type AccountPorts } from '../settings';
import { appQuickCommands } from '../shell/app-quick-commands';
import { appTodayRegistry, followTodayContribution, followTodayPerson } from '../shell/app-today';
import { appWirContributions } from '../shell/app-wir';
import { appTodayRefresh } from '../shell/today-refresh';
import { createHttpSyncTransport, createLocalCommandRegistry, createSyncEngine, createSyncRegistry, createSyncWriter, foundationLocalCommands, foundationSyncEntities, type SyncEngine } from '../sync';
import { startSyncTriggers } from '../sync/triggers';
import { installationId, observeOutbox, observePendingSignature } from '../sync/device-metadata';
import { appTrackers, createTrackers, sportEntryEntity, waterEntryEntity, weightEntryEntity } from '../trackers';
import { createAppSession, type AppSession } from './app-session';
import { followSessionGate, type SessionGateSource } from './session-gate';
import { followPersonTimeZone } from './time-zone-follower';
import { syncStatusSource } from './sync-status-source';

// Composition Root der App-Sitzung auf dem Gerät. In Test-Artefakten (Development- und E2E-Build)
// umhüllen die Testfähigkeiten Uhr, `fetch`, SessionStore und Netzstatus mit ihren steuerbaren
// Adaptern (#112, #114); im Produktions-Bundle ist `testCapabilities` `null` und die Adapter fehlen ganz.

/** Uhr der App: die Geräteuhr, in Test-Artefakten die Testuhr, die ein Seed stellt. */
export const appClock: Clock = testCapabilities?.clock ?? deviceClock;

const onError = (error: unknown) => console.error('[sitzung]', error);
const newId = () => EntityId.parse(uuid.v4());
/** Der Kopf von „Heute“ ist ab dem Start registriert und folgt der geöffneten Kontodatenbank. */
const todayPersonOpened = followTodayPerson(appTodayRegistry, appClock);
const syncRegistry = createSyncRegistry([
  ...foundationSyncEntities, goalVersionEntity, weeklyPlanVersionEntity, dailyGoalCompletionEntity, energyBookingEntity, nutritionEntryEntity, mealPhotoEntity, ownFoodEntity, waterEntryEntity,
  weightEntryEntity, sportEntryEntity, ...islandSyncEntities,
]);
/** Mini-Tracker `trackers.water`; sein Wasserziel liest er über den `PlanReader` aus Spezifikation 1 (#128). */
const waterTodayOpened = followTodayContribution(appTodayRegistry, 'tracker', 'trackers.water');
/** Mini-Tracker `trackers.weight`; seine Wiegetage liest er ebenfalls über den `PlanReader` (#175). */
const weightTodayOpened = followTodayContribution(appTodayRegistry, 'tracker', 'trackers.weight');
/** Mini-Tracker `trackers.sport`; sein Sportwochenziel liest er ebenfalls über den `PlanReader` (#173). */
const sportTodayOpened = followTodayContribution(appTodayRegistry, 'tracker', 'trackers.sport');
/** Momo auf „Heute“ (Spezifikation 4): Laichkugel und Rollenwahl (#180), nach dem Schlüpfen Momo mit Level (#184). */
const momoTodayOpened = followTodayContribution(appTodayRegistry, 'momo', 'momo.character');
const syncWriter = createSyncWriter({ registry: syncRegistry, clock: appClock, newId });
/**
 * Health-Plattform des Geräts (Spezifikation 3, Abschnitt 6; #183). Bis HealthKit (#193) und Health Connect
 * (#195) ihre Adapter liefern, ist Health nicht verfügbar; in Test-Artefakten übernimmt ab dem Link `health`
 * die Attrappe.
 */
const devicePlatform = unavailableHealthPlatform(Platform.OS === 'ios' ? 'apple_health' : 'health_connect');
const healthPlatform = testCapabilities?.adapters.healthPlatform(devicePlatform) ?? devicePlatform;
/** Ob die App im Vordergrund ist, laut React Native; meldet jede Änderung. */
function observeAppForeground(listener: (active: boolean) => void) {
  const subscription = AppState.addEventListener('change', (state) => listener(state === 'active'));
  return () => subscription.remove();
}
/** Der eigene Anzeigename für die Einstellungen (Spezifikation 5); folgt der geöffneten Kontodatenbank. */
const ownDisplayName = followOwnDisplayName({ writer: syncWriter, clock: appClock });
let activeEngine: SyncEngine | null = null;
let backgroundOpening = false;
/** Setzt die Zone der Person beim Start und bei jedem Wechsel (#110). */
const timeZone = followPersonTimeZone({
  clock: appClock,
  newId,
  onError,
  commandsFor: (database) => createLocalCommandRegistry({ database, writer: syncWriter, commands: foundationLocalCommands }),
});
let device: { session: AppSession; gate: SessionGateSource; logout: Logout; account: AccountPorts; onboarding: Onboarding } | null = null;
let sessionChecked = false;

/** Ob das Gerät Internet hat, laut Expo Network; meldet nur Änderungen. */
function observeDeviceNetwork(listener: (online: boolean) => void) {
  const subscription = Network.addNetworkStateListener((state) => listener(state.isInternetReachable === true));
  return () => subscription.remove();
}

/** Sitzung und Weiche des Geräts; beim ersten Aufruf angelegt. */
function deviceState() {
  if (device !== null) return device;
  const baseUrl = backendBaseUrl();
  if (baseUrl === undefined) throw new Error('EXPO_PUBLIC_API_URL fehlt im Produktionsbuild');
  const adapters = testCapabilities?.adapters;
  let gate: SessionGateSource | null = null;
  let onboarding: Onboarding | null = null;
  const session = createAppSession({
    baseUrl,
    fetch: adapters?.fetch(globalThis.fetch, baseUrl) ?? globalThis.fetch,
    sessionStore: adapters?.sessionStore(secureSessionStore) ?? secureSessionStore,
    databases: createDeviceLocalDatabases({ onError }),
    // Kontobezogene Beobachter an der geöffneten Datenbank; beim Sperren lösen sie sich wieder.
    onAccountOpened(database) {
      const dispatcher = createDaysChangedDispatcher({ database, observers: [], onError });
      const persistence = createDailyGoalPersistence({
        registry: createDailyGoalRegistry({ bausteine: [], checkIns: [] }), clock: appClock, writer: syncWriter, dispatcher,
      });
      // Ernährung (Spezifikation 2): Protokoll und Erfassen sprechen nur mit diesem Modul.
      const nutrition = createNutrition({ database, clock: appClock, writer: syncWriter, persistence, newId });
      // Tracker-Modul (Spezifikation 3): Quick-Command `water.quick_add`, die Beiträge `trackers.water`,
      // `trackers.sport` und `trackers.weight` und die Bildschirme des Bereichs (`appTrackers`). Den
      // Schreib-Port `weightRecorder` gibt der Composition Root an `composeAreaPorts` weiter, sobald alle
      // Pflichtports angemeldet sind.
      const trackers = createTrackers({ database, clock: appClock, writer: syncWriter, persistence, newId });
      // Health-Import (Spezifikation 3, Abschnitt 6): schreibt nur über den Importbefehl des Tracker-Moduls und
      // läuft beim App-Start, bei Rückkehr in den Vordergrund, nach dem Verbinden und auf „Jetzt abrufen“.
      const health = createHealthImport({ database, platform: healthPlatform, trackers, clock: appClock, onError });
      // Plan-Modul (Spezifikation 1): Seine Materialisierung legt fehlende Tage im Nachholfenster an, bevor
      // der Persistenzdienst auswertet (#131). Das Startgewicht des Erstplans läuft über den `WeightRecorder`
      // des Tracker-Moduls.
      const plan = createPlan({ database, clock: appClock, writer: syncWriter, persistence, weightRecorder: trackers.weightRecorder, newId });
      persistence.registerMissingDaysHook(plan.materializeMissingDays);
      // Momo, Insel & Challenges (Spezifikation 4): Spieldienst des Tabs „Momo“ samt Beiträgen an „Heute“ und „Wir“.
      const game = createGameService({ database, writer: syncWriter, clock: appClock, newId });
      const engine = createSyncEngine({ database, registry: syncRegistry,
        transport: createHttpSyncTransport({ baseUrl, fetch: session.auth.fetch }), clock: appClock,
        installationId: installationId(database, appClock, newId), onCanonicalChanges: persistence.onCanonicalChanges,
        commands: createLocalCommandRegistry({ database, writer: syncWriter, commands: [...foundationLocalCommands, ...dailyGoalCommands, ...planCommands, ...sharedActionCommands, confirmPhotoDraftCommand({ persistence })] }),
      });
      activeEngine = engine;
      void dispatcher.deliver();
      const stops = [
        todayPersonOpened(database), timeZone.opened(database), gate?.opened(database), onboarding?.opened(database), ownDisplayName.opened(database),
        appNutrition.opened(nutrition),
        appQuickCommands.opened(database, trackers.quickCommands),
        appTrackers.opened(trackers),
        appHealthImport.opened(health),
        health.startForegroundTriggers({ initialActive: !backgroundOpening && AppState.currentState === 'active', observeForeground: observeAppForeground }),
        waterTodayOpened(trackers.waterToday(planReaderOf(database), appTodayRefresh)),
        weightTodayOpened(trackers.weightToday(planReaderOf(database), appTodayRefresh)),
        sportTodayOpened(trackers.sportToday(planReaderOf(database), appTodayRefresh)),
        appGameService.opened(game), momoTodayOpened(game.momoCharacter), appWirContributions.opened(game.wirContributions),
        // Tagesziele sicherstellen: jetzt (App-Start), im Vordergrund und am lokalen Tageswechsel (#131).
        followDailyGoalTriggers({
          ensure: plan.ensureDailyGoals,
          today: () => appClock.read().localDate,
          observeForeground(listener) {
            const subscription = AppState.addEventListener('change', (state) => {
              if (state === 'active') listener();
            });
            return () => subscription.remove();
          },
          // Derselbe Takt wie für „Heute“: im Minutentakt, im Vordergrund und in Test-Artefakten bei jedem
          // Sprung der Testuhr (#114); er löst nur aus, wenn sich der lokale Tag geändert hat.
          observeTicks: appTodayRefresh,
          onError,
        }),
      ];
      const publishStatus = () => syncStatusSource.publish(engine.status());
      const stopStatus = observeOutbox(database, publishStatus);
      const statusTimer = setInterval(publishStatus, 60_000);
      // Die Testuhr springt in Test-Artefakten; der Status folgt sofort statt erst im Minutentakt (#114).
      const stopClockStatus = testCapabilities?.clock.subscribe(publishStatus);
      const triggers = startSyncTriggers({ initialActive: !backgroundOpening && AppState.currentState === 'active',
        sync: () => engine.sync(),
        observePending: (listener) => observePendingSignature(database, listener),
        observeForeground: observeAppForeground,
        // In Test-Artefakten überlagert vom Transport-Fehlermodus, dem iOS-Ersatz für den Flugmodus (#114).
        observeNetwork: adapters?.network(observeDeviceNetwork) ?? observeDeviceNetwork,
      });
      return () => {
        triggers.dispose(); stopStatus(); stopClockStatus?.(); clearInterval(statusTimer);
        if (activeEngine === engine) activeEngine = null;
        syncStatusSource.publish({ type: 'secured' });
        for (const stop of stops) stop?.();
      };
    },
    onError,
  });
  // Die Weiche folgt dem Auth-Modul ab seiner Entstehung; vorher öffnet es keine Kontodatenbank.
  gate = followSessionGate(session.auth);
  // Onboarding (Spezifikation 1): Schritte 1–2 vor dem Konto, Einrichtung und Bestätigung an der Person.
  onboarding = createOnboarding({ auth: session.auth, clock: appClock, writer: syncWriter, sync: () => activeEngine?.sync(), onError });
  const logout = createLogout({
    auth: session.auth,
    revocations: session.revocations,
    databases: session.databases,
    store: secureLogoutStore,
    sync: () => syncBeforeLogout(activeEngine),
    newId,
    onError,
  });
  // Ein Zeitzonenwechsel zeigt sich spätestens bei der Rückkehr in den Vordergrund
  // (https://docs.expo.dev/versions/v58.0.0/sdk/localization/), bei offener App im selben Takt wie
  // der Kopf von „Heute“.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') timeZone.check();
  });
  setInterval(() => timeZone.check(), 60_000);
  // Eine neue Zone der Testuhr ist ein Zeitzonenwechsel wie eine Reise (#114).
  testCapabilities?.clock.subscribe(() => timeZone.check());
  device = { session, gate, logout, account: { auth: session.auth, logout, displayName: ownDisplayName }, onboarding };
  return device;
}

/** Das Onboarding-Modul des Geräts für die Routen `sitzung` und `onboarding`. */
export function deviceOnboarding(): Onboarding {
  return deviceState().onboarding;
}

/** Die Sitzung des Geräts; beim ersten Aufruf angelegt. */
export function deviceSession(): AppSession {
  return deviceState().session;
}

/** Health-Hintergrundfenster: prüft die gespeicherte Sitzung, öffnet bei Bedarf SQLite und pusht ohne React. */
export async function pushDeviceNow({ deadline }: { deadline: Instant }) {
  try {
    const { session, logout } = deviceState();
    if (!session.databases.current()) {
      backgroundOpening = true;
      // Eine offene Bereinigung zuerst, damit keine abgemeldete Kontodatenbank öffnet.
      try { await logout.start({ resumeLogout: false }); }
      finally { backgroundOpening = false; }
    }
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

/**
 * Die Sitzungs-Weiche des Geräts. Beim ersten Aufruf setzt das Abmeldemodul eine offene Bereinigung fort
 * und prüft dann die gespeicherte Sitzung.
 */
export function deviceGate(): SessionGateSource {
  const { logout, gate } = deviceState();
  if (!sessionChecked) {
    sessionChecked = true;
    void logout.start().catch(onError);
  }
  return gate;
}

/** Das Abmeldemodul des Geräts für die Oberfläche unter „Konto“ (Spezifikation 5). */
export function deviceLogout(): Logout {
  return deviceState().logout;
}

/** Was Übersicht und „Konto“ der Einstellungen brauchen (Spezifikation 5, Abschnitt 6). */
export function deviceAccount(): AccountPorts {
  return deviceState().account;
}
