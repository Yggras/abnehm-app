/// <reference types="expo-router/build/ts-declarations/expect" />
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { act, screen, userEvent } from '@testing-library/react-native';
import { renderRouter, testRouter } from 'expo-router/testing-library';

import { sessionGates, type SessionGate } from '../session/session-gate';
import { setTestGate } from '../session/testing/test-gate';
import { hrefFor, openTarget } from '../navigation';
import { onboardingModalRoutes, screenAccess } from './session-routes';
import { useMomoTabBadge } from './tab-badge';

// Sitzungs-Weiche mit dem echten `src/app` (Spezifikation 0, Abschnitt 6): Jeder Zustand führt zu
// seinem Bildschirm, andere Bildschirme sind auch per Deep Link nicht erreichbar, und Modale aus dem
// Onboarding kehren dorthin zurück. Den Zustand stellt der Test-Adapter der Weiche.

const appDir = 'src/app';
jest.setTimeout(30_000);

jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));
jest.mock('./tab-badge', () => ({ useMomoTabBadge: jest.fn() }));

beforeEach(() => {
  jest.mocked(useMomoTabBadge).mockReturnValue(false);
});

/** Öffnet die App und wartet, bis Rubik geladen ist und der erste Bildschirm steht. */
async function openApp(gate: SessionGate, initialUrl = '/') {
  setTestGate(gate);
  await renderRouter(appDir, { initialUrl });
  await screen.findAllByRole('header');
}

describe('jeder Zustand führt zu seinem Bildschirm', () => {
  it.each<[SessionGate, string, string]>([
    ['ohne_sitzung', '/sitzung', 'Willkommen bei Gemeinsam leichter'],
    ['bootstrap_ausstehend', '/sitzung', 'Konto wird eingerichtet'],
    ['gesperrt', '/sitzung', 'Bitte melde dich erneut an'],
    ['onboarding', '/onboarding', 'Einrichtung'],
    ['today', '/', 'Heute'],
  ])('%s öffnet %s', async (gate, pathname, header) => {
    await openApp(gate);

    expect(screen).toHavePathname(pathname);
    expect(screen.getByRole('header', { name: header })).toBeOnTheScreen();
  });

  it('deckt alle Zustände der Weiche ab', () => {
    expect(sessionGates).toEqual(['ohne_sitzung', 'bootstrap_ausstehend', 'gesperrt', 'onboarding', 'today']);
  });
});

describe('gesperrte Bildschirme', () => {
  it.each<[SessionGate, string, string]>([
    ['ohne_sitzung', '/capture/food', '/sitzung'],
    ['bootstrap_ausstehend', '/settings/goals', '/sitzung'],
    ['gesperrt', '/partner', '/sitzung'],
    ['gesperrt', '/onboarding', '/sitzung'],
    ['onboarding', '/momo', '/onboarding'],
    ['onboarding', '/capture/water', '/onboarding'],
    ['today', '/onboarding', '/'],
    ['today', '/sitzung', '/'],
  ])('%s: ein Deep Link auf %s führt nach %s', async (gate, initialUrl, pathname) => {
    await openApp(gate, initialUrl);

    expect(screen).toHavePathname(pathname);
  });

  it('sperrt bei 401 die Fachoberfläche samt Verlauf und kehrt nach erneuter Anmeldung zur Weiche zurück', async () => {
    await openApp('today', '/settings/goals');
    expect(screen).toHavePathname('/settings/goals');

    await act(async () => setTestGate('gesperrt'));
    expect(await screen.findByRole('header', { name: 'Bitte melde dich erneut an' })).toBeOnTheScreen();
    expect(screen).toHavePathname('/sitzung');
    expect(screen.queryByRole('header', { name: 'Ziele' })).toBeNull();

    await act(async () => setTestGate('today'));
    expect(screen).toHavePathname('/');
  });

  it('führt nach der Anmeldung über die Einrichtung ins Onboarding und nach dessen Abschluss zu „Heute“', async () => {
    await openApp('ohne_sitzung');

    await act(async () => setTestGate('bootstrap_ausstehend'));
    expect(screen.getByRole('header', { name: 'Konto wird eingerichtet' })).toBeOnTheScreen();
    await act(async () => setTestGate('onboarding'));
    expect(screen).toHavePathname('/onboarding');
    await act(async () => setTestGate('today'));
    expect(screen).toHavePathname('/');
  });
});

describe('Modale aus dem Onboarding', () => {
  it.each(onboardingModalRoutes)('%s kehrt mit „Fertig“ ins Onboarding zurück', async (name) => {
    await openApp('onboarding');
    await act(async () => openTarget({ type: name }));
    expect(screen).toHavePathname(hrefFor({ type: name }).pathname);

    await userEvent.setup().press(screen.getByRole('button', { name: 'Fertig' }));

    expect(screen).toHavePathname('/onboarding');
  });

  it('kehrt auch mit System-Zurück ins Onboarding zurück', async () => {
    await openApp('onboarding');
    await act(async () => openTarget({ type: 'partner.invite' }));
    expect(screen).toHavePathname('/partner/invite');

    await act(async () => testRouter.back());

    expect(screen).toHavePathname('/onboarding');
  });
});

describe('Routendateien', () => {
  /** Routen des Wurzel-Stacks ohne Layouts, Sonderdateien und die Dateien der Tab-Gruppe. */
  function rootScreens(directory = join(__dirname, '..', 'app')): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return entry.name.startsWith('(') ? [entry.name] : rootScreens(path);
      if (entry.name.startsWith('_') || entry.name.startsWith('+')) return [];
      return [relative(join(__dirname, '..', 'app'), path).replace(/\.tsx$/, '')];
    });
  }

  it('jede Routendatei gehört zu genau einer Gruppe der Weiche oder zu den Entwicklerwerkzeugen', () => {
    const gated = Object.values(screenAccess).flatMap((group) => group.map((entry) => entry.name));
    const developerTools = ['katalog', 'technik'];

    expect(new Set(gated).size).toBe(gated.length);
    expect([...gated, ...developerTools].sort()).toEqual(rootScreens().sort());
  });
});
