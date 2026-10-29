/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { Stack } from 'expo-router';
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
import { ClockProvider } from '../clock/clock-context';
import { MessageHostProvider } from '../shell/MessageHost';
import { AccountProvider } from './AccountProvider';
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
  const Layout = () => (
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <AccountProvider ports={world.ports}>
          <Stack screenOptions={{ headerShown: false }} />
        </AccountProvider>
      </MessageHostProvider>
    </ClockProvider>
  );
  await renderRouter({ _layout: Layout, ...routes }, { initialUrl: '/settings' });
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

  await act(async () => world.ports.profile.rename('Philipp D.'));

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

test.each([
  ['Ziele', '/settings/goals', 'Ziele', 'Kommt mit: Ziele & Onboarding'],
  ['Wochenplan', '/settings/weekly_plan', 'Wochenplan', 'Kommt mit: Ziele & Onboarding'],
  ['Partner & Freigaben', '/settings/partner_sharing', 'Partner & Freigaben', 'Kommt mit: Partner & Benachrichtigungen'],
  ['Benachrichtigungen', '/settings/notifications', 'Benachrichtigungen', 'Kommt mit: Partner & Benachrichtigungen'],
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

test('„Konto“ öffnet die fertige Seite statt eines Platzhalters', async () => {
  await openOverview();

  await user.press(screen.getByRole('button', { name: 'Konto' }));

  expect(screen).toHavePathname('/settings/account');
  expect(await screen.findByRole('header', { name: 'Konto' })).toBeOnTheScreen();
  expect(screen.queryByText('Dieser Bereich ist noch in Arbeit.')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Abmelden' })).toBeOnTheScreen();
});
