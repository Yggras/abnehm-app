import type { Clock } from '@abnehm/clock';

import type { LocalDatabase } from '../local-db';
import { observePersonHeader } from '../local-db/person-header';
import { registerTodayHeader } from './header-source';
import { createTodayRegistry } from './today-registry';

/** Composition Root der Heute-Beiträge. Bereiche registrieren genau ihren Slot, bevor Heute gerendert wird. */
export const appTodayRegistry = createTodayRegistry();

/** Die App-Session ruft dies nach Öffnen der eigenen Kontodatenbank auf; kein Cross-Area-Tabellenzugriff. */
export function attachTodayPerson(database: LocalDatabase, clock: Clock) {
  return registerTodayHeader(appTodayRegistry, clock, (listener) => observePersonHeader(database, listener));
}
