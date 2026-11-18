import { act, render, screen, userEvent } from '@testing-library/react-native';

import type { NotificationPermission } from '@abnehm/contracts/notifications';

import { OnboardingStep } from '../shell/OnboardingStep';
import { appOnboardingRegistry, createOnboardingRegistry } from '../shell/onboarding-registry';
import { createFakeNotificationPort, type FakeNotificationPort } from '../test-capabilities/notifications';
import { createNotifications } from './notifications';
import { NotificationsProvider } from './NotificationsProvider';
import { NotificationsStep } from './NotificationsStep';

// Onboarding-Schritt 10 `notifications` (#125; Spezifikation 5, Abschnitt 8) über den Steckplatz der
// Onboarding-Registry aus #110: Die Shell prüft jedes gemeldete Ergebnis gegen den Vertrag.

const user = userEvent.setup();
const explanation = 'Momo meldet sich höchstens zweimal am Tag – und nur, wenn noch etwas offen ist. Dein Partner kann dich anfeuern.';

async function renderStep(port: FakeNotificationPort) {
  const errors: unknown[] = [];
  const notifications = createNotifications({ port, onError: (error) => errors.push(error) });
  const registry = createOnboardingRegistry();
  registry.register('partner', 'notifications', NotificationsStep);
  const onComplete = jest.fn();
  await render(
    <NotificationsProvider notifications={notifications}>
      <OnboardingStep stepKey="notifications" onComplete={onComplete} registry={registry} />
    </NotificationsProvider>,
  );
  await act(async () => {});
  return { onComplete, errors };
}

test.each([
  ['granted', 'notifications_granted'],
  ['denied', 'notifications_denied'],
] as const)('unentschieden: derselbe Erklärtext, „Erlauben“ öffnet den Systemdialog; Antwort %s meldet %s', async (answer, outcome) => {
  const port = createFakeNotificationPort({ permission: 'undetermined', answer });
  const { onComplete } = await renderStep(port);

  expect(screen.getByText(explanation)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Später' })).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Erlauben' }));

  expect(port.systemDialogs()).toBe(1);
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith({ type: outcome });
});

test('scheitert der Systemdialog, ist nichts entschieden: der Schritt meldet `skipped`', async () => {
  const port = createFakeNotificationPort({ permission: 'undetermined' });
  port.fail('requestPermission');
  const { onComplete, errors } = await renderStep(port);

  await user.press(screen.getByRole('button', { name: 'Erlauben' }));

  expect(onComplete).toHaveBeenCalledWith({ type: 'skipped' });
  expect(errors).toHaveLength(1);
});

test.each([
  ['granted', 'Mitteilungen sind erlaubt', 'notifications_granted'],
  ['denied', 'Mitteilungen sind aus. Erlauben kannst du sie jederzeit in den Systemeinstellungen.', 'notifications_denied'],
] as const)('schon entschieden (%s): zeigt den Stand mit „Weiter“ und fragt nicht', async (permission, state, outcome) => {
  const port = createFakeNotificationPort({ permission: permission as NotificationPermission });
  const { onComplete } = await renderStep(port);

  expect(screen.getByText(state)).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Erlauben' })).not.toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Weiter' }));

  expect(port.systemDialogs()).toBe(0);
  expect(onComplete).toHaveBeenCalledWith({ type: outcome });
});

test('der Composition Root registriert den Schritt beim Start der App', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- der Import selbst ist die Registrierung
  require('../session/device-session');
  expect(appOnboardingRegistry.element('notifications', { complete: () => {} })?.type).toBe(NotificationsStep);
});
