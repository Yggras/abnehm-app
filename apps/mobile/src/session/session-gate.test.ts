/** @jest-environment node */
import { eq } from 'drizzle-orm';

import type { AuthState } from '../auth/app-auth';
import { createLocalDatabases } from '../local-db/local-databases';
import { person } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { personRow } from '../local-db/testing/rows';
import { followSessionGate, sessionGate, type SessionGate } from './session-gate';

// Sitzungs-Weiche (Spezifikation 0, Abschnitt 6): jeder Zustand aus Auth-Zustand und eigener Person,
// dazu die Übergänge mit der echten Kontodatenbank (better-sqlite3).

const begonnen = { accountId: 'konto_a', onboardingStatus: 'begonnen' } as const;
const abgeschlossen = { accountId: 'konto_a', onboardingStatus: 'abgeschlossen' } as const;

/** Was Spezifikation 1 am Ende des Onboardings über den Person-Upsert schreibt. */
const completedOnboarding = {
  calculationSex: 'weiblich',
  birthDate: '1992-03-08',
  heightCm: 168,
  activityLevel: 'maessig_aktiv',
  pregnantOrBreastfeeding: false,
  knownEatingDisorder: false,
  disclaimerAcceptedAt: '2026-10-14T12:00:00.000Z',
  onboardingStatus: 'abgeschlossen',
  onboardingCompletedAt: '2026-10-14T12:00:00.000Z',
} as const;

describe('sessionGate', () => {
  it.each<[string, AuthState, Parameters<typeof sessionGate>[1], SessionGate | null]>([
    ['vor der Prüfung der Sitzung', { type: 'unbekannt' }, null, null],
    ['ohne Sitzung', { type: 'abgemeldet' }, null, 'ohne_sitzung'],
    ['mit Sitzung ohne kanonische Person', { type: 'angemeldet', accountId: 'konto_a' }, null, 'bootstrap_ausstehend'],
    ['mit Person eines anderen Kontos', { type: 'angemeldet', accountId: 'konto_b' }, abgeschlossen, 'bootstrap_ausstehend'],
    ['mit begonnenem Onboarding', { type: 'angemeldet', accountId: 'konto_a' }, begonnen, 'onboarding'],
    ['mit abgeschlossenem Onboarding', { type: 'angemeldet', accountId: 'konto_a' }, abgeschlossen, 'today'],
    ['nach 401', { type: 'gesperrt', accountId: 'konto_a' }, abgeschlossen, 'gesperrt'],
    ['nach 401 ohne geöffnete Datenbank', { type: 'gesperrt', accountId: 'konto_a' }, null, 'gesperrt'],
  ])('%s', (_, auth, own, expected) => {
    expect(sessionGate(auth, own)).toBe(expected);
  });
});

describe('followSessionGate', () => {
  function fakeAuth() {
    let state: AuthState = { type: 'unbekannt' };
    const listeners = new Set<(state: AuthState) => void>();
    return {
      state: () => state,
      subscribe(listener: (state: AuthState) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set(next: AuthState) {
        state = next;
        for (const listener of listeners) listener(next);
      },
    };
  }

  it('folgt Anmeldung, erstem Pull, Onboarding-Abschluss und Sperre', async () => {
    const files = createBetterSqliteFiles();
    const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
    try {
      const auth = fakeAuth();
      const gate = followSessionGate(auth);
      const seen: (SessionGate | null)[] = [];
      gate.subscribe(() => seen.push(gate.get()));
      expect(gate.get()).toBeNull();

      auth.set({ type: 'abgemeldet' });
      // Wie das Auth-Modul: erst die Datenbank öffnen, dann den Zustand melden.
      const database = await databases.open('konto_a');
      const detach = gate.opened(database);
      auth.set({ type: 'angemeldet', accountId: 'konto_a' });
      database.transaction((tx) => sqliteOf(tx).insert(person).values(personRow('00000000-0000-4000-8000-00000000000a', 'konto_a')).run());
      database.transaction((tx) => sqliteOf(tx).update(person).set(completedOnboarding).where(eq(person.accountId, 'konto_a')).run());
      detach();
      databases.lock();
      auth.set({ type: 'gesperrt', accountId: 'konto_a' });

      expect(seen).toEqual(['ohne_sitzung', 'bootstrap_ausstehend', 'onboarding', 'today', 'gesperrt']);
    } finally {
      databases.lock();
      files.remove();
    }
  });
});
