import type { Instant } from '@abnehm/contracts/base';
import type { NotificationPermission } from '@abnehm/contracts/notifications';

// Mitteilungs-Port (Spezifikation 5, Abschnitt 8): die einzige Stelle mit Zugriff auf
// `expo-notifications` und die System-Einstellungen. Auf dem Gerät setzt ihn `expo-port.ts` um, in
// Tests der speicherbasierte Fake der Testfähigkeit `mitteilungen` (`test-capabilities/notifications.ts`).

export type { NotificationPermission };

/** Android-Kanäle; auf iOS gibt es keine. */
export type NotificationChannelKey = 'checkins' | 'partner_momo';

export type NotificationChannel = Readonly<{ key: NotificationChannelKey; name: string }>;

/** Nutzdaten einer Benachrichtigung, etwa `intentId` und Routenziel eines Server-Pushes. */
export type NotificationData = Readonly<Record<string, unknown>>;

/** Eine lokale Benachrichtigung zu einem festen Zeitpunkt (Datums-Trigger samt Kanal). */
export type LocalNotification = Readonly<{
  /** Deterministischer Identifikator, etwa `checkin:2026-10-14:abend`. */
  id: string;
  at: Instant;
  channel: NotificationChannelKey;
  title: string;
  body: string;
  data: NotificationData;
}>;

/** Eine geplante lokale Benachrichtigung, wie das System sie meldet. */
export type ScheduledNotification = Readonly<{ id: string; data: NotificationData }>;

/** Die Person hat eine Benachrichtigung angetippt. */
export type NotificationResponse = Readonly<{ notificationId: string; data: NotificationData }>;

/** Eine Benachrichtigung ist bei offener App eingetroffen. */
export type ReceivedNotification = Readonly<{ notificationId: string; data: NotificationData }>;

export type NotificationPort = Readonly<{
  /** Erlaubnis lesen, ohne zu fragen. */
  permission(): Promise<NotificationPermission>;
  /** Öffnet den Systemdialog, sofern das System noch fragen darf, und liefert die Antwort. iOS ohne vorläufige Erlaubnis. */
  requestPermission(): Promise<NotificationPermission>;
  /** Öffnet die Seite dieser App in den System-Einstellungen. */
  openSettings(): Promise<void>;
  /** Legt Android-Kanäle mit Standard-Wichtigkeit an oder aktualisiert ihren Namen; auf iOS ohne Wirkung. */
  createChannels(channels: readonly NotificationChannel[]): Promise<void>;
  schedule(notification: LocalNotification): Promise<void>;
  cancel(id: string): Promise<void>;
  scheduled(): Promise<readonly ScheduledNotification[]>;
  /** Expo-Push-Token dieses Geräts; braucht Netz und scheitert ohne. */
  expoPushToken(): Promise<string>;
  /** Antippen bei laufender App; die Rückgabe meldet ab. */
  onResponse(listener: (response: NotificationResponse) => void): () => void;
  /** Das Antippen, mit dem die App gestartet wurde, sonst `null`. */
  lastResponse(): Promise<NotificationResponse | null>;
  /**
   * Vordergrundverhalten: Bei offener App erscheint keine Benachrichtigung als Banner, in der Liste,
   * mit Ton oder Badge. `onReceived` erfährt davon, etwa um einen Pull zu starten.
   */
  setForegroundBehavior(onReceived: (notification: ReceivedNotification) => void): void;
}>;
