import type { ContributionState } from '@abnehm/contracts/contribution';
import { WirContributionsState, type WirContribution, type WirContributionSource } from '@abnehm/contracts/wir';

import { followSource } from './followed-source';

// Steckplatz der Beiträge von Spezifikation 4 für den Tab „Wir“ (Spezifikation 0, Abschnitt 2).
// Spezifikation 4 registriert ihre beobachtbare `WirContributionSource` je geöffneter Kontodatenbank,
// Spezifikation 5 komponiert „Wir“ über `appWirContributions.source`, ohne Tabellen von Spezifikation 4
// zu lesen. Jeder Zustand wird am Vertragsrand geprüft; ohne geöffnetes Konto lädt der Steckplatz.

export type FollowedWirContributions = Readonly<{
  /** Die Quelle für „Wir“; sie folgt dem jeweils geöffneten Konto. */
  source: WirContributionSource;
  /** Meldet die Quelle des geöffneten Kontos an; die Rückgabe löst sie beim Sperren wieder. */
  opened(source: WirContributionSource): () => void;
}>;

export function followWirContributions(): FollowedWirContributions {
  const followed = followSource<ContributionState<WirContribution[]>>({ type: 'loading' });
  return {
    source: { subscribe: (listener) => followed.source.subscribe((state) => listener(WirContributionsState.parse(state))) },
    opened: followed.opened,
  };
}

/** Die Beiträge von Spezifikation 4 an „Wir“ in der App. */
export const appWirContributions = followWirContributions();
