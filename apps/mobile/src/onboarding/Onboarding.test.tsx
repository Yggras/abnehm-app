/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type * as React from 'react';

import { createTestClock } from '@abnehm/clock/testing';
import { DisplayName, Instant, TimeZone } from '@abnehm/contracts/base';

import { hitArea } from '../design/testing/hit-area';
import { textScale } from '../design/tokens';
import type * as DeviceSession from '../session/device-session';
import { createOnboardingDevice, type OnboardingDevice } from './testing/harness';

// Onboarding-Schritte 1 und 2 und die Einrichtung des Kontos mit dem echten `src/app` (#138): Das
// Auth-Modul (#97) spricht den Fake-Server an, der Fehler-Adapter aus #112 schaltet das Netz ab. Die
// Sitzungs-Weiche folgt dem Auth-Modul und der Person in der echten Kontodatenbank, wie auf dem Gerät.

const appDir = 'src/app';
jest.setTimeout(30_000);

// Die Weiche und das Onboarding des Testgeräts statt der des Geräts.
let mockDevice: OnboardingDevice;
jest.mock('../session/use-session-gate', () => ({
  useSessionGate: () => {
    const { useSyncExternalStore } = jest.requireActual<typeof React>('react');
    return useSyncExternalStore(mockDevice.gate.subscribe, mockDevice.gate.get);
  },
}));
jest.mock('../session/device-session', () => ({
  ...jest.requireActual<typeof DeviceSession>('../session/device-session'),
  deviceOnboarding: () => mockDevice.onboarding,
}));

const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const anna = { email: 'anna@example.test', password: 'momo-insel-testpasswort', displayName: 'Anna' };
const user = userEvent.setup();

beforeEach(async () => {
  mockDevice = createOnboardingDevice(clock);
  // Wie beim Start: Das Auth-Modul prüft die gespeicherte Sitzung; ohne eine steht die Weiche auf `ohne_sitzung`.
  await mockDevice.session.auth.checkSession();
});
afterEach(() => mockDevice.cleanup());

async function openApp() {
  await renderRouter(appDir, { initialUrl: '/' });
  await screen.findByRole('header', { name: 'Schön, dass du da bist' });
}

async function toAccountStep() {
  await user.press(screen.getByRole('checkbox', { name: /^Verstanden/ }));
  await user.press(screen.getByRole('button', { name: 'Weiter' }));
  await screen.findByRole('header', { name: 'Konto anlegen' });
}

async function fill(label: string, value: string) {
  await user.type(screen.getByLabelText(label), value);
}

/** Wartet, bis die Weiche nach der Einrichtung des Kontos im Onboarding bei Schritt 3 steht. */
async function expectStepThree() {
  expect(await screen.findByRole('header', { name: 'Körperdaten' })).toBeOnTheScreen();
  expect(screen).toHavePathname('/onboarding');
  expect(screen.getByRole('progressbar', { name: 'Fortschritt der Einrichtung' })).toHaveAccessibilityValue({ text: 'Schritt 3 von 11' });
}

describe('Schritt 1 „Willkommen“', () => {
  it('zeigt Momo als Laichkugel, den Hinweis und „Schritt 1 von 11“, ohne Netz', async () => {
    mockDevice.faults.set({ transport: 'offline' });
    await openApp();

    expect(screen).toHavePathname('/sitzung');
    expect(screen.getByRole('image', { name: 'Momo wartet im Ei' })).toBeOnTheScreen();
    expect(screen.getByText('Die App gibt keine medizinische Beratung; alle Werte sind Schätzungen.')).toBeOnTheScreen();
    expect(screen.getByRole('progressbar', { name: 'Fortschritt der Einrichtung' })).toHaveAccessibilityValue({ text: 'Schritt 1 von 11' });
    expect(screen.queryByRole('button', { name: 'Zurück' })).toBeNull();
    expect(mockDevice.server.calls()).toEqual([]);
  });

  it('geht ohne Bestätigung nicht weiter', async () => {
    await openApp();

    const next = screen.getByRole('button', { name: 'Weiter' });
    expect(next).toBeDisabled();
    expect(screen.getByText('Bestätige den Hinweis, um weiterzumachen.')).toBeOnTheScreen();
    await user.press(next);
    expect(screen.getByRole('header', { name: 'Schön, dass du da bist' })).toBeOnTheScreen();

    await user.press(screen.getByRole('checkbox', { name: /^Verstanden/ }));
    expect(screen.getByRole('checkbox', { name: /^Verstanden/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled();
  });

  it('Reihenfolge: Weiter führt zu Schritt 2, Zurück zu Schritt 1 mit erhaltener Bestätigung', async () => {
    await openApp();
    await toAccountStep();
    expect(screen.getByRole('progressbar', { name: 'Fortschritt der Einrichtung' })).toHaveAccessibilityValue({ text: 'Schritt 2 von 11' });

    await user.press(screen.getByRole('button', { name: 'Zurück' }));

    expect(await screen.findByRole('header', { name: 'Schön, dass du da bist' })).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: /^Verstanden/ })).toBeChecked();
  });
});

