/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter, testRouter } from 'expo-router/testing-library';
import { Platform } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import SettingsAccount from '../app/settings/account';
import SettingsGoals from '../app/settings/goals';
import SettingsHealth from '../app/settings/health';
import SettingsOverview from '../app/settings/index';
import SettingsNotifications from '../app/settings/notifications';
import SettingsPartnerSharing from '../app/settings/partner_sharing';
import SettingsWeeklyPlan from '../app/settings/weekly_plan';
import { createAccountWorld, philipp, type AccountWorld } from './testing/account-world';

// Einstellungen-Übersicht (#119, Spezifikation 5, Abschnitt 6) mit den echten Routendateien unter
// `src/app/settings/`: Gliederung und Reihenfolge, Kopf mit Anzeigename und E-Mail, und jede Zeile
// führt zu ihrer `section`. Seiten anderer Tickets zeigen dort den deutschen Platzhalter der Shell.

const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const user = userEvent.setup();
let world: AccountWorld;

beforeEach(async () => {
  world = await createAccountWorld({ clock });
});
afterEach(() => {
  world.cleanup();
  expect(world.errors).toEqual([]);
});

const routes = {
  'settings/index': SettingsOverview,
  'settings/goals': SettingsGoals,
  'settings/weekly_plan': SettingsWeeklyPlan,
  'settings/partner_sharing': SettingsPartnerSharing,
  'settings/notifications': SettingsNotifications,
  'settings/health': SettingsHealth,
  'settings/account': SettingsAccount,
};

async function openOverview() {
  await renderRouter({ _layout: world.Layout, ...routes }, { initialUrl: '/settings' });
  await screen.findByText(philipp.email);
}

test('gliedert nach „Dein Plan“, „Gemeinsam“ und „Daten & Konto“ in der Reihenfolge der Spezifikation', async () => {
  await openOverview();

  expect(screen.getAllByRole('header').map((header) => header.props.children)).toEqual([
    'Einstellungen',
    'Dein Plan',
    'Gemeinsam',
    'Daten & Konto',
  ]);
  expect(screen.getAllByRole('button').map((row) => within(row).queryAllByText(/.+/)[0]?.props.children).filter(Boolean)).toEqual([
    'Ziele',
    'Wochenplan',
    'Partner & Freigaben',
    'Benachrichtigungen',
    'Apple Health',
    'Konto',
  ]);
});

test('der Kopf zeigt Anzeigename und E-Mail und folgt einer Namensänderung', async () => {
  await openOverview();

  expect(screen.getByLabelText(`Philipp, ${philipp.email}`)).toBeOnTheScreen();

  await act(async () => world.ports.displayName.rename('Philipp D.'));

  expect(screen.getByText('Philipp D.')).toBeOnTheScreen();
  expect(screen.getByLabelText(`Philipp D., ${philipp.email}`)).toBeOnTheScreen();
});

test('heißt auf Android „Health Connect“', async () => {
  const os = Platform.OS;
  Platform.OS = 'android';
  try {
    await openOverview();
    expect(screen.getByRole('button', { name: 'Health Connect' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Apple Health' })).not.toBeOnTheScreen();
  } finally {
    Platform.OS = os;
  }
});

test('„Ziele“ öffnet die Seite des Plan-Moduls statt eines Platzhalters (#147)', async () => {
  await openOverview();

  await user.press(screen.getByRole('button', { name: 'Ziele' }));

  expect(screen).toHavePathname('/settings/goals');
  expect(await screen.findByRole('header', { name: 'Ziele' })).toBeOnTheScreen();
  expect(screen.queryByText('Dieser Bereich ist noch in Arbeit.')).not.toBeOnTheScreen();
  expect(screen.getByText('Die App gibt keine medizinische Beratung; alle Werte sind Schätzungen.')).toBeOnTheScreen();
  await act(() => testRouter.back());
  expect(screen).toHavePathname('/settings');
});

test.each([
  ['Wochenplan', '/settings/weekly_plan', 'Wochenplan', 'Kommt mit: Ziele & Onboarding'],
  ['Apple Health', '/settings/health', 'Gesundheitsdaten', 'Kommt mit: Wasser, Sport, Gewicht & Health'],
])('„%s“ öffnet %s mit deutschem Platzhalter, System-Zurück führt zur Übersicht', async (row, pathname, title, owner) => {
  await openOverview();

  await user.press(screen.getByRole('button', { name: row }));

  expect(screen).toHavePathname(pathname);
  expect(await screen.findByRole('header', { name: title })).toBeOnTheScreen();
  expect(screen.getByText('Dieser Bereich ist noch in Arbeit.')).toBeOnTheScreen();
  expect(screen.getByText(owner)).toBeOnTheScreen();
  await act(() => testRouter.back());
  expect(screen).toHavePathname('/settings');
});

test('„Partner & Freigaben“ öffnet die Seite statt eines Platzhalters (#129)', async () => {
  await openOverview();

  await user.press(screen.getByRole('button', { name: 'Partner & Freigaben' }));

  expect(screen).toHavePathname('/settings/partner_sharing');
  expect(await screen.findByRole('header', { name: 'Partner & Freigaben' })).toBeOnTheScreen();
  expect(screen.queryByText('Dieser Bereich ist noch in Arbeit.')).not.toBeOnTheScreen();
  await act(() => testRouter.back());
  expect(screen).toHavePathname('/settings');
});

test('„Benachrichtigungen“ öffnet die Seite mit dem Systemstatus statt eines Platzhalters (#125)', async () => {
  await openOverview();

  await user.press(screen.getByRole('button', { name: 'Benachrichtigungen' }));

  expect(screen).toHavePathname('/settings/notifications');
  expect(await screen.findByRole('header', { name: 'Benachrichtigungen' })).toBeOnTheScreen();
  expect(screen.queryByText('Dieser Bereich ist noch in Arbeit.')).not.toBeOnTheScreen();
  expect(screen.getByText('Mitteilungen sind erlaubt')).toBeOnTheScreen();
  await act(() => testRouter.back());
  expect(screen).toHavePathname('/settings');
});

test('„Konto“ öffnet die fertige Seite statt eines Platzhalters', async () => {
  await openOverview();

  await user.press(screen.getByRole('button', { name: 'Konto' }));

  expect(screen).toHavePathname('/settings/account');
  expect(await screen.findByRole('header', { name: 'Konto' })).toBeOnTheScreen();
  expect(screen.queryByText('Dieser Bereich ist noch in Arbeit.')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Abmelden' })).toBeOnTheScreen();
});
