import { useEffect, useState } from 'react';

import { createOpenedModule, useOpenedModule } from '../shell/opened-module';
import type { Partner } from './partner';
import type { WirPartner } from './partner-view';

// Der Partnerbereich des geöffneten Kontos für „Wir“. Die App-Sitzung meldet ihn an, sobald eine
// Kontodatenbank offen ist (`src/session/device-session.ts`), und löst ihn beim Sperren wieder.

export const appPartner = createOpenedModule<Partner>();

/** Der Partnerbereich des geöffneten Kontos; `null`, solange keines offen ist. */
export function usePartner(): Partner | null {
  return useOpenedModule(appPartner);
}

/** Der aktuelle Partnerzustand; ohne geöffnetes Konto und bis zur ersten Lesung lädt er. */
export function useWirPartner(partner: Partner | null): WirPartner {
  const [snapshot, setSnapshot] = useState<{ partner: Partner; value: WirPartner } | null>(null);
  useEffect(() => partner?.wir.subscribe((value) => setSnapshot({ partner, value })), [partner]);
  return snapshot !== null && snapshot.partner === partner ? snapshot.value : { type: 'loading' };
}