describe('Schritt 2 „Konto“', () => {
  it('Registrierpfad: legt Konto und Person an, setzt die Bestätigung und steht danach bei Schritt 3', async () => {
    await openApp();
    await toAccountStep();

    await fill('E-Mail-Adresse', anna.email);
    await fill('Passwort', anna.password);
    await fill('Anzeigename', anna.displayName);
    await user.press(screen.getByRole('button', { name: 'Konto anlegen' }));

    await expectStepThree();
    expect(mockDevice.ownPerson()).toEqual(
      expect.objectContaining({ displayName: 'Anna', onboardingStatus: 'begonnen', disclaimerAcceptedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) }),
    );
    expect(mockDevice.outbox()).toEqual([
      expect.objectContaining({ entityType: 'person', payload: expect.objectContaining({ disclaimerAcceptedAt: mockDevice.ownPerson()!.disclaimerAcceptedAt }) }),
    ]);
  });

  it('Anmeldepfad: „Ich habe schon ein Konto“ meldet an und führt mit bestätigtem Hinweis zu Schritt 3', async () => {
    await mockDevice.addAccount(anna);
    await openApp();
    await toAccountStep();

    await user.press(screen.getByRole('button', { name: 'Ich habe schon ein Konto' }));
    expect(await screen.findByRole('header', { name: 'Anmelden' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Anzeigename')).toBeNull();
    await fill('E-Mail-Adresse', anna.email);
    await fill('Passwort', anna.password);
    await user.press(screen.getByRole('button', { name: 'Anmelden' }));

    await expectStepThree();
    expect(mockDevice.ownPerson()?.disclaimerAcceptedAt).not.toBeNull();
  });

  it('Tastatur: „Los“ im letzten Feld sendet ab, ohne nach unten zur Hauptaktion zu müssen', async () => {
    await openApp();
    await toAccountStep();

    await fill('E-Mail-Adresse', anna.email);
    await fill('Passwort', anna.password);
    await fill('Anzeigename', anna.displayName);
    expect(screen.getByLabelText('E-Mail-Adresse')).toHaveProp('returnKeyType', 'next');
    expect(screen.getByLabelText('Anzeigename')).toHaveProp('returnKeyType', 'go');
    await act(async () => fireEvent(screen.getByLabelText('Anzeigename'), 'submitEditing'));

    await expectStepThree();
  });

  it('ohne Netz: zeigt „Für dein Konto brauchst du kurz Internet“ und „Konto anlegen“ versucht es erneut', async () => {
    await openApp();
    await toAccountStep();
    mockDevice.faults.set({ transport: 'offline' });
    await fill('E-Mail-Adresse', anna.email);
    await fill('Passwort', anna.password);
    await fill('Anzeigename', anna.displayName);
    await user.press(screen.getByRole('button', { name: 'Konto anlegen' }));

    expect(await screen.findByText('Für dein Konto brauchst du kurz Internet')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Konto anlegen' })).toBeOnTheScreen();

    mockDevice.faults.set({ transport: 'ok' });
    await user.press(screen.getByRole('button', { name: 'Konto anlegen' }));

    await expectStepThree();
  });

  it('Anmelden: falsche E-Mail und falsches Passwort zeigen denselben Satz', async () => {
    await mockDevice.addAccount(anna);
    await openApp();
    await toAccountStep();
    await user.press(screen.getByRole('button', { name: 'Ich habe schon ein Konto' }));

    await fill('E-Mail-Adresse', 'niemand@example.test');
    await fill('Passwort', anna.password);
    await user.press(screen.getByRole('button', { name: 'Anmelden' }));
    const unknownEmail = await screen.findByText(/stimmen nicht/);
    const shownForUnknownEmail = unknownEmail.props.children as string;

    await user.clear(screen.getByLabelText('E-Mail-Adresse'));
    await fill('E-Mail-Adresse', anna.email);
    await user.clear(screen.getByLabelText('Passwort'));
    await fill('Passwort', 'falsches-passwort');
    await user.press(screen.getByRole('button', { name: 'Anmelden' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Anmelden' })).not.toBeBusy());
    expect(screen.getByText(/stimmen nicht/).props.children).toBe(shownForUnknownEmail);
    expect(shownForUnknownEmail).toBe('E-Mail-Adresse oder Passwort stimmen nicht.');
  });

  it('Registrieren: eine vergebene E-Mail verrät nicht, dass es das Konto gibt', async () => {
    await mockDevice.addAccount(anna);
    await openApp();
    await toAccountStep();

    await fill('E-Mail-Adresse', anna.email);
    await fill('Passwort', anna.password);
    await fill('Anzeigename', anna.displayName);
    await user.press(screen.getByRole('button', { name: 'Konto anlegen' }));

    const shown = 'Mit dieser E-Mail-Adresse geht es so nicht. Prüfe sie oder melde dich an, falls du schon ein Konto hast.';
    expect(await screen.findByText(shown, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText(/registriert|vergeben|existiert/, { includeHiddenElements: true })).toBeNull();
  });

  it('Registrieren: Ablehnungen des Passworts aus dem Auth-Modul stehen am Passwortfeld', async () => {
    await openApp();
    await toAccountStep();

    await fill('E-Mail-Adresse', anna.email);
    await fill('Passwort', 'passwort123');
    await fill('Anzeigename', anna.displayName);
    await user.press(screen.getByRole('button', { name: 'Konto anlegen' }));

    expect(await screen.findByText('Dieses Passwort ist zu bekannt und leicht zu erraten. Bitte wähle ein anderes.', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('prüft Passwort und Anzeigenamen vor dem Senden mit den Regeln aus #97', async () => {
    await openApp();
    await toAccountStep();

    await fill('E-Mail-Adresse', 'keine-adresse');
    await fill('Passwort', 'kurz');
    await fill('Anzeigename', '   ');
    await user.press(screen.getByRole('button', { name: 'Konto anlegen' }));

    expect(screen.getByLabelText('E-Mail-Adresse')).toHaveProp('accessibilityHint', 'Fehler: Bitte gib eine gültige E-Mail-Adresse ein.');
    expect(screen.getByLabelText('Passwort')).toHaveProp('accessibilityHint', 'Fehler: Dein Passwort braucht mindestens 10 Zeichen.');
    expect(screen.getByLabelText('Anzeigename')).toHaveProp('accessibilityHint', 'Fehler: Dein Anzeigename braucht 1 bis 30 Zeichen.');
    expect(mockDevice.server.calls()).toEqual([]);
  });
});

describe('Einrichtung des Kontos', () => {
  it('wiederholt einen ausstehenden Bootstrap ohne Netz mit „Erneut versuchen“', async () => {
    mockDevice.server.setBootstrapAvailable(false);
    await openApp();
    await toAccountStep();
    await fill('E-Mail-Adresse', anna.email);
    await fill('Passwort', anna.password);
    await fill('Anzeigename', anna.displayName);
    await user.press(screen.getByRole('button', { name: 'Konto anlegen' }));

    expect(await screen.findByRole('header', { name: 'Konto wird eingerichtet' })).toBeOnTheScreen();
    expect(await screen.findByText('Für dein Konto brauchst du kurz Internet')).toBeOnTheScreen();

    mockDevice.server.setBootstrapAvailable(true);
    await user.press(screen.getByRole('button', { name: 'Erneut versuchen' }));

    await expectStepThree();
    expect(mockDevice.ownPerson()?.displayName).toBe('Anna');
  });
});

describe('Route „onboarding“ mit Konto', () => {
  it('beginnt ohne Bestätigung bei Schritt 1, setzt sie und geht ohne Schritt 2 zu Schritt 3', async () => {
    mockDevice.server.addAccount(anna);
    await mockDevice.session.auth.signIn(anna);
    await mockDevice.onboarding.setUpAccount({ displayName: DisplayName.parse('Anna') });
    await renderRouter(appDir, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: 'Schön, dass du da bist' })).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding');
    await user.press(screen.getByRole('checkbox', { name: /^Verstanden/ }));
    await user.press(screen.getByRole('button', { name: 'Weiter' }));

    await expectStepThree();
    expect(mockDevice.ownPerson()?.disclaimerAcceptedAt).toBe(clock.read().instant);
  });
});

describe('Zugänglichkeit', () => {
  const interactiveRoles = ['button', 'checkbox'];

  async function expectAccessible() {
    const controls = interactiveRoles.flatMap((role) => screen.queryAllByRole(role));
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.map((control) => ({ name: control.props.accessibilityLabel as string, ...hitArea(control) })).filter(({ width, height }) => width < 48 || height < 48)).toEqual([]);
    for (const label of ['E-Mail-Adresse', 'Passwort', 'Anzeigename']) {
      const input = screen.queryByLabelText(label);
      if (input !== null) expect(hitArea(input).height).toBeGreaterThanOrEqual(48);
    }
    // Wie im Komponentenkatalog: bis Faktor 2,0, enger nur die begrenzten Stile des Design-Systems.
    const limits = new Set<number>([textScale.max, ...Object.values(textScale.limit)]);
    for (const text of screen.queryAllByText(/[\s\S]*/, { includeHiddenElements: true })) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(limits).toContain(text.props.maxFontSizeMultiplier);
    }
  }

  it('Schritte 1 und 2: deutsche Namen, 48-dp-Aktionen, Schrift bis Faktor 2,0', async () => {
    await openApp();
    await expectAccessible();

    await toAccountStep();
    expect(screen.getByRole('button', { name: 'Zurück' })).toBeOnTheScreen();
    expect(screen.getByLabelText('E-Mail-Adresse')).toBeOnTheScreen();
    expect(screen.getByLabelText('Passwort')).toBeOnTheScreen();
    expect(screen.getByLabelText('Anzeigename')).toBeOnTheScreen();
    await expectAccessible();

    await user.press(screen.getByRole('button', { name: 'Ich habe schon ein Konto' }));
    await expectAccessible();
  });
});

// Die Sitzung im Hintergrund nicht offen lassen: Rubik und Router laufen weiter, bis alles steht.
afterAll(async () => {
  await act(async () => {});
});
