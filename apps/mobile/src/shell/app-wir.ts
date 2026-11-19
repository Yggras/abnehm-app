import type { ContributionState } from '@abnehm/contracts/contribution';
import { WirContributionsState, type WirContribution, type WirContributionSource } from '@abnehm/contracts/wir';

import { followSource, type Source } from './followed-source';

// Steckplatz der Beiträge von Spezifikation 4 für den Tab „Wir“ (Spezifikation 0, Abschnitt 2).
// Spezifikation 4 registriert ihre beobachtbare `WirContributionSource` je geöffneter Kontodatenbank,
// Spezifikation 5 komponiert „Wir“ über `appWirContributions.source`, ohne Tabellen von Spezifikation 4
// zu lesen. Jeder Zustand wird am Vertragsrand geprüft. Ohne angemeldete Quelle meldet der Steckplatz
// `null`: „Wir“ zeigt dann in Test-Artefakten einen Platzhalter (Spezifikation 0, Abschnitt 6; #124).

/** Zustand der Spiel-Beiträge an „Wir“; `null`, solange keine `WirContributionSource` angemeldet ist. */
export type WirContributionsSlot = ContributionState<WirContribution[]> | null;

const followed = followSource<WirContributionsSlot>(null);

/** Die Beiträge von Spezifikation 4 an „Wir“ in der App: `source` für Spezifikation 5, `opened` für die App-Sitzung. */
export const appWirContributions: Readonly<{ source: Source<WirContributionsSlot>; opened(source: WirContributionSource): () => void }> = {
  source: { subscribe: (listener) => followed.source.subscribe((state) => listener(state === null ? null : WirContributionsState.parse(state))) },
  opened: followed.opened,
};
