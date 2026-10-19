import { EntityId, type TimeZone } from '@abnehm/contracts/base';
import { personTimeZoneKey, UpdatePersonTimeZone } from '@abnehm/contracts/person';

import type { LocalDatabase } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import type { LocalCommand, LocalCommandRegistry } from './commands';
import { pendingCommandPayloads } from './outbox';

// Fachbefehl `updatePersonTimeZone` der App (Spezifikation 0, Abschnitt 8). Er ändert lokal nichts
// vorab: Die Zeile der Person übernimmt die Zone erst mit dem kanonischen Ergebnis des Servers. So
// braucht eine Ablehnung keine Reconciliation, und ein veralteter lokaler Person-Datensatz reist nie
// mit. Welche Zone zuletzt vorgemerkt ist, steht in der Outbox.

export const personTimeZoneCommand: LocalCommand<UpdatePersonTimeZone> = {
  type: 'updatePersonTimeZone',
  payload: UpdatePersonTimeZone,
  referencePaths: [],
  apply: () => [],
  reconcileRejected: () => {},
};

export type PersonTimeZoneRequest = 'requested' | 'unchanged' | 'no_person';

/**
 * Merkt die Zone für die eigene Person vor, wenn sie von der zuletzt vorgemerkten beziehungsweise, ohne
 * offenen Befehl, von der kanonischen Zone abweicht. Vor dem ersten Pull gibt es noch keine Person.
 */
export function requestPersonTimeZone(
  database: LocalDatabase,
  commands: LocalCommandRegistry,
  timeZone: TimeZone,
  newId: () => EntityId,
): PersonTimeZoneRequest {
  const known = database.read((tx) => {
    const own = readOwnPerson(tx);
    if (own === undefined) return null;
    const pending = pendingCommandPayloads(tx, 'updatePersonTimeZone').at(-1);
    return { personId: EntityId.parse(own.id), timeZone: pending === undefined ? own.timeZone : UpdatePersonTimeZone.parse(pending).timeZone };
  });
  if (known === null) return 'no_person';
  if (known.timeZone === timeZone) return 'unchanged';
  commands.execute('updatePersonTimeZone', personTimeZoneKey(known.personId, newId()), { timeZone });
  return 'requested';
}
