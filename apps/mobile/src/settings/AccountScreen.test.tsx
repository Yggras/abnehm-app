/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import SettingsAccount from '../app/settings/account';
import SettingsOverview from '../app/settings/index';
import { ClockProvider } from '../clock/clock-context';
import { MessageHostProvider } from '../shell/MessageHost';
import { AccountProvider } from './AccountProvider';
import { createAccountWorld, philipp, type AccountWorld } from './testing/account-world';

// „Konto“ (#119, Spezifikation 5, Abschnitt 6) am gerenderten Bildschirm mit den Test-Adaptern des
// Fundaments: echtes Auth- und Abmeldemodul über dem Online-Test-Adapter des Auth-Moduls, davor der
// Fehler-Adapter für fehlendes Netz, und der Anzeigename über einer echten SQLite-Datei.

jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

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

async function openAccount(ready = philipp.email) {
  const Layout = () => (
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <AccountProvider ports={world.ports}>
          <Stack screenOptions={{ headerShown: false }} />
        </AccountProvider>
      </MessageHostProvider>
    </ClockProvider>
  );
  await renderRouter({ _layout: Layout, 'settings/index': SettingsOverview, 'settings/account': SettingsAccount }, { initialUrl: '/settings/account' });
  await screen.findByText(ready);
}

const nameField = () => screen.getByLabelText('Anzeigename');

describe('E-Mail', () => {
  test('steht nur lesend da, kommt über das Auth-Modul und liegt auf dem Gerät nirgends', async () => {
    await openAccount();

    expect(screen.getByRole('header', { name: 'Konto' })).toBeOnTheScreen();
    expect(screen.getByText(philipp.email)).toBeOnTheScreen();
    expect(screen.queryByLabelText('E-Mail')).not.toBeOnTheScreen();
    expect(world.backend.calls).toContainEqual({ method: 'GET', path: '/v1/auth/get-session' });
    expect(world.storedText()).not.toContain(philipp.email);
  });

  test('bleibt ohne Netz sichtbar, wenn die App sie seit dem Start schon kennt', async () => {
    world.faults.set({ transport: 'offline' });
    await openAccount();

    expect(screen.getByText(philipp.email)).toBeOnTheScreen();
  });

  test('zeigt ohne Verbindung einen Hinweis, solange sie unbekannt ist', async () => {
    jest.spyOn(world.ports.auth, 'accountEmail').mockResolvedValue({ type: 'unreachable' });
    await openAccount('E-Mail ohne Verbindung nicht verfügbar');

    expect(screen.queryByText(philipp.email)).not.toBeOnTheScreen();
  });

  test('es gibt weder „E-Mail ändern“ noch „Konto löschen“ noch „Alle Sitzungen abmelden“', async () => {
    await openAccount();

    for (const absent of [/E-Mail ändern/, /Konto löschen/, /Alle Sitzungen/]) {
      expect(screen.queryByText(absent)).not.toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: absent })).not.toBeOnTheScreen();
    }
  });
});

describe('Anzeigename', () => {
  test('ändert sich lokal über den Person-Upsert mit Outbox, ohne die Zeitzone', async () => {
    await openAccount();
    expect(nameField()).toHaveDisplayValue('Philipp');

    await user.clear(nameField());
    await user.type(nameField(), '  Phil ');
    await user.press(screen.getByRole('button', { name: 'Namen speichern' }));

    expect(await screen.findByText('Name gespeichert')).toBeOnTheScreen();
    expect(world.person()).toMatchObject({ displayName: 'Phil', timeZone: 'Europe/Berlin' });
    const [operation, ...more] = world.outbox();
    expect(more).toEqual([]);
    expect(operation).toMatchObject({ type: 'upsert_entity', entityType: 'person', entityId: philipp.personId, payload: { displayName: 'Phil' } });
    expect(operation!.payload).not.toHaveProperty('timeZone');
    expect(screen.queryByRole('button', { name: 'Namen speichern' })).not.toBeOnTheScreen();
  });

  test.each([
    ['leer', '   '],
    ['zu lang', 'P'.repeat(31)],
  ])('lehnt einen Namen ab, der %s ist, und schreibt nichts', async (_case, name) => {
    await openAccount();

    await user.clear(nameField());
    await user.type(nameField(), name);
    await user.press(screen.getByRole('button', { name: 'Namen speichern' }));

    expect(screen.getByText('Dein Name braucht 1 bis 30 Zeichen.')).toBeOnTheScreen();
    expect(world.person()?.displayName).toBe('Philipp');
    expect(world.outbox()).toEqual([]);
  });

  test('übernimmt einen Namen, der per Pull kommt, solange nichts eingetippt ist', async () => {
    await openAccount();

    await act(async () => world.ports.profile.rename('Philipp D.'));

    expect(nameField()).toHaveDisplayValue('Philipp D.');
  });
});

