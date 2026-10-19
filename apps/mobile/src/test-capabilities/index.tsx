import type { ComponentType } from 'react';

import type { SessionStore } from '../auth/app-auth';
import { deviceClock } from '../clock/device-clock';
import type { AppSession } from '../session/app-session';
import { createAppTestClock, type AppTestClock } from './clock';
import { createFaultController, faultyFetch, faultySessionStore, type FaultController } from './faults';
import { createTestInbox } from './inbox';
import { parseTestLink } from './links';
import { TestCapabilityHost } from './TestCapabilityHost';

// Testfähigkeiten der App (Spezifikation 0, Abschnitt 12; #112): Seed-Deep-Link, Testuhr und
// Fehler-Adapter für Transport, Server, Auth und Storage. App-Code erreicht diesen Ordner nur über
// `src/build-capabilities.ts`; im Produktions-Bundle fehlt er ganz. Jede Datei hier gehört zu einer
// Testfähigkeit der zentralen Registry (`test/test-capabilities.ts`).

export type TestCapabilities = Readonly<{
  clock: AppTestClock;
  faults: FaultController;
  /** Umhüllt die echten Abhängigkeiten der App-Sitzung mit den Fehler-Adaptern. */
  adapters: Readonly<{ fetch(inner: typeof fetch): typeof fetch; sessionStore(inner: SessionStore): SessionStore }>;
  /** Für `+native-intent`: nimmt Links der Testfähigkeiten an und öffnet dann „Heute“; andere bleiben unverändert. */
  redirectSystemPath(path: string): string;
  /** Wirt im Root-Layout; führt Seeds mit der App-Sitzung aus. */
  Host: ComponentType<{ session: () => AppSession }>;
}>;

const clock = createAppTestClock(deviceClock);
const faults = createFaultController();
const inbox = createTestInbox(faults);

function Host({ session }: { session: () => AppSession }) {
  return <TestCapabilityHost inbox={inbox} clock={clock} session={session} />;
}

export const testCapabilities: TestCapabilities = {
  clock,
  faults,
  adapters: {
    fetch: (inner) => faultyFetch(inner, faults),
    sessionStore: (inner) => faultySessionStore(inner, faults),
  },
  redirectSystemPath(path) {
    const link = parseTestLink(path);
    if (link === null) return path;
    inbox.receive(link);
    return '/';
  },
  Host,
};
