import { LocalDatabaseClosedError, type LocalDatabase, type ReadContext } from '../local-db';
import type { Refresh } from '../shell/followed-source';
import type { TodaySlot, TodaySource, TodayState } from '../shell/today-registry';

// Gemeinsamer Ablauf der Tracker-Beiträge für „Heute“ (Spezifikation 3, Abschnitt 7): Ein Beitrag liest
// bei jedem Commit der Kontodatenbank neu (`observe`) und auf Anstoß von `refresh`, damit „heute“ auch
// ohne neue Eingabe zum nächsten Tag wechselt. Den gelesenen Stand löst er asynchron auf, etwa mit dem
// `PlanReader`, und meldet nur das Ergebnis der jüngsten Lesung.

/** Stößt erneutes Lesen ohne Datenbankänderung an; geteilt mit dem Partnerbereich. */
export type { Refresh };

export function observedTodaySource<K extends TodaySlot, R>(
  database: Pick<LocalDatabase, 'observe' | 'read'>,
  refresh: Refresh,
  /** Liest den Stand in einer Lesetransaktion; `null` ohne eigene Person (vor dem ersten Pull). */
  read: (tx: ReadContext) => R | null,
  /** Macht aus dem Stand den Zustand des Beitrags; scheitert sie, meldet er `invalid_payload`. */
  resolve: (reading: R) => Promise<TodayState<K>>,
): TodaySource<K> {
  return {
    subscribe(listener) {
      let latest = 0;
      let active = true;
      const publish = (reading: R | null) => {
        const request = ++latest;
        const current = () => active && request === latest;
        // Ohne eigene Person (vor dem ersten Pull) lädt der Beitrag.
        if (reading === null) return listener({ type: 'loading' } as TodayState<K>);
        resolve(reading).then(
          (state) => current() && listener(state),
          // Ein Port hat seinen Vertrag verletzt (`PortContractError`) oder ist gescheitert.
          () => current() && listener({ type: 'error', code: 'invalid_payload' } as TodayState<K>),
        );
      };
      const stopObserving = database.observe(read, publish);
      const stopRefresh = refresh(() => {
        try {
          publish(database.read(read));
        } catch (error) {
          if (!(error instanceof LocalDatabaseClosedError)) throw error;
        }
      });
      return () => {
        active = false;
        stopObserving();
        stopRefresh();
      };
    },
  };
}
