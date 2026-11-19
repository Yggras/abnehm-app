/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, fireEvent, screen, userEvent, waitFor, within } from '@testing-library/react-native';
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
    expect(screen.getByText('Tippe auf das Datum und wähle dein Geburtsdatum.')).toBeOnTheScreen();
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

    // Eine 0 ist eine Eingabe außerhalb der Grenzen, kein fehlender Wert.
    await user.clear(screen.getByLabelText('Größe'));
    await user.type(screen.getByLabelText('Größe'), '0');
    await user.clear(screen.getByLabelText('Aktuelles Gewicht'));
    await user.type(screen.getByLabelText('Aktuelles Gewicht'), '0,0');
    await next();
    expect(screen.getByLabelText('Größe')).toHaveProp('accessibilityHint', 'Fehler: Bitte gib deine Größe in ganzen Zentimetern von 120 bis 230 ein.');
    expect(screen.getByLabelText('Aktuelles Gewicht')).toHaveProp(
      'accessibilityHint',
      'Fehler: Bitte gib dein Gewicht von 30,0 bis 300,0 kg mit höchstens einer Nachkommastelle ein.',
    );

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

describe('Schritt 4 „Sicherheits-Check“', () => {
  const forced = /ohne Kaloriendefizit: Dein Kalorienbudget entspricht deinem Gesamtumsatz, also deinem geschätzten täglichen Energieverbrauch \(Haltemodus\)\..*ärztlich begleiten/;
  const chronic = 'Hast du eine chronische Erkrankung? Dann sprich vor dem Abnehmen mit deiner Ärztin oder deinem Arzt.';

  async function openStepFour(body: Parameters<typeof fillBody>[0] = {}) {
    await openStepThree();
    await fillBody(body);
    await next();
    await screen.findByRole('header', { name: 'Sicherheits-Check' });
  }

  async function answer(pregnant: 'Ja' | 'Nein', eatingDisorder: 'Ja' | 'Nein') {
    await user.press(screen.getByRole('radio', { name: `Schwanger oder stillend: ${pregnant}` }));
    await user.press(screen.getByRole('radio', { name: `Bekannte Essstörung: ${eatingDisorder}` }));
  }

  it('zeigt den BMI und geht erst weiter, wenn beide Fragen beantwortet sind', async () => {
    await openStepFour();
    // 80 kg bei 168 cm: 80 / 1,68² = 28,34…
    expect(screen.getByText('28,3')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
    expect(screen.getByText('Beantworte beide Fragen, um weiterzumachen.')).toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: 'Schwanger oder stillend: Nein' }));
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();
    await user.press(screen.getByRole('radio', { name: 'Bekannte Essstörung: Nein' }));

    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled();
    expect(mockDevice.onboarding.readDraft()).toEqual(expect.objectContaining({ pregnantOrBreastfeeding: false, knownEatingDisorder: false }));
  });

  it.each([
    ['Schwangerschaft oder Stillzeit', { pregnant: 'Ja', eatingDisorder: 'Nein' }, 'Wegen Schwangerschaft oder Stillzeit'],
    ['bekannte Essstörung', { pregnant: 'Nein', eatingDisorder: 'Ja' }, 'Wegen einer bekannten Essstörung'],
    ['beide Gründe', { pregnant: 'Ja', eatingDisorder: 'Ja' }, 'Wegen Schwangerschaft oder Stillzeit und einer bekannten Essstörung'],
  ] as const)('%s: Hinweis auf ärztliche Begleitung und erzwungener Haltemodus', async (_, answers, reason) => {
    await openStepFour();
    await answer(answers.pregnant, answers.eatingDisorder);

    const notice = screen.getByText(forced);
    expect(notice).toHaveTextContent(new RegExp(`^${reason} rechnet die App`));
    await next();
    expect(await screen.findByRole('header', { name: 'Aktivitätsstufe' })).toBeOnTheScreen();
  });

  it('Untergewicht: BMI unter 18,5 erzwingt den Haltemodus, genau 18,5 nicht', async () => {
    // 200 cm: BMI 18,5 bei genau 74,0 kg.
    await openStepFour({ height: '200', weight: '73,9' });
    await answer('Nein', 'Nein');
    expect(screen.getByText('18,4')).toBeOnTheScreen();
    expect(screen.getByText(forced)).toHaveTextContent(/^Wegen eines BMI unter 18,5 rechnet die App/);
    await answer('Ja', 'Ja');
    expect(screen.getByText(forced)).toHaveTextContent(
      /^Wegen Schwangerschaft oder Stillzeit, einer bekannten Essstörung und eines BMI unter 18,5 rechnet die App/,
    );
    await answer('Nein', 'Nein');

    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    await user.clear(await screen.findByLabelText('Aktuelles Gewicht'));
    await user.type(screen.getByLabelText('Aktuelles Gewicht'), '74,0');
    await next();

    expect(await screen.findByText('18,5')).toBeOnTheScreen();
    expect(screen.queryByText(forced)).toBeNull();
  });

  it('chronische Erkrankung: nur ein Hinweistext, ohne Sperre und ohne Haltemodus', async () => {
    await openStepFour();
    expect(screen.getByText(chronic)).toBeOnTheScreen();
    await answer('Nein', 'Nein');

    expect(screen.queryByText(forced)).toBeNull();
    await next();
    expect(await screen.findByRole('header', { name: 'Aktivitätsstufe' })).toBeOnTheScreen();
  });

  it('„Zurück“ behält alle Eingaben der Schritte 3 und 4', async () => {
    await openStepFour({ sex: 'männlich', height: '182', weight: '91,8' });
    await answer('Nein', 'Ja');

    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('header', { name: 'Körperdaten' })).toBeOnTheScreen();
    expect(progressOf()).toHaveAccessibilityValue({ text: 'Schritt 3 von 11' });
    expect(screen.getByRole('radio', { name: 'männlich' })).toBeChecked();
    expect(screen.getByLabelText('Geburtsdatum')).toHaveProp('value', birthDate('1991-04-02'));
    expect(screen.getByLabelText('Größe')).toHaveProp('value', '182');
    expect(screen.getByLabelText('Aktuelles Gewicht')).toHaveProp('value', '91,8');

    await next();
    expect(await screen.findByRole('header', { name: 'Sicherheits-Check' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Schwanger oder stillend: Nein' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Bekannte Essstörung: Ja' })).toBeChecked();

    await next();
    await screen.findByRole('header', { name: 'Aktivitätsstufe' });
    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('header', { name: 'Sicherheits-Check' })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Bekannte Essstörung: Ja' })).toBeChecked();
  });
});

