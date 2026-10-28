import type { Clock } from '@abnehm/clock';

import type { LocalDatabase } from '../local-db';
import { observePersonHeader } from '../local-db/person-header';
import { todayHeaderSource, type HeaderPerson } from './header-source';
import { createTodayRegistry, type TodayOwner, type TodayRegistry, type TodaySlot, type TodaySource, type TodayState } from './today-registry';

/** Composition Root der Heute-Beiträge. Bereiche registrieren genau ihren Slot, bevor Heute gerendert wird. */
export const appTodayRegistry = createTodayRegistry();

type ObservePerson = (database: LocalDatabase, listener: (person: HeaderPerson | null) => void) => () => void;

/**
 * Registriert den Kopf von „Heute“ einmal, bevor Heute gerendert wird; er folgt der jeweils geöffneten
 * Kontodatenbank. Die App-Sitzung meldet jede geöffnete Datenbank über die Rückgabe und löst sie mit
 * deren Rückgabe beim Sperren wieder. Ohne geöffnete Datenbank lädt der Kopf. Kein Cross-Area-Tabellenzugriff.
 */
export function followTodayPerson(
  registry: TodayRegistry,
  clock: Clock,
  observe: ObservePerson = observePersonHeader,
): (database: LocalDatabase) => () => void {
  const opened = followTodayContribution(registry, 'fundament', 'header');
  return (database) => opened(todayHeaderSource(clock, (listener) => observe(database, listener)));
}

/**
 * Registriert den Beitrag eines Bereichs einmal, bevor „Heute“ gerendert wird. Die App-Sitzung meldet
 * über die Rückgabe die Quelle des jeweils geöffneten Kontos und löst sie mit deren Rückgabe beim
 * Sperren wieder; ohne geöffnetes Konto lädt der Beitrag.
 */
export function followTodayContribution<K extends TodaySlot>(
  registry: TodayRegistry,
  owner: TodayOwner,
  key: K,
): (source: TodaySource<K>) => () => void {
  let current: TodaySource<K> | null = null;
  const followers = new Set<() => void>();
  const changed = () => {
    for (const follow of followers) follow();
  };
  registry.register(owner, key, {
    subscribe(listener) {
      let stop: (() => void) | null = null;
      const follow = () => {
        stop?.();
        stop = null;
        if (current === null) listener({ type: 'loading' } as TodayState<K>);
        else stop = current.subscribe(listener);
      };
      followers.add(follow);
      follow();
      return () => {
        followers.delete(follow);
        stop?.();
      };
    },
  });
  return (source) => {
    current = source;
    changed();
    return () => {
      if (current !== source) return;
      current = null;
      changed();
    };
  };
}
