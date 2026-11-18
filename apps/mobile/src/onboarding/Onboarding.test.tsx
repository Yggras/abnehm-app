/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, fireEvent, screen, userEvent, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type * as React from 'react';

import { startOfLocalDate } from '@abnehm/clock';
import { createTestClock } from '@abnehm/clock/testing';
import { DisplayName, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';

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
  deviceAccount: () => mockDevice.account,
  // Bildschirme und Onboarding-Modul lesen dieselbe Testuhr, wie auf dem Gerät dieselbe Uhr.
  appClock: mockClock,
}));
// Jest zeichnet `@expo/ui` nicht: das Geburtsdatum als Textfeld mit dem Zeitpunkt, Sheets inline.
jest.mock('../design/native/DateTimePicker', () => jest.requireActual('../design/testing/text-date-time-picker'));
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const mockClock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const clock = mockClock;
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
  await screen.findByRole('header', { name: 'Willkommen bei Gemeinsam leichter' });
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
    expect(screen.getByRole('header', { name: 'Willkommen bei Gemeinsam leichter' })).toBeOnTheScreen();

    await user.press(screen.getByRole('checkbox', { name: /^Verstanden/ }));
    expect(screen.getByRole('checkbox', { name: /^Verstanden/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled();
  });

  it('Reihenfolge: Weiter führt zu Schritt 2, Zurück zu Schritt 1 mit erhaltener Bestätigung', async () => {
    await openApp();
    await toAccountStep();
    expect(screen.getByRole('progressbar', { name: 'Fortschritt der Einrichtung' })).toHaveAccessibilityValue({ text: 'Schritt 2 von 11' });

    await user.press(screen.getByRole('button', { name: 'Zurück' }));

    expect(await screen.findByRole('header', { name: 'Willkommen bei Gemeinsam leichter' })).toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: /^Verstanden/ })).toBeChecked();
  });
});

