import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { AppNotifications } from './notifications';
import type { NotificationPermission } from './port';

// Reicht das Mitteilungs-Modul an Erklär-Bildschirm, Onboarding-Schritt und Einstellungen. Auf dem
// Gerät setzt der Composition Root es zusammen (`deviceNotifications()`), in Tests über den Fake.

const Context = createContext<AppNotifications | null>(null);

export function NotificationsProvider({ notifications, children }: { notifications: AppNotifications; children: ReactNode }) {
  return <Context.Provider value={notifications}>{children}</Context.Provider>;
}

export function useNotifications(): AppNotifications {
  const notifications = useContext(Context);
  if (notifications === null) throw new Error('Mitteilungen brauchen den NotificationsProvider');
  return notifications;
}

/** Erlaubnis für Mitteilungen; `null`, bis sie gelesen ist. */
export function useNotificationPermission(): NotificationPermission | null {
  const notifications = useNotifications();
  return useSyncExternalStore(notifications.subscribe, notifications.permission);
}

/** Fragt über den Systemdialog; `asking` gilt, solange die Anfrage läuft. Liefert die Antwort wie `request`. */
export function usePermissionRequest(): Readonly<{ asking: boolean; request(): Promise<NotificationPermission | null> }> {
  const notifications = useNotifications();
  const [asking, setAsking] = useState(false);
  const request = async () => {
    setAsking(true);
    try {
      return await notifications.request();
    } finally {
      setAsking(false);
    }
  };
  return { asking, request };
}
