import { z } from 'zod';

import type { Clock } from '@abnehm/clock';
import { Instant } from '@abnehm/contracts/base';
import { ExpoPushToken, NotificationPermission, type PushPlatform, type RegisterPushInstallationRequest } from '@abnehm/contracts/notifications';
import type { InstallationId } from '@abnehm/contracts/sync';

import type { LocalDatabase } from '../local-db';
import { readDeviceState, writeDeviceState } from '../local-db/device-state';
import type { AppNotifications } from './notifications';
import type { NotificationPort } from './port';

// Registrierung der Push-Installation (Spezifikation 5, Abschnitt 9; #139). Nach erteilter Erlaubnis
// und bei jedem Start mit Erlaubnis meldet die App Installationskennung, Plattform, Expo-Push-Token und
// Erlaubnisstatus an; jede Registrierung bindet die aktuelle Sitzung an die Installation. Den Token holt
// sie über den Mitteilungs-Port; `getExpoPushTokenAsync` braucht Netz
// (https://docs.expo.dev/versions/v58.0.0/sdk/notifications/), Fehler wiederholt sie später. Ändert sich
// die Erlaubnis, etwa in den System-Einstellungen, meldet sie das beim Vordergrund nach: Dann liest das
// Mitteilungs-Modul die Erlaubnis neu, und diese Registrierung folgt ihm.

/** Ausgang einer Registrierung beim Server. */
export type PushRegistrationOutcome = 'ok' | 'failed' | 'unauthorized';

export type PushRegistrationTransport = Readonly<{ register(request: RegisterPushInstallationRequest): Promise<PushRegistrationOutcome> }>;

/** Erste Wartezeit vor einer Wiederholung; sie verdoppelt sich bis zur Obergrenze (Designwerte, nicht belegt). */
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;

/** Zuletzt beim Server gemeldeter Stand dieses Geräts, in `device_state` der Kontodatenbank. */
const REPORTED_KEY = 'push_installation_reported';
const reportedSchema = z.strictObject({ expoPushToken: ExpoPushToken, permission: NotificationPermission });
type Reported = z.infer<typeof reportedSchema>;

export type PushRegistrationOptions = Readonly<{
  database: LocalDatabase;
  clock: Clock;
  notifications: Pick<AppNotifications, 'permission' | 'subscribe'>;
  port: Pick<NotificationPort, 'expoPushToken'>;
  transport: PushRegistrationTransport;
  /** Dieselbe Kennung wie im Sync. */
  installationKey: InstallationId;
  platform: PushPlatform;
  /** Plant eine Wiederholung; die Rückgabe bricht sie ab. */
  retryAfter?: (delayMs: number, run: () => void) => () => void;
  onError(error: unknown): void;
}>;

const timerRetry = (delayMs: number, run: () => void) => {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
};

/** Startet die Registrierung für die geöffnete Kontodatenbank; die Rückgabe beendet sie, etwa beim Sperren. */
export function startPushRegistration({
  database,
  clock,
  notifications,
  port,
  transport,
  installationKey,
  platform,
  retryAfter = timerRetry,
  onError,
}: PushRegistrationOptions): () => void {
  let stopped = false;
  let running = false;
  /** Eine weitere Runde ist fällig, während eine läuft. */
  let again = false;
  /** Beim Start registriert sie mit Erlaubnis auch ohne Änderung, damit die aktuelle Sitzung an der Installation steht. */
  let startPending = true;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;

  function readReported(): Reported | null {
    return database.read((tx) => reportedSchema.safeParse(readDeviceState(tx, REPORTED_KEY)).data ?? null);
  }

  function writeReported(reported: Reported) {
    database.transaction((tx) => writeDeviceState(tx, REPORTED_KEY, reported, Instant.parse(clock.read().instant)));
  }

  /** Was jetzt zu melden ist, oder `null`. Ohne Erlaubnis meldet sie nur eine Änderung einer früheren Registrierung. */
  async function due(): Promise<Reported | null> {
    const permission = notifications.permission();
    if (permission === null) return null;
    const reported = readReported();
    if (permission === 'granted') {
      if (!startPending && reported?.permission === 'granted') return null;
      return { expoPushToken: ExpoPushToken.parse(await port.expoPushToken()), permission };
    }
    if (reported === null || reported.permission === permission) return null;
    return { expoPushToken: reported.expoPushToken, permission };
  }

  async function round(): Promise<'done' | 'waiting' | 'retry' | 'give_up'> {
    // Bis das Mitteilungs-Modul die Erlaubnis gelesen hat; es meldet sich dann selbst.
    if (notifications.permission() === null) return 'waiting';
    let next: Reported | null;
    try {
      next = await due();
    } catch (error) {
      onError(error);
      return 'retry';
    }
    if (next === null || stopped) return 'done';
    const outcome = await transport.register({ installationKey, platform, ...next });
    if (outcome === 'unauthorized') return 'give_up';
    if (outcome === 'failed') return 'retry';
    if (!stopped) writeReported(next);
    return 'done';
  }

  async function reconcile() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    cancelRetry?.();
    cancelRetry = null;
    try {
      do {
        again = false;
        const result = await round().catch((error: unknown) => {
          onError(error);
          return 'retry' as const;
        });
        if (stopped) return;
        if (result === 'retry') {
          const delay = Math.min(FIRST_RETRY_MS * 2 ** failures, MAX_RETRY_MS);
          failures += 1;
          cancelRetry = retryAfter(delay, () => void reconcile());
          return;
        }
        failures = 0;
        // Nach einer `401` sperrt das Auth-Modul die Fachoberfläche; die nächste Anmeldung startet neu.
        if (result !== 'waiting') startPending = false;
      } while (again);
    } finally {
      running = false;
    }
  }

  const unsubscribe = notifications.subscribe(() => void reconcile());
  void reconcile();

  return () => {
    stopped = true;
    unsubscribe();
    cancelRetry?.();
    cancelRetry = null;
  };
}
