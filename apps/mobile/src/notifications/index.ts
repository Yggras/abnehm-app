// Mitteilungen der App (Spezifikation 5, Abschnitt 8): Mitteilungs-Port, Kanäle, Erlaubnis und ihre
// Oberflächen (Erklär-Bildschirm, Onboarding-Schritt 10, Systemstatus der Einstellungen) und der
// Check-in-Planer (#135), dessen Auslöser #137 verdrahtet. Den echten
// Port (`expo-port.ts`, lädt `expo-notifications`) importiert nur der Composition Root.
export {
  checkInId,
  createCheckInPlanner,
  type CheckInPlanner,
  type CheckInPlannerOptions,
  type CheckInReconciliation,
  type CheckInRescheduleCause,
} from './check-in-planner';
export { createNotifications, notificationChannels, type AppNotifications, type NotificationsOptions } from './notifications';
export { NotificationsProvider, useNotificationPermission, useNotifications } from './NotificationsProvider';
export { NotificationsStep } from './NotificationsStep';
export { PermissionState } from './PermissionParts';
export { NotificationPermissionScreen } from './PermissionScreen';
export type * from './port';
export { notificationTexts } from './texts';
export { appNotificationSettings, useNotificationSettings, useSavedNotificationSetting } from './app-notification-settings';
export type { NotificationSettings, SaveNotificationSettingResult } from './notification-setting';
