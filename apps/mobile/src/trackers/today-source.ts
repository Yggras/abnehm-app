import type { LocalDatabase, ReadContext } from '../local-db';
import type { TodaySlot, TodaySource, TodayState } from '../shell/today-registry';
import { observedSource, type Refresh } from './observed-source';

export type { Refresh } from './observed-source';

// Gemeinsamer Ablauf der Tracker-Beiträge für „Heute“ (Spezifikation 3, Abschnitt 7) über `observedSource`.

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
