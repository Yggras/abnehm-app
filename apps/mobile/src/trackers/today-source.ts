import { LocalDatabaseClosedError, type LocalDatabase, type ReadContext } from '../local-db';
import type { TodaySlot, TodaySource, TodayState } from '../shell/today-registry';

// Gemeinsamer Ablauf der beobachteten Lesemodelle des Tracker-Moduls, etwa der Beiträge für „Heute“
// (Spezifikation 3, Abschnitt 7) und des Gewicht-Detailbildschirms: Ein Lesemodell liest bei jedem
// Commit der Kontodatenbank neu (`observe`) und auf Anstoß von `refresh`, damit „heute“ auch ohne neue
// Eingabe zum nächsten Tag wechselt. Den gelesenen Stand löst es asynchron auf, etwa mit dem
// `PlanReader`, und meldet nur das Ergebnis der jüngsten Lesung.

/** Stößt erneutes Lesen ohne Datenbankänderung an; die Rückgabe beendet den Anstoß. */
export type Refresh = (update: () => void) => () => void;

/** Ein beobachtetes Lesemodell; `subscribe` meldet jeden neuen Zustand, die Rückgabe beendet das. */
export type ObservedSource<S> = Readonly<{ subscribe(listener: (state: S) => void): () => void }>;

export function observedSource<R, S>(
  database: Pick<LocalDatabase, 'observe' | 'read'>,
  refresh: Refresh,
  /** Liest den Stand in einer Lesetransaktion; `null` ohne eigene Person (vor dem ersten Pull). */
  read: (tx: ReadContext) => R | null,
  /** Macht aus dem Stand den Zustand. */
  resolve: (reading: R) => Promise<S>,
  /** Zustand, solange die eigene Person fehlt, und Zustand, wenn `resolve` scheitert. */
  states: Readonly<{ loading: S; failed: S }>,
): ObservedSource<S> {
  return {
    subscribe(listener) {
      let latest = 0;
      let active = true;
      const publish = (reading: R | null) => {
        const request = ++latest;
        const current = () => active && request === latest;
        if (reading === null) return listener(states.loading);
        resolve(reading).then(
          (state) => current() && listener(state),
          // Ein Port hat seinen Vertrag verletzt (`PortContractError`) oder ist gescheitert.
          () => current() && listener(states.failed),
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

/** Beitrag für „Heute“: lädt ohne eigene Person und meldet `invalid_payload`, wenn das Auflösen scheitert. */
export function observedTodaySource<K extends TodaySlot, R>(
  database: Pick<LocalDatabase, 'observe' | 'read'>,
  refresh: Refresh,
  read: (tx: ReadContext) => R | null,
  resolve: (reading: R) => Promise<TodayState<K>>,
): TodaySource<K> {
  return observedSource(database, refresh, read, resolve, {
    loading: { type: 'loading' } as TodayState<K>,
    failed: { type: 'error', code: 'invalid_payload' } as TodayState<K>,
  });
}
