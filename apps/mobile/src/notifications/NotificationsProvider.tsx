import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

import type { Notifications } from './notifications';
import type { NotificationPermission } from './port';

// Reicht das Mitteilungs-Modul an Erklär-Bildschirm, Onboarding-Schritt und Einstellungen. Auf dem
// Gerät setzt der Composition Root es zusammen (`deviceNotifications()`), in Tests über den Fake.

const Context = createContext<Notifications | null>(null);

export function NotificationsProvider({ notifications, children }: { notifications: Notifications; children: ReactNode }) {
  return <Context.Provider value={notifications}>{children}</Context.Provider>;
}

export function useNotifications(): Notifications {
  const notifications = useContext(Context);
  if (notifications === null) throw new Error('Mitteilungen brauchen den NotificationsProvider');
  return notifications;
}

/** Erlaubnis für Mitteilungen; `null`, bis sie gelesen ist. */
export function useNotificationPermission(): NotificationPermission | null {
  const notifications = useNotifications();
  return useSyncExternalStore(notifications.subscribe, notifications.permission);
}