describe('Passwort ändern', () => {
  async function changePassword(current: string, next: string) {
    await user.press(screen.getByRole('button', { name: 'Passwort ändern' }));
    const form = screen.getByTestId('passwort-formular');
    await user.type(within(form).getByLabelText('Aktuelles Passwort'), current);
    await user.type(within(form).getByLabelText('Neues Passwort'), next);
    await user.press(within(form).getByRole('button', { name: 'Neues Passwort speichern' }));
    return form;
  }

  test('ändert es online; danach sind die anderen Sitzungen widerrufen, dieses Gerät bleibt angemeldet', async () => {
    const otherDevice = world.backend.signInElsewhere();
    await openAccount();

    await changePassword(philipp.password, 'ganz-neue-passphrase');

    expect(await screen.findByText('Passwort geändert. Deine anderen Geräte sind abgemeldet.')).toBeOnTheScreen();
    expect(screen.queryByTestId('passwort-formular')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Passwort ändern' })).toBeOnTheScreen();
    expect(world.backend.password()).toBe('ganz-neue-passphrase');
    expect(world.backend.isValid(otherDevice)).toBe(false);
    expect(world.backend.isValid(world.sessionStore.value!.token!)).toBe(true);
    expect(world.auth.state()).toEqual({ type: 'angemeldet', accountId: philipp.accountId });
  });

  test.each<[string, () => void, string, string]>([
    ['falsches aktuelles Passwort', () => {}, 'falsches-passwort', 'Das aktuelle Passwort stimmt nicht. Versuch es noch einmal.'],
    ['verbreitetes Passwort', () => {}, philipp.password, 'Dieses Passwort ist zu verbreitet. Wähle ein anderes.'],
    ['zu viele Versuche', () => world.backend.answerOnce('/v1/auth/change-password', 429), philipp.password, 'Zu viele Versuche. Warte ein paar Minuten und versuch es dann noch einmal.'],
    ['ohne Netz', () => world.faults.set({ transport: 'offline' }), philipp.password, 'Passwort ändern braucht Internet. Versuch es mit Verbindung noch einmal.'],
    ['Serverfehler', () => world.faults.set({ server: 'unavailable' }), philipp.password, 'Passwort ändern braucht Internet. Versuch es mit Verbindung noch einmal.'],
  ])('%s: Fehler im Formular, das Passwort bleibt', async (_case, arrange, current, message) => {
    await openAccount();
    arrange();

    const form = await changePassword(current, _case === 'verbreitetes Passwort' ? 'iloveyou12' : 'ganz-neue-passphrase');

    expect(await within(form).findByText(message)).toBeOnTheScreen();
    expect(world.backend.password()).toBe(philipp.password);
    expect(world.auth.state()).toEqual({ type: 'angemeldet', accountId: philipp.accountId });
  });

  test('prüft die Mindestlänge vor dem Senden', async () => {
    await openAccount();

    const form = await changePassword(philipp.password, 'kurz-9-zz');

    expect(within(form).getByText('Das neue Passwort braucht mindestens 10 Zeichen.')).toBeOnTheScreen();
    expect(world.backend.calls.filter(({ path }) => path === '/v1/auth/change-password')).toEqual([]);
  });

  test('verlangt das aktuelle Passwort', async () => {
    await openAccount();

    const form = await changePassword('', 'ganz-neue-passphrase');

    expect(within(form).getByText('Gib dein aktuelles Passwort ein.')).toBeOnTheScreen();
    expect(world.backend.calls.filter(({ path }) => path === '/v1/auth/change-password')).toEqual([]);
  });

  test('nennt die Regeln und lässt sich abbrechen', async () => {
    await openAccount();
    await user.press(screen.getByRole('button', { name: 'Passwort ändern' }));

    expect(screen.getByText('Mindestens 10 Zeichen. Sehr häufige Passwörter nimmt die App nicht an.')).toBeOnTheScreen();
    await user.press(within(screen.getByTestId('passwort-formular')).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByTestId('passwort-formular')).not.toBeOnTheScreen();
  });
});

describe('Abmelden', () => {
  const logout = () => user.press(screen.getByRole('button', { name: 'Abmelden' }));

  test('online mit leerer Outbox: Server widerruft, die Kontodaten sind vom Gerät', async () => {
    await openAccount();

    await logout();

    await act(async () => {});
    expect(world.auth.state()).toEqual({ type: 'abgemeldet' });
    expect(world.backend.calls).toContainEqual({ method: 'POST', path: '/v1/session/logout' });
    expect(world.hasAccountData()).toBe(false);
    expect(world.sessionStore.value).toBeNull();
    expect(world.logoutStore.value).toBeNull();
  });

  test('mit ungesicherten Änderungen fragt es nach; „Angemeldet bleiben“ lässt alles, wie es ist', async () => {
    await openAccount();
    await act(async () => world.ports.profile.rename('Phil'));

    await logout();

    const sheet = await screen.findByTestId('sheet');
    expect(within(sheet).getByRole('header', { name: 'Noch nicht gesichert' })).toBeOnTheScreen();
    expect(within(sheet).getByText('Eine Änderung ist noch nicht auf dem Server. Wenn du dich jetzt abmeldest, geht sie verloren.')).toBeOnTheScreen();
    await user.press(within(sheet).getByRole('button', { name: 'Angemeldet bleiben' }));

    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
    expect(world.auth.state()).toEqual({ type: 'angemeldet', accountId: philipp.accountId });
    expect(world.outbox()).toHaveLength(1);
    expect(world.backend.calls).not.toContainEqual({ method: 'POST', path: '/v1/session/logout' });
  });

  test('mit ungesicherten Änderungen meldet „Trotzdem abmelden“ nach dem Verzicht ab', async () => {
    await openAccount();
    await act(async () => world.ports.profile.rename('Phil'));

    await logout();
    await user.press(within(await screen.findByTestId('sheet')).getByRole('button', { name: 'Trotzdem abmelden' }));

    await act(async () => {});
    expect(world.auth.state()).toEqual({ type: 'abgemeldet' });
    expect(world.hasAccountData()).toBe(false);
  });

  test('ohne Netz: Fehler, alles bleibt bestehen, keine Abmeldung wird behauptet', async () => {
    await openAccount();
    world.faults.set({ transport: 'offline' });

    await logout();

    expect(await screen.findByText('Abmelden braucht Internet. Versuch es mit Verbindung noch einmal; bis dahin bleibt alles auf diesem Gerät.')).toBeOnTheScreen();
    expect(screen.queryByText(/abgemeldet/)).not.toBeOnTheScreen();
    expect(world.auth.state()).toEqual({ type: 'angemeldet', accountId: philipp.accountId });
    expect(world.hasAccountData()).toBe(true);
    expect(world.logoutStore.value).toBeNull();
    expect(nameField()).toHaveDisplayValue('Philipp');
  });

  test('nach verlorener Antwort bietet „Konto“ an, die begonnene Abmeldung abzuschließen', async () => {
    await openAccount();
    world.faults.set({ transport: 'response_lost' });

    await logout();

    expect(await screen.findByText('Deine Abmeldung ist noch nicht abgeschlossen. Mit Internet kannst du sie beenden.')).toBeOnTheScreen();
    expect(world.auth.state()).toEqual({ type: 'angemeldet', accountId: philipp.accountId });
    expect(world.hasAccountData()).toBe(true);

    world.faults.reset();
    await user.press(screen.getByRole('button', { name: 'Abschließen' }));

    await act(async () => {});
    expect(world.auth.state()).toEqual({ type: 'abgemeldet' });
    expect(world.hasAccountData()).toBe(false);
  });
});
