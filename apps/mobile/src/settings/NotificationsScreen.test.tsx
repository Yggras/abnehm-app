/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, fireEvent, screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { defaultNotificationSetting, notificationSettingId } from '@abnehm/contracts/notifications';

import SettingsNotifications from '../app/settings/notifications';
import { createAccountWorld, philipp, type AccountWorld } from './testing/account-world';

jest.mock('../design/native/DateTimePicker', () => jest.requireActual('../design/testing/text-date-time-picker'));

// Nachweis für #132: die Seite „Benachrichtigungen“ (Spezifikation 5, Abschnitt 6) mit der echten
// Routendatei, dem echten App-Modul der Benachrichtigungseinstellung über einer SQLite-Datei und dem
// Fake-Mitteilungs-Port. Der Uhrzeit-Picker ist im Test ein Textfeld mit dem gewählten Zeitpunkt; die
// Testuhr steht in Berlin am 14.10.2026 (Sommerzeit, UTC+2).

const clock = createTestClock({ instant: Instant.parse('2026-10-14T08:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const user = userEvent.setup();
const orderHint = 'Der Abend-Check-in muss nach dem Mittag-Check-in liegen';
let world: AccountWorld;

afterEach(() => {
  world.cleanup();
  expect(world.errors).toEqual([]);
});

/** Zeitpunkt einer Berliner Wanduhrzeit am 14.10.2026, wie ihn der Picker zeigt und liefert. */
const at = (time: string) => Instant.parse(new Date(Date.parse(`2026-10-14T${time}:00.000+02:00`)).toISOString());

async function open() {
  world = await createAccountWorld({ clock });
  await renderRouter({ _layout: world.Layout, 'settings/notifications': SettingsNotifications }, { initialUrl: '/settings/notifications' });
  await act(async () => {});
}

const toggle = (name: string) => screen.getByRole('switch', { name });
const picker = (name: string) => screen.getByLabelText(name);
const save = () => screen.getByRole('button', { name: 'Speichern' });
const pick = (name: string, time: string) => act(async () => fireEvent.changeText(picker(name), at(time)));

describe('Seite „Benachrichtigungen“', () => {
  test('zeigt ohne gespeicherte Einstellung den Standard: Mittag 13:00, Abend 19:00, alle Tracker, Partner-Pushes an', async () => {
    await open();

    for (const name of ['Mittags', 'Abends', 'Ernährung', 'Wasser', 'Sport', 'Gewicht', 'Partner-Pushes']) {
      expect(toggle(name)).toBeChecked();
    }
    expect(picker('Uhrzeit mittags')).toHaveDisplayValue(at('13:00'));
    expect(picker('Uhrzeit abends')).toHaveDisplayValue(at('19:00'));
    expect(save()).toBeDisabled();
    expect(world.notificationSettings()).toEqual([]);
  });

  test('zeigt die Abschnitte samt Untertitel der Partner-Pushes und dem Infotext', async () => {
    await open();

    expect(screen.getByRole('header', { name: 'Tages-Check-ins' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'In Check-ins berücksichtigen' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Partner' })).toBeOnTheScreen();
    expect(screen.getByText('Anfeuern, Challenge-Vorschläge, Insel-Meilensteine und gemeinsame Vorgänge')).toBeOnTheScreen();
    expect(screen.getByText('Keine Ruhezeiten und keine besonderen Wochenendzeiten.')).toBeOnTheScreen();
  });

  test('Philipp stellt den Abend auf 20:30 und nimmt Gewicht heraus: gespeichert mit deterministischer ID, samt Outbox und Meldung', async () => {
    await open();

    await pick('Uhrzeit abends', '20:30');
    await user.press(toggle('Gewicht'));
    expect(toggle('Gewicht')).not.toBeChecked();
    await user.press(save());

    const wish = { ...defaultNotificationSetting, eveningTime: '20:30', trackerGewicht: false };
    expect(world.notificationSettings()).toEqual([expect.objectContaining({ id: notificationSettingId(philipp.personId), personId: philipp.personId, ...wish })]);
    expect(world.outbox()).toEqual([expect.objectContaining({ entityType: 'notification_setting', entityId: notificationSettingId(philipp.personId) })]);
    expect(screen.getByText('Benachrichtigungen gespeichert')).toBeOnTheScreen();
    expect(save()).toBeDisabled();
    expect(picker('Uhrzeit abends')).toHaveDisplayValue(at('20:30'));
  });

  test('ein erneutes Öffnen der Seite zeigt den gespeicherten Stand', async () => {
    await open();
    await pick('Uhrzeit abends', '20:30');
    await user.press(toggle('Gewicht'));
    await user.press(save());

    await renderRouter({ _layout: world.Layout, 'settings/notifications': SettingsNotifications }, { initialUrl: '/settings/notifications' });
    await act(async () => {});

    expect(picker('Uhrzeit abends')).toHaveDisplayValue(at('20:30'));
    expect(toggle('Gewicht')).not.toBeChecked();
    expect(toggle('Wasser')).toBeChecked();
  });

  describe('Uhrzeit-Validierung', () => {
    test.each([
      ['Abend vor Mittag', 'Uhrzeit abends', '12:00'],
      ['Abend gleich Mittag', 'Uhrzeit abends', '13:00'],
      ['Mittag nach Abend', 'Uhrzeit mittags', '19:30'],
    ])('%s: „Speichern“ gesperrt mit Hinweis', async (_, name, time) => {
      await open();

      await pick(name, time);

      expect(screen.getByText(orderHint)).toBeOnTheScreen();
      expect(save()).toBeDisabled();
      await user.press(save());
      expect(world.notificationSettings()).toEqual([]);
    });

    test('gilt auch bei ausgeschaltetem Mittag, und eine passende Uhrzeit gibt „Speichern“ wieder frei', async () => {
      await open();
      await user.press(toggle('Mittags'));
      await pick('Uhrzeit abends', '12:00');
      expect(screen.getByText(orderHint)).toBeOnTheScreen();

      await pick('Uhrzeit mittags', '11:30');

      expect(screen.queryByText(orderHint)).not.toBeOnTheScreen();
      expect(save()).toBeEnabled();
      await user.press(save());
      expect(world.notificationSettings()).toEqual([
        expect.objectContaining({ middayEnabled: false, middayTime: '11:30', eveningEnabled: true, eveningTime: '12:00' }),
      ]);
    });

    test('übernimmt nur Stunde und Minute des gewählten Zeitpunkts', async () => {
      await open();
      await act(async () => fireEvent.changeText(picker('Uhrzeit mittags'), '2026-10-14T10:15:42.000Z'));
      await user.press(save());
      expect(world.notificationSettings()).toEqual([expect.objectContaining({ middayTime: '12:15' })]);
    });
  });

  test.each([
    ['Ernährung', 'trackerErnaehrung'],
    ['Wasser', 'trackerWasser'],
    ['Sport', 'trackerSport'],
    ['Gewicht', 'trackerGewicht'],
  ])('Tracker-Auswahl: %s herausnehmen und wieder aufnehmen', async (name, field) => {
    await open();

    await user.press(toggle(name));
    await user.press(save());
    expect(world.notificationSettings()).toEqual([expect.objectContaining({ ...defaultNotificationSetting, [field]: false })]);

    await user.press(toggle(name));
    await user.press(save());
    expect(world.notificationSettings()).toEqual([expect.objectContaining(defaultNotificationSetting)]);
  });

  test('Partner-Pushes ausschalten: alle Server-Pushes aus, Check-ins unverändert', async () => {
    await open();

    await user.press(toggle('Partner-Pushes'));
    await user.press(save());

    expect(world.notificationSettings()).toEqual([expect.objectContaining({ ...defaultNotificationSetting, partnerPushEnabled: false })]);
  });

  test('Abends ausschalten speichert nur den Schalter, die Uhrzeit bleibt', async () => {
    await open();

    await user.press(toggle('Abends'));
    await user.press(save());

    expect(world.notificationSettings()).toEqual([expect.objectContaining({ eveningEnabled: false, eveningTime: '19:00', middayEnabled: true })]);
  });

  test('folgt einem Stand aus dem Pull, solange nichts geändert ist', async () => {
    await open();

    await act(async () => {
      world.applyNotificationSetting({ ...defaultNotificationSetting, middayTime: '12:00', trackerSport: false });
    });

    expect(picker('Uhrzeit mittags')).toHaveDisplayValue(at('12:00'));
    expect(toggle('Sport')).not.toBeChecked();
  });
});
