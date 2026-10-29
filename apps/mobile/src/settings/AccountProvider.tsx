import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';

import type { DisplayName } from '@abnehm/contracts/base';

import type { AppAuth } from '../auth';
import type { Logout } from '../logout';
import type { OwnDisplayName } from './own-display-name';

/**
 * Was Übersicht und „Konto“ brauchen, je in der Rolle ihres Moduls: E-Mail und Passwort über das
 * Auth-Modul, Abmelden über das Abmeldemodul (Spezifikation 0, Abschnitt 9), der Anzeigename über die
 * eigene Person. Auf dem Gerät setzt der Composition Root sie zusammen (`deviceAccount()`).
 */
export type AccountPorts = Readonly<{
  auth: Pick<AppAuth, 'accountEmail' | 'changePassword'>;
  logout: Pick<Logout, 'logout' | 'pending'>;
  displayName: OwnDisplayName;
}>;

const Context = createContext<AccountPorts | null>(null);

export function AccountProvider({ ports, children }: { ports: AccountPorts; children: ReactNode }) {
  return <Context.Provider value={ports}>{children}</Context.Provider>;
}

export function useAccountPorts(): AccountPorts {
  const ports = useContext(Context);
  if (ports === null) throw new Error('Einstellungen brauchen den AccountProvider');
  return ports;
}

/** Anzeigename der eigenen Person; `null`, bis er aus der Kontodatenbank gelesen ist. */
export function useDisplayName(): DisplayName | null {
  const { displayName } = useAccountPorts();
  return useSyncExternalStore(displayName.subscribe, displayName.current);
}

/** E-Mail des Kontos beim Öffnen des Bildschirms: `loading`, die Adresse oder `unknown` ohne Verbindung. */
export type EmailState = Readonly<{ type: 'loading' } | { type: 'known'; email: string } | { type: 'unknown' }>;

export function useAccountEmail(): EmailState {
  const { auth } = useAccountPorts();
  const [state, setState] = useState<EmailState>({ type: 'loading' });
  useEffect(() => {
    let active = true;
    void auth
      .accountEmail()
      .catch(() => ({ type: 'unreachable' }) as const)
      .then((result) => {
        if (active) setState(result.type === 'known' ? result : { type: 'unknown' });
      });
    return () => {
      active = false;
    };
  }, [auth]);
  return state;
}
