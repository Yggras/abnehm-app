import type { ContributionState } from '@abnehm/contracts/contribution';
import { WirContributionsState, type WirContribution, type WirContributionSource } from '@abnehm/contracts/wir';

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
  let current: WirContributionSource | null = null;
  const followers = new Set<() => void>();
  const changed = () => {
    for (const follow of followers) follow();
  };
  return {
    source: {
      subscribe(listener) {
        let stop: (() => void) | null = null;
        const checked = (state: ContributionState<WirContribution[]>) => listener(WirContributionsState.parse(state));
        const follow = () => {
          stop?.();
          stop = null;
          if (current === null) listener({ type: 'loading' });
          else stop = current.subscribe(checked);
        };
        followers.add(follow);
        follow();
        return () => {
          followers.delete(follow);
          stop?.();
        };
      },
    },
    opened(source) {
      current = source;
      changed();
      return () => {
        if (current !== source) return;
        current = null;
        changed();
      };
    },
  };
}

/** Die Beiträge von Spezifikation 4 an „Wir“ in der App. */
export const appWirContributions = followWirContributions();
