import type { ComponentType } from 'react';

import type { SessionStore } from '../auth/app-auth';
import { deviceClock } from '../clock/device-clock';
import { openExpoSqlite, removeExpoSqlite } from '../local-db/expo-connection';
import type { HealthPlatformAdapter } from '../health';
import type { NotificationPort } from '../notifications/port';
import type { AppSession } from '../session/app-session';
import type { SessionGate } from '../session/session-gate';
import type { ObserveNetwork } from '../sync/triggers';
import { createAppTestClock, type AppTestClock } from './clock';
import { runDeviceSuite } from './device-suite/suite';
import { createFaultController, faultyFetch, faultySessionStore } from './faults';
import { fixtureIsland, type FixtureIsland } from './fixture-island';
import { createTestHealth } from './health';
import { createTestInbox } from './inbox';
import { parseTestLink } from './links';
import { faultyNetwork } from './network';
import { createNotificationTestControl } from './notifications';
import { fetchFollowingServerClock } from './server-clock';
import { TestCapabilityHost } from './TestCapabilityHost';

// Testfähigkeiten der App (Spezifikation 0, Abschnitt 12; #112, #114, #182, #271, #125): Seed-Deep-Link,
// Testuhr samt Serveruhr des Development-Backends, Fehler-Adapter für Transport, Server, Auth und
// Storage samt Transport-Fehlermodus, die On-Device-Suite, die Fixture-Insel, die Health-Attrappe (#183) und der Fake-Mitteilungs-Port. App-Code erreicht
// diesen Ordner nur über `src/build-capabilities.ts`; im Produktions-Bundle fehlt er ganz. Jede Datei hier gehört zu einer
// Testfähigkeit der zentralen Registry (`test/test-capabilities.ts`).

export type TestCapabilities = Readonly<{
  clock: AppTestClock;
  /** Umhüllt die echten Abhängigkeiten der App-Sitzung mit den Fehler-Adaptern. */
  adapters: Readonly<{
    /** Fehler-Adapter um `fetch`; darunter folgt die Serveruhr unter `baseUrl` der Testuhr (#271). Einmal je Sitzung. */
    fetch(inner: typeof fetch, baseUrl: string): typeof fetch;
    sessionStore(inner: SessionStore): SessionStore;
    /** Netzstatus für die Sync-Auslöser, überlagert vom Transport-Fehlermodus. */
    network(inner: ObserveNetwork): ObserveNetwork;
    /** Health-Plattform; ab dem ersten Link `health` antwortet die Attrappe (#183). Einmal je Prozess. */
    healthPlatform(inner: HealthPlatformAdapter): HealthPlatformAdapter;
    /** Mitteilungs-Port vor dem echten, umschaltbar auf den Fake (#125). */
    notifications(inner: NotificationPort): NotificationPort;
  }>;
  /** Meldet jedes Umschalten des Mitteilungs-Ports; die App liest dann die Erlaubnis neu. */
  notificationsChanged(listener: () => void): () => void;
  /** Für `+native-intent`: nimmt Links der Testfähigkeiten an und öffnet dann „Heute“; andere bleiben unverändert. */
  redirectSystemPath(path: string): string;
  /**
   * Wirt im Root-Layout; führt Seeds mit der App-Sitzung aus. `gate` ist die Sitzungs-Weiche des
   * Wurzel-Layouts; Seed-Ziele öffnet der Host erst, wenn sie die Fachoberfläche freigibt.
   */
  Host: ComponentType<{ session: () => AppSession; gate: SessionGate | null }>;
  /** Insel des Tabs „Momo“, bis das Schlüpfen die echte Insel anschließt (#182, #184). */
  fixtureIsland: FixtureIsland;
}>;

const clock = createAppTestClock(deviceClock);
const faults = createFaultController();
const notifications = createNotificationTestControl();
/** Kennzeichnet diesen Prozess; so erkennt die On-Device-Suite einen echten Neustart. */
const runtime = deviceClock.read().instant;
const health = createTestHealth(clock);
const inbox = createTestInbox({
  faults,
  clock,
  notifications,
  deviceSuite: (phase) => runDeviceSuite(phase, { openSqlite: openExpoSqlite, remove: removeExpoSqlite }, runtime),
  health,
});

function Host({ session, gate }: { session: () => AppSession; gate: SessionGate | null }) {
  return <TestCapabilityHost inbox={inbox} clock={clock} notifications={notifications} session={session} gate={gate} />;
}

export const testCapabilities: TestCapabilities = {
  clock,
  adapters: {
    fetch: (inner, baseUrl) => faultyFetch(fetchFollowingServerClock(inner, { clock, baseUrl }), faults),
    sessionStore: (inner) => faultySessionStore(inner, faults),
    network: (inner) => faultyNetwork(inner, faults),
    healthPlatform: (inner) => health.platform(inner),
    notifications: (inner) => notifications.port(inner),
  },
  notificationsChanged: notifications.subscribe,
  redirectSystemPath(path) {
    const link = parseTestLink(path);
    if (link === null) return path;
    inbox.receive(link);
    return '/';
  },
  Host,
  fixtureIsland: fixtureIsland(),
};
