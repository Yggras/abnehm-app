import type { Clock } from '@abnehm/clock';

import type { LocalDatabase } from '../local-db';
import { observePersonHeader } from '../local-db/person-header';
import { followSource } from './followed-source';
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
  const followed = followSource<TodayState<K>>({ type: 'loading' } as TodayState<K>);
  registry.register(owner, key, followed.source);
  return followed.opened;
}