// Schritte 5–7 (#143) mit dem Referenzfall aus research/calorie-needs.md: Frau, 35 Jahre, 168 cm,
// 80 kg → Grundumsatz 1.514 kcal, Gesamtumsatz 2.120 kcal bei PAL 1,4, Budget 1.620 kcal.

async function answerSafety(pregnant: 'Ja' | 'Nein' = 'Nein', eatingDisorder: 'Ja' | 'Nein' = 'Nein') {
  await user.press(screen.getByRole('radio', { name: `Schwanger oder stillend: ${pregnant}` }));
  await user.press(screen.getByRole('radio', { name: `Bekannte Essstörung: ${eatingDisorder}` }));
}

async function openStepFive({ pregnant = 'Nein' as 'Ja' | 'Nein', ...body }: Parameters<typeof fillBody>[0] & { pregnant?: 'Ja' | 'Nein' } = {}) {
  await openStepThree();
  await fillBody(body);
  await next();
  await screen.findByRole('header', { name: 'Sicherheits-Check' });
  await answerSafety(pregnant);
  await next();
  await screen.findByRole('header', { name: 'Aktivitätsstufe' });
}

async function openStepSix(options: Parameters<typeof openStepFive>[0] = {}) {
  await openStepFive(options);
  await next();
  await screen.findByRole('header', { name: 'Zielgewicht und Tempo' });
}

async function openStepSeven(options: Parameters<typeof openStepFive>[0] = {}) {
  await openStepSix(options);
  await next();
  await screen.findByRole('header', { name: 'Ergebnis' });
}

const levelCard = (name: string) => screen.getByRole('radio', { name });
const lowLevel = 'wenig aktiv, überwiegend sitzend';
const midLevel = 'mäßig aktiv, sitzend, zeitweise gehend oder stehend';
const highLevel = 'aktiv, überwiegend gehend oder stehend';
const relaxed = 'entspannt, etwa 0,5 kg pro Woche';
const faster = 'zügiger, etwa 0,75 kg pro Woche';
const forecastNote = 'Schätzung. Nach etwa drei Monaten verlangsamt sich die Abnahme meist.';

async function typeGoalWeight(value: string) {
  await user.clear(screen.getByLabelText('Zielgewicht'));
  await user.type(screen.getByLabelText('Zielgewicht'), value);
}

describe('Schritt 5 „Aktivitätsstufe“', () => {
  it('zeigt drei Karten, die niedrigste vorausgewählt, mit „im Zweifel die niedrigere“', async () => {
    await openStepFive();

    expect(progressOf()).toHaveAccessibilityValue({ text: 'Schritt 5 von 11' });
    expect(levelCard(lowLevel)).toBeChecked();
    expect(levelCard(midLevel)).not.toBeChecked();
    expect(levelCard(highLevel)).not.toBeChecked();
    expect(screen.getByText('Im Zweifel die niedrigere Stufe: So überschätzt die App deinen Bedarf nicht.')).toBeOnTheScreen();

    await next();
    expect(await screen.findByRole('header', { name: 'Zielgewicht und Tempo' })).toBeOnTheScreen();
    expect(mockDevice.onboarding.readDraft().activityLevel).toBe('wenig_aktiv');
  });

  it('legt die gewählte Stufe sofort im Entwurf ab', async () => {
    await openStepFive();

    await user.press(levelCard(midLevel));

    expect(levelCard(midLevel)).toBeChecked();
    expect(levelCard(lowLevel)).not.toBeChecked();
    expect(mockDevice.onboarding.readDraft().activityLevel).toBe('maessig_aktiv');
  });
});

