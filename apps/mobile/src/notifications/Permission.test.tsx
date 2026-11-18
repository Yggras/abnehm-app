/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import type { NotificationPermission } from '@abnehm/contracts/notifications';

import NotificationPermissionRoute from '../app/notifications/permission';
import SettingsOverview from '../app/settings/index';
import SettingsNotifications from '../app/settings/notifications';
import { createAccountWorld, type AccountWorld } from '../settings/testing/account-world';

// Erklär-Bildschirm `notifications.permission` und Systemstatus der Seite „Benachrichtigungen“ (#125;
// Spezifikation 5, Abschnitte 6 und 8) mit den echten Routendateien und dem Fake-Mitteilungs-Port.

const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const user = userEvent.setup();
const explanation = 'Momo meldet sich höchstens zweimal am Tag – und nur, wenn noch etwas offen ist. Dein Partner kann dich anfeuern.';
let world: AccountWorld;

afterEach(() => {
  world.cleanup();
  expect(world.errors).toEqual([]);
});

const routes = {
  'settings/index': SettingsOverview,
  'settings/notifications': SettingsNotifications,
  'notifications/permission': NotificationPermissionRoute,
};

async function open(permission: NotificationPermission, initialUrl: string) {
  world = await createAccountWorld({ clock, notificationPermission: permission });
  await renderRouter({ _layout: world.Layout, ...routes }, { initialUrl });
  // Die Erlaubnis ist gelesen, sobald der Ladezustand weicht.
  await act(async () => {});
}

/** Öffnet die Seite „Benachrichtigungen“ und von dort den Erklär-Bildschirm, wie es die Person tut. */
async function openExplanationFromSettings() {
  await open('undetermined', '/settings/notifications');
  await user.press(screen.getByRole('button', { name: 'Erlauben' }));
  expect(screen).toHavePathname('/notifications/permission');
}

describe('Systemstatus auf der Seite „Benachrichtigungen“', () => {
  test('erlaubt: „Mitteilungen sind erlaubt“, ohne Aktion', async () => {
    await open('granted', '/settings/notifications');
    expect(screen.getByText('Mitteilungen sind erlaubt')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Erlauben' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'In den Systemeinstellungen erlauben' })).not.toBeOnTheScreen();
  });

  test('unentschieden: „Erlauben“ öffnet den Erklär-Bildschirm, nicht den Systemdialog', async () => {
    await openExplanationFromSettings();
    expect(world.notificationPort.systemDialogs()).toBe(0);
    expect(screen.getByText(explanation)).toBeOnTheScreen();
  });

  test('verweigert: „In den Systemeinstellungen erlauben“ öffnet die App-Einstellungen über den Port', async () => {
    await open('denied', '/settings/notifications');
    await user.press(screen.getByRole('button', { name: 'In den Systemeinstellungen erlauben' }));
    expect(world.notificationPort.settingsOpened()).toBe(1);
    expect(world.notificationPort.systemDialogs()).toBe(0);
  });

  test('folgt einer Änderung in den Systemeinstellungen, sobald die App sie neu liest', async () => {
    await open('denied', '/settings/notifications');
    world.notificationPort.setPermission('granted');
    await act(() => world.notifications.refresh());
    expect(screen.getByText('Mitteilungen sind erlaubt')).toBeOnTheScreen();
  });
});

describe('Übersicht', () => {
  test.each([
    ['undetermined', 'Benachrichtigungen Aus'],
    ['denied', 'Benachrichtigungen Aus'],
    ['granted', 'Benachrichtigungen'],
  ] as const)('Erlaubnis %s: Zeile „%s“', async (permission, name) => {
    await open(permission, '/settings');
    await screen.findByText('Philipp');
    expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    if (permission === 'granted') expect(screen.queryByText('Aus')).not.toBeOnTheScreen();
  });
});

describe('Erklär-Bildschirm `notifications.permission`', () => {
  test('zeigt den Erklärtext mit „Erlauben“ und „Später“', async () => {
    await openExplanationFromSettings();
    expect(screen.getByRole('header', { name: 'Benachrichtigungen' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Erlauben' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Später' })).toBeOnTheScreen();
  });

  test.each([
    ['granted', 'Mitteilungen sind erlaubt'],
    ['denied', 'In den Systemeinstellungen erlauben'],
  ] as const)('„Erlauben“ öffnet genau einmal den Systemdialog (Antwort %s) und kehrt zum Aufrufer zurück', async (answer, shownAfter) => {
    await openExplanationFromSettings();
    world.notificationPort.answerWith(answer);

    await user.press(screen.getByRole('button', { name: 'Erlauben' }));

    expect(world.notificationPort.systemDialogs()).toBe(1);
    expect(screen).toHavePathname('/settings/notifications');
    expect(screen.getByText(shownAfter)).toBeOnTheScreen();
  });

  test('„Später“ kehrt ohne Systemdialog zurück, und die App fragt danach nicht von sich aus', async () => {
    await openExplanationFromSettings();

    await user.press(screen.getByRole('button', { name: 'Später' }));

    expect(screen).toHavePathname('/settings/notifications');
    expect(world.notificationPort.systemDialogs()).toBe(0);
    expect(world.notifications.permission()).toBe('undetermined');

    // Neues Lesen, etwa bei der Rückkehr in den Vordergrund, öffnet weder Dialog noch Erklärung.
    await act(() => world.notifications.refresh());
    expect(screen).toHavePathname('/settings/notifications');
    expect(screen.queryByText(explanation)).not.toBeOnTheScreen();
    expect(world.notificationPort.systemDialogs()).toBe(0);
    expect(world.notificationPort.calls().filter((call) => call === 'requestPermission')).toEqual([]);
  });

  test('„Fertig“ schließt wie „Später“ ohne Systemdialog', async () => {
    await openExplanationFromSettings();
    await user.press(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen).toHavePathname('/settings/notifications');
    expect(world.notificationPort.systemDialogs()).toBe(0);
  });

  test.each([
    ['granted', 'Mitteilungen sind erlaubt'],
    ['denied', 'Mitteilungen sind aus. Erlauben kannst du sie jederzeit in den Systemeinstellungen.'],
  ] as const)('bei schon entschiedener Erlaubnis (%s) zeigt er nur den Stand', async (permission, state) => {
    await open(permission, '/notifications/permission');
    expect(screen.getByText(explanation)).toBeOnTheScreen();
    expect(screen.getByText(state)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Erlauben' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Später' })).not.toBeOnTheScreen();
  });
});
