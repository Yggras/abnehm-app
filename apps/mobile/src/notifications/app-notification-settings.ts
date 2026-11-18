import { useSyncExternalStore } from 'react';

import { defaultNotificationSetting, type NotificationSettingUpsert } from '@abnehm/contracts/notifications';

import { createOpenedModule, useOpenedModule } from '../shell/opened-module';
import type { NotificationSettings } from './notification-setting';

// Die Benachrichtigungseinstellung des geöffneten Kontos für die Seite „Benachrichtigungen“ (#132). Die
// App-Sitzung meldet sie an, sobald eine Kontodatenbank offen ist (`src/session/device-session.ts`), und
// löst sie beim Sperren wieder.

export const appNotificationSettings = createOpenedModule<NotificationSettings>();

const unsubscribed = () => () => {};
const defaults = () => defaultNotificationSetting;

/** Das Modul des geöffneten Kontos; `null`, solange keines offen ist. */
export function useNotificationSettings(): NotificationSettings | null {
  return useOpenedModule(appNotificationSettings);
}

/** Die gespeicherte Einstellung, sonst der Standard; folgt jeder Änderung, auch aus dem Pull. */
export function useSavedNotificationSetting(settings: NotificationSettings | null): NotificationSettingUpsert {
  return useSyncExternalStore(settings?.subscribe ?? unsubscribed, settings?.current ?? defaults);
}