describe('Schritt 6 „Zielgewicht und Tempo“', () => {
  it('wählt 5 % unter dem aktuellen Gewicht und „entspannt“ vor und zeigt die Prognose als Schätzung', async () => {
    await openStepSix();

    expect(progressOf()).toHaveAccessibilityValue({ text: 'Schritt 6 von 11' });
    expect(screen.getByLabelText('Zielgewicht')).toHaveProp('value', '76,0');
    // BMI 18,5 bei 168 cm sind 52,21… kg, aufgerundet auf 0,1 kg.
    expect(screen.getByLabelText('Zielgewicht')).toHaveProp('accessibilityHint', 'Vorschlag: 72,0 bis 76,0 kg. Mindestens 52,3 kg.');
    expect(screen.getByRole('radio', { name: relaxed })).toBeChecked();
    // 4 kg bei 0,5 kg pro Woche: 8 Wochen ab dem 14.10.2026.
    expect(screen.getByText('etwa Dezember 2026')).toBeOnTheScreen();
    expect(screen.getByText(forecastNote)).toBeOnTheScreen();

    await user.press(screen.getByRole('radio', { name: faster }));
    // 4 kg bei 0,75 kg pro Woche: 38 Tage.
    expect(screen.getByText('etwa November 2026')).toBeOnTheScreen();

    await next();
    expect(await screen.findByRole('header', { name: 'Ergebnis' })).toBeOnTheScreen();
    expect(mockDevice.onboarding.readDraft()).toEqual(expect.objectContaining({ goalWeightG: 76_000, pace: 'zuegiger' }));
  });

  it('Untergrenze BMI 18,5 und 0,1-kg-Schritte: darunter und mit zwei Nachkommastellen geht es nicht weiter', async () => {
    await openStepSix();

    await typeGoalWeight('52,2');
    expect(screen.getByLabelText('Zielgewicht')).toHaveProp('accessibilityHint', 'Fehler: Dein Zielgewicht muss mindestens 52,3 kg betragen, das entspricht einem BMI von 18,5.');
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();

    await typeGoalWeight('70,25');
    expect(screen.getByLabelText('Zielgewicht')).toHaveProp('accessibilityHint', 'Fehler: Bitte gib dein Zielgewicht in kg mit höchstens einer Nachkommastelle ein.');
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled();

    await typeGoalWeight('52,3');
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled();
    expect(mockDevice.onboarding.readDraft().goalWeightG).toBe(52_300);
  });

  it('ein Zielgewicht nicht unter dem aktuellen führt mit Hinweis in den gewählten Haltemodus, ohne Tempo und Prognose', async () => {
    await openStepSix();

    await typeGoalWeight('80,0');

    expect(screen.getByText(/^Dein Zielgewicht liegt nicht unter deinem aktuellen Gewicht von 80,0 kg\. .*\(Haltemodus\)/)).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: relaxed })).toBeNull();
    expect(screen.queryByText(forecastNote)).toBeNull();

    await typeGoalWeight('75,0');
    expect(screen.getByRole('radio', { name: relaxed })).toBeChecked();
    expect(screen.getByText(forecastNote)).toBeOnTheScreen();
  });

  it('erzwungener Haltemodus aus dem Sicherheits-Check: Hinweis, kein Tempo, keine Prognose', async () => {
    await openStepSix({ pregnant: 'Ja' });

    expect(screen.getByText(/^Wegen Schwangerschaft oder Stillzeit rechnet die App.*ärztlich begleiten/)).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: relaxed })).toBeNull();
    expect(screen.queryByText(forecastNote)).toBeNull();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled();
  });
});

