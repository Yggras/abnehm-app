import type { NotificationPermission } from '@abnehm/contracts/notifications';

import type {
  LocalNotification,
  NotificationChannel,
  NotificationChannelKey,
  NotificationPort,
  NotificationResponse,
  ReceivedNotification,
} from '../notifications/port';

// Testfähigkeit `mitteilungen` (#125; Spezifikation 5, Abschnitt 8 und Testing Decisions): ein
// speicherbasierter Fake des Mitteilungs-Ports mit steuerbarer Erlaubnis und steuerbaren Fehlern.
// Jest-Tests nutzen ihn direkt. In Test-Artefakten liegt er hinter einem Umschalter vor dem echten Port:
// `abnehmapp-dev://mitteilungen?erlaubnis=unentschieden` stellt die App auf den Fake, `erlaubnis=system`
// zurück auf den echten Port; ein Seed stellt die Erlaubnis seiner Installation ein (Szenario `solo`:
// unentschieden). Im Produktions-Bundle fehlt das Modul (Release-Sperren).

export type NotificationOperation = Exclude<keyof NotificationPort, 'setForegroundBehavior'>;

export type FakeNotificationPortOptions = Readonly<{
  permission?: NotificationPermission;
  /** Antwort im Systemdialog; ohne Angabe „Erlauben“. */
  answer?: Exclude<NotificationPermission, 'undetermined'>;
  /** Push-Token des Geräts. */
  pushToken?: string;
}>;

export type FakeNotificationPort = NotificationPort &
  Readonly<{
    setPermission(permission: NotificationPermission): void;
    /** Antwort der Person im nächsten Systemdialog. */
    answerWith(answer: Exclude<NotificationPermission, 'undetermined'>): void;
    /** Jeder weitere Aufruf der Operation scheitert, bis `heal` sie wieder freigibt. */
    fail(operation: NotificationOperation, error?: Error): void;
    heal(operation?: NotificationOperation): void;
    /** Die Person tippt eine Benachrichtigung an. */
    respond(response: NotificationResponse, options?: { launch?: boolean }): void;
    /** Eine Benachrichtigung trifft bei offener App ein; liefert, ob sie als Banner erschiene. */
    receive(notification: ReceivedNotification): { banner: boolean };
    /** Wie oft der Systemdialog erschien bzw. die App-Einstellungen geöffnet wurden. */
    systemDialogs(): number;
    settingsOpened(): number;
    channels(): readonly NotificationChannel[];
    scheduledNotifications(): readonly LocalNotification[];
    /** Operationen in der Reihenfolge ihrer Aufrufe, etwa um „Kanäle vor der Anfrage“ zu prüfen. */
    calls(): readonly NotificationOperation[];
  }>;

export class FakeNotificationError extends Error {
  constructor(operation: NotificationOperation) {
    super(`Fake-Mitteilungs-Port: ${operation} gestellt gescheitert`);
    this.name = 'FakeNotificationError';
  }
}

