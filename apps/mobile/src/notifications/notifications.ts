import type { NotificationChannel, NotificationPermission, NotificationPort, ReceivedNotification } from './port';

// Mitteilungen der App (Spezifikation 5, Abschnitt 8): legt beim Start die Android-Kanäle an und das
// Vordergrundverhalten fest und hält die Erlaubnis beobachtbar. Jede Erlaubnisanfrage wartet auf die
// Kanäle, denn unter Android 13 erscheint der Systemdialog erst, wenn ein Kanal existiert
// (https://docs.expo.dev/versions/v58.0.0/sdk/notifications/). Erklär-Bildschirm, Onboarding-Schritt
// und Einstellungen sprechen nur mit diesem Modul.

/** Die beiden Kanäle, beide mit Standard-Wichtigkeit; die Person kann jeden einzeln stummschalten. */
export const notificationChannels: readonly NotificationChannel[] = [
  { key: 'checkins', name: 'Tages-Check-ins' },
  { key: 'partner_momo', name: 'Partner & Momo' },
];

export type Notifications = Readonly<{
  /** Zuletzt gelesene Erlaubnis; `null`, bis sie gelesen ist. */
  permission(): NotificationPermission | null;
  subscribe(listener: () => void): () => void;
  /** Liest die Erlaubnis neu, etwa bei der Rückkehr aus den System-Einstellungen. */
  refresh(): Promise<void>;
  /** Öffnet den Systemdialog; nur nach „Erlauben“ der Person. Ein Fehler zählt als unverändert. */
  request(): Promise<NotificationPermission | null>;
  /** App-Einstellungen des Systems. */
  openSettings(): Promise<void>;
}>;

export type NotificationsOptions = Readonly<{
  port: NotificationPort;
  /** Bei offener App eingetroffen; Banner gibt es dann nicht. */
  onForegroundNotification?: (notification: ReceivedNotification) => void;
  onError(error: unknown): void;
}>;

export function createNotifications({ port, onForegroundNotification = () => {}, onError }: NotificationsOptions): Notifications {
  let permission: NotificationPermission | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: NotificationPermission) => {
    if (next === permission) return;
    permission = next;
    for (const listener of listeners) listener();
  };

  port.setForegroundBehavior(onForegroundNotification);
  // Vor jeder Erlaubnisanfrage; scheitert das Anlegen, fragt die App trotzdem (der Fehler geht an `onError`).
  const channelsReady = port.createChannels(notificationChannels).catch(onError);

  async function refresh() {
    try {
      publish(await port.permission());
    } catch (error) {
      onError(error);
    }
  }
  void refresh();

  return {
    permission: () => permission,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    async request() {
      await channelsReady;
      try {
        publish(await port.requestPermission());
      } catch (error) {
        onError(error);
        await refresh();
      }
      return permission;
    },
    async openSettings() {
      try {
        await port.openSettings();
      } catch (error) {
        onError(error);
      }
    },
  };
}
