import type { AppAuth, AuthState } from '../auth/app-auth';
import type { LocalDatabase } from '../local-db';
import { person } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';

// Sitzungs-Weiche der App-Shell (Spezifikation 0, Abschnitt 6): ein expliziter Zustandsautomat über
// dem Zustand des Auth-Moduls und der eigenen Person in der geöffneten Kontodatenbank. Ohne Sitzung
// geht es zur Anmeldung; mit Sitzung, aber ohne kanonische Person, bleibt die Weiche bei
// `bootstrap_ausstehend`; erst danach entscheidet der Onboarding-Stand. Nach `401` ist die
// Fachoberfläche gesperrt. Die Person kommt mit dem ersten Pull nach dem Bootstrap auf das Gerät.

export const sessionGates = ['ohne_sitzung', 'bootstrap_ausstehend', 'gesperrt', 'onboarding', 'today'] as const;
export type SessionGate = (typeof sessionGates)[number];

/** Die Zustände ohne Fachoberfläche; ihre Bildschirme liefert Spezifikation 1. */
export const sessionScreenGates = ['ohne_sitzung', 'bootstrap_ausstehend', 'gesperrt'] as const satisfies readonly SessionGate[];
export type SessionScreenGate = (typeof sessionScreenGates)[number];

/** Die eigene Person, soweit die Weiche sie braucht; `null` ohne Person oder ohne geöffnete Datenbank. */
export type GatePerson = Readonly<{ accountId: string; onboardingStatus: 'begonnen' | 'abgeschlossen' }> | null;

/** Zustand der Weiche; `null`, solange das Auth-Modul die gespeicherte Sitzung noch nicht geprüft hat. */
export function sessionGate(auth: AuthState, own: GatePerson): SessionGate | null {
  switch (auth.type) {
    case 'unbekannt':
      return null;
    case 'abgemeldet':
      return 'ohne_sitzung';
    case 'gesperrt':
      return 'gesperrt';
    case 'angemeldet':
      // Eine Person aus der Datenbank eines anderen Kontos zählt nie.
      if (own === null || own.accountId !== auth.accountId) return 'bootstrap_ausstehend';
      return own.onboardingStatus === 'abgeschlossen' ? 'today' : 'onboarding';
  }
}

export type SessionGateSource = {
  get(): SessionGate | null;
  /** Meldet jeden Wechsel der Weiche; die Rückgabe beendet die Beobachtung. */
  subscribe(listener: () => void): () => void;
  /** Für `onAccountOpened` der App-Sitzung: beobachtet die Person der geöffneten Datenbank bis zum Sperren. */
  opened(database: LocalDatabase): () => void;
};

/** Folgt dem Auth-Modul und der jeweils geöffneten Kontodatenbank. */
export function followSessionGate(auth: Pick<AppAuth, 'state' | 'subscribe'>): SessionGateSource {
  let own: GatePerson = null;
  let current = sessionGate(auth.state(), own);
  const listeners = new Set<() => void>();
  const update = () => {
    const next = sessionGate(auth.state(), own);
    if (next === current) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  auth.subscribe(update);
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    opened(database) {
      const stop = database.observe(
        (tx) => sqliteOf(tx).select({ accountId: person.accountId, onboardingStatus: person.onboardingStatus }).from(person).limit(1).get() ?? null,
        (row) => {
          own = row === null ? null : { accountId: row.accountId, onboardingStatus: row.onboardingStatus === 'abgeschlossen' ? 'abgeschlossen' : 'begonnen' };
          update();
        },
      );
      // Das Auth-Modul schließt die Datenbank, bevor es den neuen Zustand meldet; erst diese Meldung
      // schaltet die Weiche um, ohne Umweg über `bootstrap_ausstehend`.
      return () => {
        stop();
        own = null;
      };
    },
  };
}
