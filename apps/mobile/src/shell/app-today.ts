import type { Clock } from '@abnehm/clock';

import type { LocalDatabase } from '../local-db';
import { observePersonHeader } from '../local-db/person-header';
import { registerTodayHeader, type HeaderPerson } from './header-source';
import { createTodayRegistry, type TodayRegistry } from './today-registry';

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
  let current: LocalDatabase | null = null;
  const followers = new Set<() => void>();
  const changed = () => {
    for (const follow of followers) follow();
  };
  registerTodayHeader(registry, clock, (listener) => {
    let stop: (() => void) | null = null;
    const follow = () => {
      stop?.();
      stop = null;
      if (current === null) listener(null);
      else stop = observe(current, listener);
    };
    followers.add(follow);
    follow();
    return () => {
      followers.delete(follow);
      stop?.();
    };
  });
  return (database) => {
    current = database;
    changed();
    return () => {
      if (current !== database) return;
      current = null;
      changed();
    };
  };
}