export function createFakeNotificationPort(options: FakeNotificationPortOptions = {}): FakeNotificationPort {
  let permission: NotificationPermission = options.permission ?? 'undetermined';
  let answer = options.answer ?? 'granted';
  let dialogs = 0;
  let settings = 0;
  let last: NotificationResponse | null = null;
  let onReceived: ((notification: ReceivedNotification) => void) | null = null;
  const failures = new Map<NotificationOperation, Error>();
  const channels = new Map<NotificationChannelKey, NotificationChannel>();
  const scheduled = new Map<string, LocalNotification>();
  const responseListeners = new Set<(response: NotificationResponse) => void>();
  const calls: NotificationOperation[] = [];

  async function call<T>(operation: NotificationOperation, run: () => T): Promise<T> {
    calls.push(operation);
    const failure = failures.get(operation);
    if (failure !== undefined) throw failure;
    return run();
  }

  return {
    permission: () => call('permission', () => permission),
    requestPermission: () =>
      call('requestPermission', () => {
        // Wie das System: gefragt wird nur, solange nichts entschieden ist.
        if (permission === 'undetermined') {
          dialogs += 1;
          permission = answer;
        }
        return permission;
      }),
    openSettings: () =>
      call('openSettings', () => {
        settings += 1;
      }),
    createChannels: (next) =>
      call('createChannels', () => {
        for (const channel of next) channels.set(channel.key, channel);
      }),
    schedule: (notification) =>
      call('schedule', () => {
        scheduled.set(notification.id, notification);
      }),
    cancel: (id) =>
      call('cancel', () => {
        scheduled.delete(id);
      }),
    scheduled: () => call('scheduled', () => [...scheduled.values()].map(({ id, data }) => ({ id, data }))),
    expoPushToken: () => call('expoPushToken', () => options.pushToken ?? 'ExponentPushToken[fake-mitteilungen]'),
    onResponse(listener) {
      calls.push('onResponse');
      responseListeners.add(listener);
      return () => responseListeners.delete(listener);
    },
    lastResponse: () => call('lastResponse', () => last),
    setForegroundBehavior(listener) {
      onReceived = listener;
    },

    setPermission(next) {
      permission = next;
    },
    answerWith(next) {
      answer = next;
    },
    fail(operation, error = new FakeNotificationError(operation)) {
      failures.set(operation, error);
    },
    heal(operation) {
      if (operation === undefined) failures.clear();
      else failures.delete(operation);
    },
    respond(response, { launch = false } = {}) {
      last = response;
      if (!launch) for (const listener of responseListeners) listener(response);
    },
    receive(notification) {
      onReceived?.(notification);
      // Ohne festgelegtes Verhalten zeigte das System einen Banner.
      return { banner: onReceived === null };
    },
    systemDialogs: () => dialogs,
    settingsOpened: () => settings,
    channels: () => [...channels.values()],
    scheduledNotifications: () => [...scheduled.values()],
    calls: () => [...calls],
  };
}

/** Wohin der Mitteilungs-Port eines Test-Artefakts gerade spricht. */
export type NotificationTestMode = Readonly<{ type: 'system' } | { type: 'fake'; permission: NotificationPermission; answer: Exclude<NotificationPermission, 'undetermined'> }>;

export type NotificationTestControl = Readonly<{
  /** Der Port der App: vor dem echten Port, umschaltbar auf den Fake. */
  port(system: NotificationPort): NotificationPort;
  /** Stellt die App auf den Fake mit dieser Erlaubnis bzw. mit `null` zurück auf den echten Port. */
  simulate(permission: NotificationPermission | null, answer?: Exclude<NotificationPermission, 'undetermined'>): void;
  mode(): NotificationTestMode;
  /** Nach jedem Umschalten; die App liest dann die Erlaubnis neu. */
  subscribe(listener: () => void): () => void;
}>;

/**
 * Umschalter der Test-Artefakte. Kanäle und Vordergrundverhalten gelten für beide Ports: Der echte
 * bekommt sie immer, damit auch nach dem Zurückschalten nichts fehlt.
 */
export function createNotificationTestControl(): NotificationTestControl {
  let fake: FakeNotificationPort | null = null;
  let current: NotificationTestMode = { type: 'system' };
  const listeners = new Set<() => void>();
  let foreground: ((notification: ReceivedNotification) => void) | null = null;

  return {
    port(system) {
      const active = (): NotificationPort => fake ?? system;
      return {
        permission: () => active().permission(),
        requestPermission: () => active().requestPermission(),
        openSettings: () => active().openSettings(),
        createChannels: (channels) => system.createChannels(channels),
        schedule: (notification) => active().schedule(notification),
        cancel: (id) => active().cancel(id),
        scheduled: () => active().scheduled(),
        expoPushToken: () => active().expoPushToken(),
        onResponse: (listener) => system.onResponse(listener),
        lastResponse: () => system.lastResponse(),
        setForegroundBehavior(listener) {
          foreground = listener;
          system.setForegroundBehavior(listener);
        },
      };
    },
    simulate(permission, answer = 'granted') {
      if (permission === null) {
        fake = null;
        current = { type: 'system' };
      } else {
        fake = createFakeNotificationPort({ permission, answer });
        if (foreground !== null) fake.setForegroundBehavior(foreground);
        current = { type: 'fake', permission, answer };
      }
      for (const listener of listeners) listener();
    },
    mode: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
