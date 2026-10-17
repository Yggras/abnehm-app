import * as ExpoHaptics from 'expo-haptics';
import { AccessibilityInfo, Platform } from 'react-native';

import { deviceHaptics } from './device-haptics';
import type { HapticKind } from './haptics';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual<Record<string, unknown>>('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
}));

const impact = jest.mocked(ExpoHaptics.impactAsync);
const notification = jest.mocked(ExpoHaptics.notificationAsync);
const android = jest.mocked(ExpoHaptics.performAndroidHapticsAsync);

const kinds: HapticKind[] = ['tageszielerfuellung', 'tagesbonus', 'levelaufstieg'];

function nativeCalls() {
  return impact.mock.calls.length + notification.mock.calls.length + android.mock.calls.length;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe.each(['ios', 'android'] as const)('auf %s', (os) => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', os);
  });

  test.each(kinds)('löst für „%s“ genau eine native Haptik aus', (kind) => {
    deviceHaptics.feedback(kind);

    expect(nativeCalls()).toBe(1);
  });

  test('wiederholt nichts: jede Anforderung ergibt genau einen Aufruf', () => {
    deviceHaptics.feedback('tageszielerfuellung');
    deviceHaptics.feedback('tageszielerfuellung');
    deviceHaptics.feedback('levelaufstieg');

    expect(nativeCalls()).toBe(3);
  });
});

test('bleibt dezent: leichter Impuls für ein Tagesziel, Erfolgsmuster für Bonus und Levelaufstieg (iOS)', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');

  deviceHaptics.feedback('tageszielerfuellung');
  deviceHaptics.feedback('tagesbonus');
  deviceHaptics.feedback('levelaufstieg');

  expect(impact.mock.calls).toEqual([[ExpoHaptics.ImpactFeedbackStyle.Light]]);
  expect(notification.mock.calls).toEqual([
    [ExpoHaptics.NotificationFeedbackType.Success],
    [ExpoHaptics.NotificationFeedbackType.Success],
  ]);
});

test('nutzt auf Android die Haptik-Engine des Systems statt des Vibrationsmotors', () => {
  jest.replaceProperty(Platform, 'OS', 'android');

  deviceHaptics.feedback('tageszielerfuellung');
  deviceHaptics.feedback('levelaufstieg');

  expect(android.mock.calls).toEqual([
    [ExpoHaptics.AndroidHaptics.Context_Click],
    [ExpoHaptics.AndroidHaptics.Confirm],
  ]);
  expect(impact).not.toHaveBeenCalled();
});

test('reduzierte Bewegung verstärkt oder wiederholt die Haptik nicht', () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

  deviceHaptics.feedback('levelaufstieg');

  expect(notification.mock.calls).toEqual([[ExpoHaptics.NotificationFeedbackType.Success]]);
  expect(nativeCalls()).toBe(1);
});

test('ein Fehler der nativen Haptik bleibt folgenlos', async () => {
  jest.replaceProperty(Platform, 'OS', 'ios');
  impact.mockRejectedValueOnce(new Error('Taptic Engine nicht verfügbar'));

  expect(() => deviceHaptics.feedback('tageszielerfuellung')).not.toThrow();
  await Promise.resolve();
});
