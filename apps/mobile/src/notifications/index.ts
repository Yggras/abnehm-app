// Mitteilungen der App (Spezifikation 5, Abschnitt 8): Mitteilungs-Port, Kanäle, Erlaubnis und ihre
// Oberflächen (Erklär-Bildschirm, Onboarding-Schritt 10, Systemstatus der Einstellungen). Den echten
// Port (`expo-port.ts`, lädt `expo-notifications`) importiert nur der Composition Root.
export { createNotifications, notificationChannels, type AppNotifications, type NotificationsOptions } from './notifications';
export { NotificationsProvider, useNotificationPermission, useNotifications } from './NotificationsProvider';
export { NotificationsStep } from './NotificationsStep';
export { PermissionState } from './PermissionParts';
export { NotificationPermissionScreen } from './PermissionScreen';
export type * from './port';
export { notificationTexts } from './texts';
