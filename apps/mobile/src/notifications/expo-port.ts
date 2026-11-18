import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Linking } from 'react-native';

import type { NotificationData, NotificationPort, NotificationResponse } from './port';

// Mitteilungs-Port auf dem Gerät (Spezifikation 5, Abschnitt 8) über `expo-notifications`
// (https://docs.expo.dev/versions/v58.0.0/sdk/notifications/). Lint erlaubt das Paket nur hier
// (`abnehm/bibliotheksgrenzen`).

const dataOf = (data: unknown): NotificationData => (typeof data === 'object' && data !== null ? (data as NotificationData) : {});

const responseOf = (response: Notifications.NotificationResponse): NotificationResponse => ({
  notificationId: response.notification.request.identifier,
  data: dataOf(response.notification.request.content.data),
});

export const expoNotificationPort: NotificationPort = {
  async permission() {
    return (await Notifications.getPermissionsAsync()).status;
  },
  async requestPermission() {
    // Ausdrücklich ohne `allowProvisional`: Eine vorläufige Erlaubnis legte Check-ins nur still in die
    // Mitteilungszentrale (Spezifikation 5, Abschnitt 8). Badges nutzt die App nicht.
    return (await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true } })).status;
  },
  openSettings: () => Linking.openSettings(),
  async createChannels(channels) {
    // Auf iOS ohne Wirkung; unter Android 13 erscheint der Erlaubnisdialog erst, wenn ein Kanal existiert.
    for (const channel of channels) {
      await Notifications.setNotificationChannelAsync(channel.key, { name: channel.name, importance: AndroidImportance.DEFAULT });
    }
  },
  async schedule(notification) {
    await Notifications.scheduleNotificationAsync({
      identifier: notification.id,
      content: {
        title: notification.title,
        body: notification.body,
        data: { ...notification.data },
        // Nie Time Sensitive (Apple HIG: Managing notifications).
        interruptionLevel: 'active',
      },
      // `bestEffort` ist der Standard; `alarmClock` bräuchte eine Exact-Alarm-Berechtigung, die die App nicht hat.
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: Date.parse(notification.at), channelId: notification.channel },
    });
  },
  cancel: (id) => Notifications.cancelScheduledNotificationAsync(id),
  async scheduled() {
    const requests = await Notifications.getAllScheduledNotificationsAsync();
    return requests.map((request) => ({ id: request.identifier, data: dataOf(request.content.data) }));
  },
  async expoPushToken() {
    // Ohne `projectId` lehnt Expo mit `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` ab.
    const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
    return (await Notifications.getExpoPushTokenAsync(projectId === undefined ? {} : { projectId })).data;
  },
  onResponse(listener) {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => listener(responseOf(response)));
    return () => subscription.remove();
  },
  async lastResponse() {
    const response = await Notifications.getLastNotificationResponseAsync();
    return response === null ? null : responseOf(response);
  },
  setForegroundBehavior(onReceived) {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        onReceived({ notificationId: notification.request.identifier, data: dataOf(notification.request.content.data) });
        return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false };
      },
    });
  },
};
