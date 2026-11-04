import type { ContributionState } from '@abnehm/contracts/contribution';
import { WirContributionsState, type WirContribution, type WirContributionSource } from '@abnehm/contracts/wir';

import { followSource } from './followed-source';

// Steckplatz der Beiträge von Spezifikation 4 für den Tab „Wir“ (Spezifikation 0, Abschnitt 2).
// Spezifikation 4 registriert ihre beobachtbare `WirContributionSource` je geöffneter Kontodatenbank,
// Spezifikation 5 komponiert „Wir“ über `appWirContributions.source`, ohne Tabellen von Spezifikation 4
// zu lesen. Jeder Zustand wird am Vertragsrand geprüft; ohne geöffnetes Konto lädt der Steckplatz.

const followed = followSource<ContributionState<WirContribution[]>>({ type: 'loading' });

/** Die Beiträge von Spezifikation 4 an „Wir“ in der App: `source` für Spezifikation 5, `opened` für die App-Sitzung. */
export const appWirContributions: Readonly<{ source: WirContributionSource; opened(source: WirContributionSource): () => void }> = {
  source: { subscribe: (listener) => followed.source.subscribe((state) => listener(WirContributionsState.parse(state))) },
  opened: followed.opened,
};