describe('Schritt 7 „Ergebnis“', () => {
  const budgetValue = (text: string) => screen.getByLabelText(`Kalorienbudget pro Tag: ${text}`);

  it('zeigt das Budget mit aufklappbarer Herleitung aus Grundumsatz, Aktivitätsstufe und Defizit', async () => {
    await openStepSeven();

    expect(progressOf()).toHaveAccessibilityValue({ text: 'Schritt 7 von 11' });
    expect(budgetValue('1.620 kcal')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Grundumsatz: 1.514 kcal')).toBeNull();

    await user.press(screen.getByRole('button', { name: 'So entsteht dein Budget' }));

    expect(screen.getByLabelText('Grundumsatz: 1.514 kcal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Aktivitätsstufe wenig aktiv – überwiegend sitzend: mal 1,4')).toBeOnTheScreen();
    expect(screen.getByLabelText('Gesamtumsatz: 2.120 kcal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Defizit für das Tempo entspannt: minus 500 kcal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Untergrenze: 1.514 kcal')).toBeOnTheScreen();
    expect(screen.queryByText(/angehoben/)).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Herleitung ausblenden' }));
    expect(screen.queryByLabelText('Grundumsatz: 1.514 kcal')).toBeNull();
  });

  it('ändert das Budget in 10-kcal-Schritten als eigenes und kehrt zur Rechnung zurück', async () => {
    await openStepSeven();

    await user.press(screen.getByRole('button', { name: 'Kalorienbudget pro Tag erhöhen' }));
    expect(budgetValue('1.630 kcal')).toBeOnTheScreen();
    expect(screen.getByText('Selbst festgelegt. Möglich sind 1.520 bis 2.120 kcal.')).toBeOnTheScreen();
    expect(mockDevice.onboarding.readDraft().manualBudgetKcal).toBe(1_630);

    await user.press(screen.getByRole('button', { name: 'Zurück zu 1.620 kcal' }));
    expect(budgetValue('1.620 kcal')).toBeOnTheScreen();
    expect(screen.getByText('Berechnet. Möglich sind 1.520 bis 2.120 kcal.')).toBeOnTheScreen();
    expect(mockDevice.onboarding.readDraft().manualBudgetKcal).toBeUndefined();
  });

  it('Anhebungshinweis mit Verweis auf ärztliche Begleitung; an der Untergrenze geht es nicht weiter nach unten', async () => {
    await openStepSix();
    await user.press(screen.getByRole('radio', { name: faster }));
    await next();
    await screen.findByRole('header', { name: 'Ergebnis' });

    // 2.119,6 − 750 = 1.369,6 kcal liegt unter dem Grundumsatz; angehoben auf das nächste Vielfache von 10.
    expect(budgetValue('1.520 kcal')).toBeOnTheScreen();
    expect(screen.getByText(/^Die Rechnung lag unter deiner Untergrenze, deshalb ist dein Budget angehoben\..*ärztlich begleiten/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Kalorienbudget pro Tag verringern' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kalorienbudget pro Tag erhöhen' })).toBeEnabled();
  });

  it('am Gesamtumsatz geht es nicht weiter nach oben', async () => {
    await openStepSix();
    await typeGoalWeight('80,0');
    await next();
    await screen.findByRole('header', { name: 'Ergebnis' });

    expect(budgetValue('2.120 kcal')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Kalorienbudget pro Tag erhöhen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kalorienbudget pro Tag verringern' })).toBeEnabled();
  });

  it('im gewählten Haltemodus reicht der Bereich bis zum auf 10 kcal gerundeten Gesamtumsatz', async () => {
    await openStepFive();
    await user.press(levelCard(highLevel));
    await next();
    await screen.findByRole('header', { name: 'Zielgewicht und Tempo' });
    await typeGoalWeight('80,0');
    await next();
    await screen.findByRole('header', { name: 'Ergebnis' });

    // 1.514 × 1,8 = 2.725,2 kcal: Budget 2.730 kcal, ein eigenes höchstens 2.720 kcal.
    expect(budgetValue('2.730 kcal')).toBeOnTheScreen();
    expect(screen.getByText('Berechnet. Möglich sind 1.520 bis 2.730 kcal.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Kalorienbudget pro Tag erhöhen' })).toBeDisabled();

    await user.press(screen.getByRole('button', { name: 'Kalorienbudget pro Tag verringern' }));
    expect(budgetValue('2.720 kcal')).toBeOnTheScreen();
    expect(mockDevice.onboarding.readDraft().manualBudgetKcal).toBe(2_720);
    await user.press(screen.getByRole('button', { name: 'Kalorienbudget pro Tag erhöhen' }));
    expect(budgetValue('2.730 kcal')).toBeOnTheScreen();
    expect(mockDevice.onboarding.readDraft().manualBudgetKcal).toBeUndefined();
  });

  it('im erzwungenen Haltemodus lässt sich das Budget nicht ändern', async () => {
    await openStepSeven({ pregnant: 'Ja' });

    expect(screen.getByLabelText('Kalorienbudget pro Tag: 2.120 kcal')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Kalorienbudget pro Tag erhöhen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Kalorienbudget pro Tag verringern' })).toBeNull();
    expect(screen.getByText(/^Wegen Schwangerschaft oder Stillzeit rechnet die App/)).toBeOnTheScreen();
  });

  it('Wasser in 250-ml-Schritten mit Hinweis auf Mehrbedarf, Sport in 10-Minuten-Schritten', async () => {
    await openStepSeven();

    expect(screen.getByLabelText('Wasserziel: 1,5 l')).toBeOnTheScreen();
    expect(screen.getByText('Bei Hitze und Sport brauchst du mehr.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Sportziel: 150 min')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Wasserziel erhöhen' }));
    await user.press(screen.getByRole('button', { name: 'Sportziel verringern' }));

    expect(screen.getByLabelText('Wasserziel: 1,75 l')).toBeOnTheScreen();
    expect(screen.getByLabelText('Sportziel: 140 min')).toBeOnTheScreen();
    expect(mockDevice.onboarding.readDraft()).toEqual(expect.objectContaining({ waterTargetMl: 1_750, weeklySportTargetMinutes: 140 }));
  });

  it.each([
    ['unteren', { waterTargetMl: 500, weeklySportTargetMinutes: 30 }, 'verringern'],
    ['oberen', { waterTargetMl: 5_000, weeklySportTargetMinutes: 600 }, 'erhöhen'],
  ] as const)('Stepper an der %s Grenze sperren die Richtung', async (_, targets, direction) => {
    await openStepSix();
    mockDevice.onboarding.updateDraft(targets);
    await next();
    await screen.findByRole('header', { name: 'Ergebnis' });

    expect(screen.getByRole('button', { name: `Wasserziel ${direction}` })).toBeDisabled();
    expect(screen.getByRole('button', { name: `Sportziel ${direction}` })).toBeDisabled();
  });

  it('„Weiter“ übernimmt die Vorschläge in den Entwurf und führt zu Schritt 8', async () => {
    await openStepSeven();

    await next();

    expect(await screen.findByRole('header', { name: 'Wochenplan' })).toBeOnTheScreen();
    expect(progressOf()).toHaveAccessibilityValue({ text: 'Schritt 8 von 11' });
    expect(mockDevice.onboarding.readDraft()).toEqual(
      expect.objectContaining({ activityLevel: 'wenig_aktiv', goalWeightG: 76_000, pace: 'entspannt', waterTargetMl: 1_500, weeklySportTargetMinutes: 150 }),
    );
    expect(mockDevice.onboarding.readDraft().manualBudgetKcal).toBeUndefined();
  });
});

describe('Schritte 5–7 ohne Netz und mit „Zurück“', () => {
  it('rufen keinen Server auf, und „Zurück“ behält alle Eingaben', async () => {
    await openStepFive();
    mockDevice.faults.set({ transport: 'offline' });
    const calls = mockDevice.server.calls().length;

    await user.press(levelCard(highLevel));
    await next();
    await screen.findByRole('header', { name: 'Zielgewicht und Tempo' });
    await typeGoalWeight('75,0');
    await user.press(screen.getByRole('radio', { name: faster }));
    await next();
    await screen.findByRole('header', { name: 'Ergebnis' });
    await user.press(screen.getByRole('button', { name: 'Kalorienbudget pro Tag verringern' }));
    await user.press(screen.getByRole('button', { name: 'Wasserziel erhöhen' }));
    await user.press(screen.getByRole('button', { name: 'Sportziel erhöhen' }));
    // aktiv: 1.514 × 1,8 − 750 = 1.975,2 kcal → 1.980 kcal, eins tiefer 1.970 kcal.
    expect(screen.getByLabelText('Kalorienbudget pro Tag: 1.970 kcal')).toBeOnTheScreen();

    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('header', { name: 'Zielgewicht und Tempo' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Zielgewicht')).toHaveProp('value', '75,0');
    expect(screen.getByRole('radio', { name: faster })).toBeChecked();

    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('header', { name: 'Aktivitätsstufe' })).toBeOnTheScreen();
    expect(levelCard(highLevel)).toBeChecked();

    await next();
    await screen.findByRole('header', { name: 'Zielgewicht und Tempo' });
    await next();
    await screen.findByRole('header', { name: 'Ergebnis' });
    expect(screen.getByLabelText('Kalorienbudget pro Tag: 1.970 kcal')).toBeOnTheScreen();
    expect(screen.getByLabelText('Wasserziel: 1,75 l')).toBeOnTheScreen();
    expect(screen.getByLabelText('Sportziel: 160 min')).toBeOnTheScreen();
    expect(mockDevice.server.calls()).toHaveLength(calls);
  });

  it('ein eigenes Budget bleibt nach einer anderen Aktivitätsstufe, solange es im neuen Bereich liegt', async () => {
    await openStepSeven();
    await user.press(screen.getByRole('button', { name: 'Kalorienbudget pro Tag erhöhen' }));

    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    await screen.findByRole('header', { name: 'Zielgewicht und Tempo' });
    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    await screen.findByRole('header', { name: 'Aktivitätsstufe' });
    await user.press(levelCard(midLevel));
    await next();
    await screen.findByRole('header', { name: 'Zielgewicht und Tempo' });
    await next();
    await screen.findByRole('header', { name: 'Ergebnis' });

    // mäßig aktiv: 1.514 × 1,6 − 500 = 1.922,4 kcal → 1.920 kcal; die eigenen 1.630 kcal liegen im Bereich.
    expect(screen.getByLabelText('Kalorienbudget pro Tag: 1.630 kcal')).toBeOnTheScreen();
    expect(screen.getByText('Selbst festgelegt. Möglich sind 1.520 bis 2.420 kcal.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Zurück zu 1.920 kcal' })).toBeOnTheScreen();
  });
});

async function openStepEight(options: Parameters<typeof openStepFive>[0] = {}) {
  await openStepSeven(options);
  await next();
  await screen.findByRole('header', { name: 'Wochenplan' });
}

// Sporttage sind Kästchen, der Wiegetag eine Einzelauswahl; beide heißen wie der Wochentag.
const sportDay = (name: string) => screen.getByRole('checkbox', { name });
const weighDay = (name: string) => screen.getByRole('radio', { name });
const weekRow = (name: string) => screen.getByLabelText(name);
const savePlan = () => user.press(screen.getByRole('button', { name: 'Plan speichern' }));
/** Heute laut Testuhr: Mittwoch, 14.10.2026, in Europe/Berlin. */
const today = LocalDate.parse('2026-10-14');

describe('Schritt 8 „Wochenplan“', () => {
  it('wählt Dienstag, Donnerstag und Samstag als Sporttage und Montag als Wiegetag vor', async () => {
    await openStepEight();

    expect(screen.queryByText(/gilt ab morgen/)).toBeNull();
    expect(progressOf()).toHaveAccessibilityValue({ text: 'Schritt 8 von 11' });
    for (const day of ['Dienstag', 'Donnerstag', 'Samstag']) expect(sportDay(day)).toBeChecked();
    for (const day of ['Montag', 'Mittwoch', 'Freitag', 'Sonntag']) expect(sportDay(day)).not.toBeChecked();
    expect(weighDay('Montag')).toBeChecked();
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  it('Sporttag und Wiegetag sperren sich gegenseitig, und der gesperrte Chip sagt, warum', async () => {
    await openStepEight();

    // Der Wiegetag ist kein Sporttag, Sporttage sind kein Wiegetag.
    expect(sportDay('Montag')).toBeDisabled();
    expect(sportDay('Montag')).toHaveProp('accessibilityHint', 'Montag ist dein Wiegetag. Dort ist das dritte Tagesziel „Gewogen“, darum ist er kein Sporttag.');
    for (const day of ['Dienstag', 'Donnerstag', 'Samstag']) {
      expect(weighDay(day)).toBeDisabled();
      expect(weighDay(day)).toHaveProp('accessibilityHint', `${day} ist ein Sporttag. Dort ist das dritte Tagesziel „Sporteinheit“, darum ist er kein Wiegetag.`);
    }
    expect(screen.getByText('Montag ist dein Wiegetag. Dort ist das dritte Tagesziel „Gewogen“, darum ist er kein Sporttag.')).toBeOnTheScreen();
    expect(screen.getByText('Sporttage sind kein Wiegetag: Dort ist das dritte Tagesziel „Sporteinheit“.')).toBeOnTheScreen();

    await user.press(weighDay('Sonntag'));
    expect(weighDay('Sonntag')).toBeChecked();
    expect(sportDay('Montag')).toBeEnabled();
    expect(sportDay('Sonntag')).toBeDisabled();

    await user.press(sportDay('Mittwoch'));
    expect(sportDay('Mittwoch')).toBeChecked();
    expect(weighDay('Mittwoch')).toBeDisabled();

    await user.press(sportDay('Dienstag'));
    expect(sportDay('Dienstag')).not.toBeChecked();
    expect(weighDay('Dienstag')).toBeEnabled();
    expect(mockDevice.onboarding.readDraft()).toEqual(expect.objectContaining({ sportDays: ['mittwoch', 'donnerstag', 'samstag'], weighDay: 'sonntag' }));
  });

  it('erlaubt 0 bis 6 Sporttage', async () => {
    await openStepEight();

    for (const day of ['Mittwoch', 'Freitag', 'Sonntag']) await user.press(sportDay(day));
    expect(screen.getAllByRole('checkbox', { checked: true })).toHaveLength(6);
    // Der siebte Tag ist der Wiegetag.
    expect(sportDay('Montag')).toBeDisabled();

    for (const day of ['Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']) await user.press(sportDay(day));
    expect(screen.queryAllByRole('checkbox', { checked: true })).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Plan speichern' })).toBeEnabled();
  });

  it('zeigt die drei Tagesziele je Wochentag und die Mindestdauer einer Sporteinheit', async () => {
    await openStepEight();

    // Plätze 1 und 2 stehen einmal über der Liste, je Zeile nur der dritte; der zugängliche Name nennt alle drei.
    expect(screen.getByText('Jeden Tag: Ernährung erfasst und Wasserziel. Dazu je Wochentag:')).toBeOnTheScreen();
    expect(weekRow('Montag: Ernährung erfasst, Wasserziel und Gewogen')).toBeOnTheScreen();
    expect(weekRow('Dienstag: Ernährung erfasst, Wasserziel und Sporteinheit')).toBeOnTheScreen();
    expect(weekRow('Mittwoch: Ernährung erfasst, Wasserziel und Im Kalorienbudget')).toBeOnTheScreen();
    // 150 Minuten ÷ 3 Sporttage.
    expect(screen.getByText('Eine Sporteinheit zählt ab 50 Minuten: dein Sportziel von 150 Minuten pro Woche, verteilt auf 3 Sporttage.')).toBeOnTheScreen();

    await user.press(sportDay('Mittwoch'));
    expect(weekRow('Mittwoch: Ernährung erfasst, Wasserziel und Sporteinheit')).toBeOnTheScreen();
    // 150 ÷ 4 = 37,5, aufgerundet.
    expect(screen.getByText('Eine Sporteinheit zählt ab 38 Minuten: dein Sportziel von 150 Minuten pro Woche, verteilt auf 4 Sporttage.')).toBeOnTheScreen();

    for (const day of ['Dienstag', 'Mittwoch', 'Donnerstag', 'Samstag']) await user.press(sportDay(day));
    expect(screen.getByText('Ohne Sporttag gibt es kein Tagesziel „Sporteinheit“. Dein Sportziel von 150 Minuten pro Woche bleibt.')).toBeOnTheScreen();
  });

  it('speichert ohne Netz und führt zu Schritt 9; erneutes Speichern nach „Zurück“ ergibt ein Startgewicht und heute drei Tagesziele', async () => {
    await openStepEight();
    mockDevice.faults.set({ transport: 'offline' });
    const calls = mockDevice.server.calls().length;

    await savePlan();

    expect(await screen.findByRole('header', { name: 'Gesundheitsdaten verbinden' })).toBeOnTheScreen();
    expect(progressOf()).toHaveAccessibilityValue({ text: 'Schritt 9 von 11' });
    expect(mockDevice.startWeights()).toEqual([expect.objectContaining({ weightG: 80_000, entryId: mockDevice.onboarding.readDraft().startWeightEntryId })]);
    expect(mockDevice.dailyGoalsOn(today)).toHaveLength(3);

    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('header', { name: 'Wochenplan' })).toBeOnTheScreen();
    // Heute gilt schon ein Plan: Änderungen gelten ab morgen (Spezifikation 1, Abschnitt 4; Entscheidung in #134).
    expect(screen.getByText('Dein Plan gilt schon ab heute. Was du hier änderst, gilt ab morgen; deine Tagesziele für heute bleiben.')).toBeOnTheScreen();
    await user.press(sportDay('Mittwoch'));
    await savePlan();

    expect(await screen.findByRole('header', { name: 'Gesundheitsdaten verbinden' })).toBeOnTheScreen();
    expect(mockDevice.startWeights()).toHaveLength(1);
    expect(mockDevice.dailyGoalsOn(today)).toHaveLength(3);
    expect(mockDevice.weeklyPlanVersions()).toEqual([today, LocalDate.parse('2026-10-15')]);
    expect(mockDevice.server.calls()).toHaveLength(calls);
  });

  it('bietet nach einem Fehler Wiederholen an; danach entsteht genau ein Startgewicht', async () => {
    await openStepEight();
    mockDevice.failWeightRecorder('wirft');

    await savePlan();

    expect(await screen.findByText('Dein Plan ist noch nicht gespeichert. Versuch es bitte noch einmal.')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Wochenplan' })).toBeOnTheScreen();
    expect(mockDevice.takeErrors()).toEqual([new Error('WeightRecorder: Transaktion gescheitert')]);
    expect(mockDevice.dailyGoalsOn(today)).toEqual([]);

    mockDevice.failWeightRecorder(false);
    await user.press(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('header', { name: 'Gesundheitsdaten verbinden' })).toBeOnTheScreen();
    expect(mockDevice.startWeights()).toHaveLength(1);
    expect(mockDevice.dailyGoalsOn(today)).toHaveLength(3);
  });

  it('„Zurück“ führt zu Schritt 7 und behält die Wahl', async () => {
    await openStepEight();
    await user.press(weighDay('Sonntag'));

    await user.press(screen.getByRole('button', { name: 'Zurück' }));
    expect(await screen.findByRole('header', { name: 'Ergebnis' })).toBeOnTheScreen();
    await next();
    await screen.findByRole('header', { name: 'Wochenplan' });

    expect(weighDay('Sonntag')).toBeChecked();
  });
});

describe('Zugänglichkeit', () => {
  const interactiveRoles = ['button', 'checkbox', 'radio'];

  async function expectAccessible() {
    const controls = interactiveRoles.flatMap((role) => screen.queryAllByRole(role));
    expect(controls.length).toBeGreaterThan(0);
    expect(controls.map((control) => ({ name: control.props.accessibilityLabel as string, ...hitArea(control) })).filter(({ width, height }) => width < 48 || height < 48)).toEqual([]);
    for (const label of ['E-Mail-Adresse', 'Passwort', 'Anzeigename', 'Größe', 'Aktuelles Gewicht']) {
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

  it('Schritte 3 und 4 und Sperre unter 18: deutsche Namen, 48-dp-Aktionen, Schrift bis Faktor 2,0, Bedeutung nicht nur über Farbe', async () => {
    await openStepThree();
    expect(screen.getByText('Geschlecht für die Berechnung')).toBeOnTheScreen();
    expect(screen.getByLabelText('Geburtsdatum')).toBeOnTheScreen();
    await expectAccessible();

    // Fehler stehen als Satz am Feld, nicht nur als Rahmenfarbe.
    await next();
    expect(screen.getByText('Bitte wähle einen Wert für die Berechnung.')).toBeOnTheScreen();
    await expectAccessible();

    await fillBody({ born: '2010-01-01' });
    await next();
    await screen.findByRole('header', { name: 'Diese App ist für Erwachsene' });
    expect(screen.getByRole('button', { name: 'Datum korrigieren' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Abmelden' })).toBeOnTheScreen();
    await expectAccessible();

    await user.press(screen.getByRole('button', { name: 'Datum korrigieren' }));
    fireEvent.changeText(await screen.findByLabelText('Geburtsdatum'), birthDate('1991-04-02'));
    await next();
    await screen.findByRole('header', { name: 'Sicherheits-Check' });
    expect(screen.getByText('Bist du schwanger oder stillst du?')).toBeOnTheScreen();
    expect(screen.getByText('Hast du eine bekannte Essstörung?')).toBeOnTheScreen();
    await user.press(screen.getByRole('radio', { name: 'Schwanger oder stillend: Ja' }));
    // Ausgewählt heißt Zustand und Häkchen, der Haltemodus ein Satz mit Symbol (#95).
    expect(screen.getByRole('radio', { name: 'Schwanger oder stillend: Ja' })).toBeChecked();
    expect(within(screen.getByRole('radio', { name: 'Schwanger oder stillend: Ja' })).getByTestId('icon-check', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByText(/\(Haltemodus\)/)).toBeOnTheScreen();
    await expectAccessible();
  });

  it('Schritte 5–7: deutsche Namen, 48-dp-Aktionen, Schrift bis Faktor 2,0, Auswahl nicht nur über Farbe', async () => {
    await openStepFive();
    // Ausgewählt heißt Zustand und Häkchen (#95).
    expect(within(levelCard(lowLevel)).getByTestId('icon-check', { includeHiddenElements: true })).toBeOnTheScreen();
    await expectAccessible();

    await next();
    await screen.findByRole('header', { name: 'Zielgewicht und Tempo' });
    expect(hitArea(screen.getByLabelText('Zielgewicht')).height).toBeGreaterThanOrEqual(48);
    await expectAccessible();

    await next();
    await screen.findByRole('header', { name: 'Ergebnis' });
    await user.press(screen.getByRole('button', { name: 'So entsteht dein Budget' }));
    for (const name of ['Kalorienbudget pro Tag verringern', 'Kalorienbudget pro Tag erhöhen', 'Wasserziel verringern', 'Wasserziel erhöhen', 'Sportziel verringern', 'Sportziel erhöhen', 'Herleitung ausblenden']) {
      expect(screen.getByRole('button', { name })).toBeOnTheScreen();
    }
    await expectAccessible();
  });

  it('Schritt 8: deutsche Namen, 48-dp-Aktionen, Schrift bis Faktor 2,0, Auswahl und Sperre nicht nur über Farbe', async () => {
    await openStepEight();

    expect(screen.getAllByRole('checkbox')).toHaveLength(7);
    expect(screen.getAllByRole('radio')).toHaveLength(7);
    // Beide Gruppen tragen eine Überschrift; die Sperre steht als Satz da, nicht nur als graue Fläche.
    expect(screen.getByRole('header', { name: 'Sporttage' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Wiegetag' })).toBeOnTheScreen();
    expect(screen.getByText(/^Montag ist dein Wiegetag\./)).toBeOnTheScreen();
    await expectAccessible();

    mockDevice.failWeightRecorder('wirft');
    await savePlan();
    await screen.findByRole('button', { name: 'Erneut versuchen' });
    mockDevice.takeErrors();
    await expectAccessible();
  });
});

// Die Sitzung im Hintergrund nicht offen lassen: Rubik und Router laufen weiter, bis alles steht.
afterAll(async () => {
  await act(async () => {});
});
