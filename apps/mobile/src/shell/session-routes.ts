import type { RouteName } from '@abnehm/contracts/routes';

import { modalScreens, pageScreens, pathOf, screenNameOf } from '../navigation';
import { sessionScreenGates, type SessionGate, type SessionScreenGate } from '../session/session-gate';

// Welche Bildschirme die Sitzungs-Weiche in welchem Zustand freigibt (Spezifikation 0, Abschnitt 6).
// Das Wurzel-Layout setzt das mit `Stack.Protected` um: Ein gesperrter Bildschirm ist nicht
// erreichbar, auch nicht per Deep Link, und beim Sperren verschwindet sein Verlauf
// (https://docs.expo.dev/router/advanced/protected/).

/** Shell-Route der Zustände ohne Fachoberfläche; nicht im Routenkatalog, weil sie kein Ziel ist. */
export const sessionScreen = 'sitzung';

/**
 * Modale Abläufe, die Onboarding-Schritte öffnen und die dorthin zurückkehren: Schritt 11 öffnet
 * `partner.invite` und `partner.redeem`, Schritt 10 nutzt die Bausteine von `notifications.permission`.
 */
export const onboardingModalRoutes = ['partner.invite', 'partner.redeem', 'notifications.permission'] as const satisfies readonly RouteName[];

const onboardingModals: readonly string[] = onboardingModalRoutes.map(screenNameOf);

/** Ein Screen des Wurzel-Stacks; modale Abläufe erscheinen über ihrem Aufrufer. */
export type GatedScreen = Readonly<{ name: string; modal: boolean }>;

const screens = (names: readonly string[], modal: boolean): GatedScreen[] => names.map((name) => ({ name, modal }));

/** Die Screens des Wurzel-Stacks je Gruppe der Weiche; jede Routendatei steht in genau einer. */
export const screenAccess = {
  /** Nur mit abgeschlossenem Onboarding: Tabs, Seiten und die übrigen modalen Abläufe. */
  today: [
    ...screens(['(tabs)', ...pageScreens], false),
    ...screens(modalScreens.filter((name) => !onboardingModals.includes(name)), true),
  ],
  onboardingAndToday: screens(onboardingModals, true),
  onboarding: screens([screenNameOf('onboarding')], false),
  session: screens([sessionScreen], false),
} as const satisfies Record<string, readonly GatedScreen[]>;

export function isSessionScreenGate(gate: SessionGate): gate is SessionScreenGate {
  return (sessionScreenGates as readonly SessionGate[]).includes(gate);
}

/** Wohin die Weiche führt: „Heute“, das Onboarding oder die Anmeldung. */
export function gateHome(gate: SessionGate): string {
  if (gate === 'today') return pathOf('today');
  if (gate === 'onboarding') return pathOf('onboarding');
  return `/${sessionScreen}`;
}
