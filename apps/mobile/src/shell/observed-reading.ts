import { LocalDatabaseClosedError, type LocalDatabase, type ReadContext } from '../local-db';
import type { Refresh } from './followed-source';

/**
 * Gemeinsamer Kern der Lesemodelle von „Heute“ und der Bereichsbildschirme: Liest in einer
 * Lesetransaktion sofort und nach jedem Commit der Kontodatenbank (`observe`), dazu auf Anstoß von
 * `refresh`, damit „heute“ ohne neue Eingabe zum nächsten Tag wechselt. Nach dem Sperren des Kontos
 * meldet ein Anstoß nichts mehr; die App-Sitzung löst das Lesemodell gleich. Die Rückgabe beendet beides.
 */
export function observeWithRefresh<T>(
  database: Pick<LocalDatabase, 'observe' | 'read'>,
  refresh: Refresh,
  read: (tx: ReadContext) => T,
  listener: (value: T) => void,
): () => void {
  const stopObserving = database.observe(read, listener);
  const stopRefresh = refresh(() => {
    let value: T;
    try {
      value = database.read(read);
    } catch (error) {
      if (error instanceof LocalDatabaseClosedError) return;
      throw error;
    }
    listener(value);
  });
  return () => {
    stopObserving();
    stopRefresh();
  };
}
