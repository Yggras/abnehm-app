import { useEffect, useState } from 'react';

import { createOpenedModule, useOpenedModule } from '../shell/opened-module';
import type { Source } from '../shell/followed-source';
import type { CouplingState } from './coupling-state';
import type { EncourageView, Partner } from './partner';
import type { WirPartner } from './partner-view';

// Der Partnerbereich des geöffneten Kontos für „Wir“. Die App-Sitzung meldet ihn an, sobald eine
// Kontodatenbank offen ist (`src/session/device-session.ts`), und löst ihn beim Sperren wieder.

export const appPartner = createOpenedModule<Partner>();

/** Der Partnerbereich des geöffneten Kontos; `null`, solange keines offen ist. */
export function usePartner(): Partner | null {
  return useOpenedModule(appPartner);
}

type Loading = Readonly<{ type: 'loading' }>;

/** Die Quellen des Partnerbereichs, die ein Bildschirm abonniert. */
type SourceKey = 'wir' | 'encourageSheet' | 'couplingState';
type ValueOf<K extends SourceKey> = Partner[K] extends Source<infer V> ? V : never;

/**
 * Der aktuelle Wert einer Quelle des Partnerbereichs, etwa „Wir“ oder das Sheet `partner.encourage`;
 * ohne geöffnetes Konto und bis zur ersten Lesung lädt er.
 */
function usePartnerSource<K extends SourceKey>(partner: Partner | null, key: K): ValueOf<K> | Loading {
  const [snapshot, setSnapshot] = useState<{ partner: Partner; key: K; value: ValueOf<K> } | null>(null);
  useEffect(() => {
    if (partner === null) return undefined;
    const source = partner[key] as Source<ValueOf<K>>;
    return source.subscribe((value) => setSnapshot({ partner, key, value }));
  }, [partner, key]);
  return snapshot !== null && snapshot.partner === partner && snapshot.key === key ? snapshot.value : { type: 'loading' };
}

/** Der aktuelle Partnerzustand für „Wir“. */
export function useWirPartner(partner: Partner | null): WirPartner {
  return usePartnerSource(partner, 'wir');
}

/** Der Zustand des Sheets `partner.encourage`. */
export function useEncourageView(partner: Partner | null): EncourageView {
  return usePartnerSource(partner, 'encourageSheet');
}

/** Stand der Kopplung für `partner.invite` und `partner.redeem` aus SQLite. */
export function useCouplingState(partner: Partner | null): CouplingState {
  return usePartnerSource(partner, 'couplingState');
}
