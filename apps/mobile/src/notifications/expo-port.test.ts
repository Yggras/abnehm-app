import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import { Instant } from '@abnehm/contracts/base';

import { expoNotificationPort } from './expo-port';

// Der echte Mitteilungs-Port (#125) an seiner Grenze zu expo-notifications: Die Attrappe aus
// `jest/setup.js` gilt hier nicht, dafür eine eigene des Pakets. Geprüft wird, was Spezifikation 5,
// Abschnitt 8 am Systemaufruf festlegt: iOS ohne vorläufige Erlaubnis, Kanäle mit
// Standard-Wichtigkeit, Stufe `active` und kein Banner im Vordergrund.

// `jest.unmock` und `jest.mock` hebt babel-jest über die Importe.
jest.unmock('./expo-port');
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 5 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  getAllScheduledNotificationsAsync: jest.fn(async () => [{ identifier: 'checkin:2026-10-14:abend', content: { data: { ziel: 'today' } } }]),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[x]' })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
}));


test('liest die Erlaubnis und fragt auf iOS ohne vorläufige Erlaubnis (provisional)', async () => {
  expect(await expoNotificationPort.permission()).toBe('undetermined');
  expect(await expoNotificationPort.requestPermission()).toBe('granted');

  const [request] = jest.mocked(Notifications.requestPermissionsAsync).mock.calls[0]!;
  expect(request?.ios?.allowProvisional).toBeUndefined();
  expect(request?.ios?.allowAlert).toBe(true);
});

test.each([
  ['undetermined', true, 'undetermined'],
  ['granted', true, 'granted'],
  // Android 13+ vor der ersten Frage und nach dem ersten „Nicht zulassen“: Das System würde noch fragen.
  ['denied', true, 'undetermined'],
  // iOS nach „Nicht erlauben“, Android nach dem zweiten „Nicht zulassen“ oder abgeschaltet in den Einstellungen.
  ['denied', false, 'denied'],
] as const)('Expo-Status %s mit canAskAgain %s ist die Erlaubnis %s', async (status, canAskAgain, expected) => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ status, canAskAgain } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({ status, canAskAgain } as Notifications.NotificationPermissionsStatus);
  expect(await expoNotificationPort.permission()).toBe(expected);
  expect(await expoNotificationPort.requestPermission()).toBe(expected);
});

test('legt jeden Kanal mit Standard-Wichtigkeit an', async () => {
  await expoNotificationPort.createChannels([
    { key: 'checkins', name: 'Tages-Check-ins' },
    { key: 'partner_momo', name: 'Partner & Momo' },
  ]);
  expect(jest.mocked(Notifications.setNotificationChannelAsync).mock.calls).toEqual([
    ['checkins', { name: 'Tages-Check-ins', importance: 5 }],
    ['partner_momo', { name: 'Partner & Momo', importance: 5 }],
  ]);
});

test('plant mit eigenem Identifikator, Datums-Trigger samt Kanal, Stufe `active` und ohne exakten Alarm', async () => {
  await expoNotificationPort.schedule({
    id: 'checkin:2026-10-14:abend',
    at: Instant.parse('2026-10-14T17:00:00.000Z'),
    channel: 'checkins',
    title: 'Momo fragt nach',
    body: 'Schon was gegessen?',
    data: { ziel: 'today' },
  });
  const [request] = jest.mocked(Notifications.scheduleNotificationAsync).mock.calls[0]!;
  expect(request).toEqual({
    identifier: 'checkin:2026-10-14:abend',
    content: { title: 'Momo fragt nach', body: 'Schon was gegessen?', data: { ziel: 'today' }, interruptionLevel: 'active' },
    trigger: { type: 'date', date: Date.parse('2026-10-14T17:00:00.000Z'), channelId: 'checkins' },
  });
  expect(await expoNotificationPort.scheduled()).toEqual([{ id: 'checkin:2026-10-14:abend', data: { ziel: 'today' } }]);
});

test('zeigt im Vordergrund weder Banner noch Listeneintrag, Ton oder Badge und meldet den Eingang', async () => {
  const received = jest.fn();
  expoNotificationPort.setForegroundBehavior(received);
  const [handler] = jest.mocked(Notifications.setNotificationHandler).mock.calls[0]!;
  const notification = { request: { identifier: 'push-1', content: { data: { intentId: 'i' } } } } as unknown as Notifications.Notification;

  expect(await handler!.handleNotification(notification)).toEqual({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false });
  expect(received).toHaveBeenCalledWith({ notificationId: 'push-1', data: { intentId: 'i' } });
});

test('öffnet die App-Einstellungen des Systems', async () => {
  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
  await expoNotificationPort.openSettings();
  expect(openSettings).toHaveBeenCalled();
});
