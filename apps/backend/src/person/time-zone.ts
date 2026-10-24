import { eq } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';
import { personOfTimeZoneKey, UpdatePersonTimeZone } from '@abnehm/contracts/person';

import { policies } from '../authorization/authorization.ts';
import { person } from '../db/schema/index.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import type { ServerCommand } from '../sync/commands.ts';
import { personEntity } from '../sync/person-entity.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';

// Fachbefehl `updatePersonTimeZone` (Spezifikation 0, Abschnitt 8): ändert ausschließlich `time_zone`
// der eigenen Person. Ein veralteter Person-Datensatz auf dem sendenden Gerät kann so keine anderen
// Felder überschreiben, und der allgemeine Upsert setzt die Zone nie zurück. Zwischen zwei Geräten
// gilt Last-Write-Wins in Server-Eingangsreihenfolge.

/**
 * Ziel eines Schlüssels ohne lesbare Person. Diese ID vergibt der Bootstrap nie (er erzeugt zufällige
 * UUIDs), und eine Person legt nur er an (`creatable: false`); die Autorisierung verweigert den Befehl
 * daher als `forbidden`, wie bei einer fremden Person.
 */
const noPerson = '00000000-0000-4000-8000-000000000000';

export const personTimeZoneCommand: ServerCommand<UpdatePersonTimeZone> = {
  type: 'updatePersonTimeZone',
  identity: 'none',
  policy: policies.resource('person', 'befehl'),
  payload: UpdatePersonTimeZone,
  target: (operation) => ({ id: personOfTimeZoneKey(operation.businessKey) ?? noPerson }),
  canonicalRequest: (operation) => UpdatePersonTimeZone.parse(operation.payload),
  // Jede Änderung trägt einen eigenen Schlüssel; ein Duplikat ist nur der Retry derselben Änderung.
  duplicate: () => [],
  async execute(tx, { actor, payload, at }) {
    const personId = EntityId.parse(actor.personId);
    const [current] = await tx.select({ timeZone: person.timeZone }).from(person).where(eq(person.id, personId));
    if (current === undefined) throw new Error('Person fehlt trotz Autorisierung');
    // Dieselbe Zone erzeugt keine neue Version; das Ergebnis nennt trotzdem den kanonischen Stand.
    if (current.timeZone !== payload.timeZone) {
      const serverVersion = await nextServerVersion(tx);
      await tx.update(person).set({ timeZone: payload.timeZone, updatedAt: at, serverVersion }).where(eq(person.id, personId));
      await recordChange(tx, { position: serverVersion, entityType: 'person', entityId: personId, operation: 'upsert',
        ownerPersonId: personId, createdAt: at });
    }
    return { changes: [await canonicalAfterWrite(tx, personEntity, personId)], idMappings: [] };
  },
};