describe('Maestro-Teilablauf `link.yaml`', () => {
  // `link.yaml` wartet vor jedem Deep Link auf diese Kennung; seit #138 ist der Willkommensschritt der
  // erste Bildschirm einer frischen App (#276).
  const linkFlow = readFileSync(join(__dirname, '../../e2e/teilablaeufe/link.yaml'), 'utf8');
  const awaitedId = /extendedWaitUntil:\s*\n\s*visible:\s*\n\s*id: ([\w-]+)/.exec(linkFlow)?.[1];

  it('findet die Kennung, auf die der erste Bildschirm einer frischen App wartet, im Willkommensschritt und beim Anmelden', async () => {
    expect(awaitedId).toBeDefined();
    await openApp();
    expect(screen.getByTestId(awaitedId!)).toBeOnTheScreen();

    await toAccountStep();
    await user.press(screen.getByRole('button', { name: 'Ich habe schon ein Konto' }));
    expect(await screen.findByRole('header', { name: 'Anmelden' })).toBeOnTheScreen();
    expect(screen.getByTestId(awaitedId!)).toBeOnTheScreen();
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

  it('Registrieren: eine vergebene E-Mail zeigt den Satz für abgelehnte Adressen und nennt keine Registrierung', async () => {
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
  // Das Auth-Modul (#97) meldet Serverfehler wie fehlendes Netz als `unreachable`; deshalb erscheint auch
  // hier „Für dein Konto brauchst du kurz Internet“.
  it('wiederholt einen ausstehenden Bootstrap, wenn der Server nach der Kontoanlage nicht antwortet', async () => {
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

    expect(await screen.findByRole('header', { name: 'Willkommen bei Gemeinsam leichter' })).toBeOnTheScreen();
    expect(screen).toHavePathname('/onboarding');
    await user.press(screen.getByRole('checkbox', { name: /^Verstanden/ }));
    await user.press(screen.getByRole('button', { name: 'Weiter' }));

    await expectStepThree();
    expect(mockDevice.ownPerson()?.disclaimerAcceptedAt).toBe(clock.read().instant);
  });
});

/** Konto samt Person auf dem Gerät, Hinweis bestätigt: Die App öffnet bei Schritt 3. */
async function openStepThree() {
  await mockDevice.onboarding.register({ ...anna, displayName: DisplayName.parse(anna.displayName), disclaimerAcceptedAt: clock.read().instant });
  await mockDevice.onboarding.setUpAccount();
  await renderRouter(appDir, { initialUrl: '/' });
  await expectStepThree();
}

/** Geburtsdatum als Beginn des lokalen Tags in Europe/Berlin, wie es der native Picker liefert. */
const birthDate = (localDate: string) => startOfLocalDate(LocalDate.parse(localDate), clock.read().timeZone);

async function fillBody({ sex = 'weiblich', born = '1991-04-02', height = '168', weight = '80,0' } = {}) {
  await user.press(screen.getByRole('radio', { name: sex }));
  fireEvent.changeText(screen.getByLabelText('Geburtsdatum'), birthDate(born));
  await user.type(screen.getByLabelText('Größe'), height);
  await user.type(screen.getByLabelText('Aktuelles Gewicht'), weight);
}

async function next() {
  await user.press(screen.getByRole('button', { name: 'Weiter' }));
}

const progressOf = () => screen.getByRole('progressbar', { name: 'Fortschritt der Einrichtung' });

describe('Schritt 3 „Körperdaten“', () => {
  it('fragt Berechnungsgeschlecht mit Erklärung, Geburtsdatum, Größe und Gewicht ab und legt sie samt `entryId` im Entwurf ab', async () => {
    await openStepThree();
    expect(screen.getByText('Die Formel für deinen Grundumsatz kennt nur zwei Werte: weiblich und männlich. Wähle den, mit dem gerechnet werden soll.')).toBeOnTheScreen();

    await fillBody();
    expect(screen.getByRole('radio', { name: 'weiblich' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'männlich' })).not.toBeChecked();
    await next();

    expect(await screen.findByRole('header', { name: 'Sicherheits-Check' })).toBeOnTheScreen();
    expect(progressOf()).toHaveAccessibilityValue({ text: 'Schritt 4 von 11' });
    expect(mockDevice.onboarding.readDraft()).toEqual({
      calculationSex: 'weiblich', birthDate: '1991-04-02', heightCm: 168, weightG: 80_000, startWeightEntryId: expect.any(String),
    });
  });

  it('prüft die Eingabegrenzen des Zielrechners und nennt fehlende Angaben, ohne weiterzugehen', async () => {
    await openStepThree();
    await next();

    expect(screen.getByText('Bitte wähle einen Wert für die Berechnung.')).toBeOnTheScreen();
    expect(screen.getByText('Bitte wähle dein Geburtsdatum.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Größe')).toHaveProp('accessibilityHint', 'Fehler: Bitte gib deine Größe ein.');
    expect(screen.getByLabelText('Aktuelles Gewicht')).toHaveProp('accessibilityHint', 'Fehler: Bitte gib dein aktuelles Gewicht ein.');

    await fillBody({ height: '119', weight: '300,1' });
    await next();
    expect(screen.getByLabelText('Größe')).toHaveProp('accessibilityHint', 'Fehler: Bitte gib deine Größe in ganzen Zentimetern von 120 bis 230 ein.');
    expect(screen.getByLabelText('Aktuelles Gewicht')).toHaveProp(
      'accessibilityHint',
      'Fehler: Bitte gib dein Gewicht von 30,0 bis 300,0 kg mit höchstens einer Nachkommastelle ein.',
    );
    expect(screen.getByRole('header', { name: 'Körperdaten' })).toBeOnTheScreen();

    await user.clear(screen.getByLabelText('Größe'));
    await user.type(screen.getByLabelText('Größe'), '120');
    await user.clear(screen.getByLabelText('Aktuelles Gewicht'));
    await user.type(screen.getByLabelText('Aktuelles Gewicht'), '300');
    await next();
    expect(await screen.findByRole('header', { name: 'Sicherheits-Check' })).toBeOnTheScreen();
  });

  it('funktioniert offline: Schritte 3 und 4 rufen keinen Server auf', async () => {
    await openStepThree();
    mockDevice.faults.set({ transport: 'offline' });
    const calls = mockDevice.server.calls().length;

    await fillBody();
    await next();
    await screen.findByRole('header', { name: 'Sicherheits-Check' });
    await user.press(screen.getByRole('radio', { name: 'Schwanger oder stillend: Nein' }));
    await user.press(screen.getByRole('radio', { name: 'Bekannte Essstörung: Nein' }));
    await next();

    expect(await screen.findByRole('header', { name: 'Aktivitätsstufe' })).toBeOnTheScreen();
    expect(mockDevice.server.calls()).toHaveLength(calls);
  });
});

describe('Sperre unter 18', () => {
  it('der 18. Geburtstag heute gilt als volljährig, einen Tag später zeigt die App den Sperrbildschirm', async () => {
    await openStepThree();
    await fillBody({ born: '2008-10-15' });
    await next();

    expect(await screen.findByRole('header', { name: 'Diese App ist für Erwachsene' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Sicherheits-Check' })).toBeNull();
    expect(mockDevice.onboarding.readDraft().startWeightEntryId).toBeUndefined();

    await user.press(screen.getByRole('button', { name: 'Datum korrigieren' }));
    expect(await screen.findByRole('header', { name: 'Körperdaten' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Größe')).toHaveProp('value', '168');
    fireEvent.changeText(screen.getByLabelText('Geburtsdatum'), birthDate('2008-10-14'));
    await next();

    expect(await screen.findByRole('header', { name: 'Sicherheits-Check' })).toBeOnTheScreen();
  });

  it('bleibt nach einem Neustart bestehen, solange das Datum unter 18 ergibt', async () => {
    await openStepThree();
    await fillBody({ born: '2010-01-01' });
    await next();
    await screen.findByRole('header', { name: 'Diese App ist für Erwachsene' });

    await renderRouter(appDir, { initialUrl: '/' });

    expect(await screen.findByRole('header', { name: 'Diese App ist für Erwachsene' })).toBeOnTheScreen();
  });

  it('„Abmelden“ meldet über das Abmeldemodul ab und führt zurück zum Willkommen', async () => {
    await openStepThree();
    await fillBody({ born: '2010-01-01' });
    await next();
    await screen.findByRole('header', { name: 'Diese App ist für Erwachsene' });

    await user.press(screen.getByRole('button', { name: 'Abmelden' }));
    // Die Bestätigung aus Schritt 1 liegt noch ungesichert in der Outbox.
    await user.press(await screen.findByRole('button', { name: 'Trotzdem abmelden' }));

    expect(await screen.findByRole('header', { name: 'Willkommen bei Gemeinsam leichter' })).toBeOnTheScreen();
    expect(screen).toHavePathname('/sitzung');
    expect(mockDevice.server.calls()).toContain('POST /v1/session/logout');
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
