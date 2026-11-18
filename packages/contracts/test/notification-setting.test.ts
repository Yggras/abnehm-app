import { describe, expect, it } from 'vitest';

import { EntityId } from '../src/base.ts';
import { checkInTrackers, defaultNotificationSetting, NotificationSettingUpsert, notificationSettingId } from '../src/notifications.ts';

// Nachweis für #132: Benachrichtigungseinstellung (Spezifikation 5, Abschnitt 10). Gültige und ungültige
// Fixtures prüft `fixtures.test.ts`; hier stehen Standardwerte, Schema-Regel und die deterministische ID.

const philipp = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const anna = EntityId.parse('7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f');

describe('Benachrichtigungseinstellung', () => {
  it('hat die Standardwerte der Spezifikation: Mittag an 13:00, Abend an 19:00, alle vier Tracker, Partner-Pushes an', () => {
    expect(NotificationSettingUpsert.parse(defaultNotificationSetting)).toEqual({
      middayEnabled: true,
      middayTime: '13:00',
      eveningEnabled: true,
      eveningTime: '19:00',
      trackerErnaehrung: true,
      trackerWasser: true,
      trackerSport: true,
      trackerGewicht: true,
      partnerPushEnabled: true,
    });
  });

  it.each([
    ['gleich', '13:00', '13:00'],
    ['früher', '13:00', '12:59'],
    ['Mitternacht nach Mittag', '13:00', '00:00'],
  ])('verlangt Abend nach Mittag: %s ist ungültig', (_, middayTime, eveningTime) => {
    const result = NotificationSettingUpsert.safeParse({ ...defaultNotificationSetting, middayTime, eveningTime });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['eveningTime'] })]);
  });

  it('prüft die Reihenfolge auch bei ausgeschaltetem Zeitpunkt, wie die Datenbank', () => {
    expect(NotificationSettingUpsert.safeParse({ ...defaultNotificationSetting, middayEnabled: false, eveningTime: '12:00' }).success).toBe(false);
  });

  it.each([
    ['00:00', '00:01'],
    ['09:05', '23:59'],
  ])('nimmt die Wanduhrzeiten %s und %s an', (middayTime, eveningTime) => {
    expect(NotificationSettingUpsert.safeParse({ ...defaultNotificationSetting, middayTime, eveningTime }).success).toBe(true);
  });

  it.each(['24:00', '9:05', '12:60', '12:00:00', ' 12:00', '١٢:٠٠'])('lehnt %j als Uhrzeit ab', (time) => {
    expect(NotificationSettingUpsert.safeParse({ ...defaultNotificationSetting, middayTime: time }).success).toBe(false);
  });

  it('nennt die Tracker der Check-ins in fester Reihenfolge Ernährung, Wasser, Sport, Gewicht', () => {
    expect(checkInTrackers(defaultNotificationSetting)).toEqual(['ernaehrung', 'wasser', 'sport', 'gewicht']);
    expect(checkInTrackers({ ...defaultNotificationSetting, trackerWasser: false, trackerGewicht: false })).toEqual(['ernaehrung', 'sport']);
  });
});

describe('notificationSettingId', () => {
  it('ist je Person deterministisch, eine gültige UUID und unterscheidet Personen', () => {
    expect(notificationSettingId(philipp)).toBe(notificationSettingId(philipp));
    expect(EntityId.safeParse(notificationSettingId(philipp)).success).toBe(true);
    expect(notificationSettingId(philipp)).not.toBe(notificationSettingId(anna));
    expect(notificationSettingId(philipp)).not.toBe(philipp);
  });
});
