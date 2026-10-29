import type { PlanReader } from '@abnehm/contracts/ports';
import type { ComponentType } from 'react';

import type { SessionStore } from '../auth/app-auth';
import { deviceClock } from '../clock/device-clock';
import { openExpoSqlite, removeExpoSqlite } from '../local-db/expo-connection';
import type { AppSession } from '../session/app-session';
import type { ObserveNetwork } from '../sync/triggers';
import { createAppTestClock, type AppTestClock } from './clock';
import { runDeviceSuite } from './device-suite/suite';
import { createFaultController, faultyFetch, faultySessionStore } from './faults';
import { createTestInbox } from './inbox';
import { parseTestLink } from './links';
import { faultyNetwork } from './network';
import { seedPlanReader } from './plan-reader';
import { TestCapabilityHost } from './TestCapabilityHost';

// Testfähigkeiten der App (Spezifikation 0, Abschnitt 12; #112, #114, #171): Seed-Deep-Link, Testuhr,
// Fehler-Adapter für Transport, Server, Auth und Storage samt Transport-Fehlermodus, die
// On-Device-Suite und die PlanReader-Attrappe. App-Code erreicht diesen Ordner nur über `src/build-capabilities.ts`; im
// Produktions-Bundle fehlt er ganz. Jede Datei hier gehört zu einer Testfähigkeit der zentralen
// Registry (`test/test-capabilities.ts`).

export type TestCapabilities = Readonly<{
  clock: AppTestClock;
  /** Umhüllt die echten Abhängigkeiten der App-Sitzung mit den Fehler-Adaptern. */
  adapters: Readonly<{
    fetch(inner: typeof fetch): typeof fetch;
    sessionStore(inner: SessionStore): SessionStore;
    /** Netzstatus für die Sync-Auslöser, überlagert vom Transport-Fehlermodus. */
    network(inner: ObserveNetwork): ObserveNetwork;
  }>;
  /** Für `+native-intent`: nimmt Links der Testfähigkeiten an und öffnet dann „Heute“; andere bleiben unverändert. */
  redirectSystemPath(path: string): string;
  /** Wirt im Root-Layout; führt Seeds mit der App-Sitzung aus. */
  Host: ComponentType<{ session: () => AppSession }>;
  /**
   * Wasserziel und Wochenplan aus den Seed-Manifesten, bis Spezifikation 1 ihren `PlanReader` anmeldet
   * (#171); nach einem Seed aus dem Manifest seines Szenarios (#175).
   */
  planReader: PlanReader;
}>;

const clock = createAppTestClock(deviceClock);
const faults = createFaultController();
/** Kennzeichnet diesen Prozess; so erkennt die On-Device-Suite einen echten Neustart. */
const runtime = deviceClock.read().instant;
const inbox = createTestInbox({
  faults,
  clock,
  deviceSuite: (phase) => runDeviceSuite(phase, { openSqlite: openExpoSqlite, remove: removeExpoSqlite }, runtime),
});

const planReader = seedPlanReader();

function Host({ session }: { session: () => AppSession }) {
  return <TestCapabilityHost inbox={inbox} clock={clock} session={session} planReader={planReader} />;
}

export const testCapabilities: TestCapabilities = {
  clock,
  adapters: {
    fetch: (inner) => faultyFetch(inner, faults),
    sessionStore: (inner) => faultySessionStore(inner, faults),
    network: (inner) => faultyNetwork(inner, faults),
  },
  redirectSystemPath(path) {
    const link = parseTestLink(path);
    if (link === null) return path;
    inbox.receive(link);
    return '/';
  },
  Host,
  planReader,
};
