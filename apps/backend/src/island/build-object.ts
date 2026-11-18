import { and, eq } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { energyBookingId, summarizeEnergy } from '@abnehm/contracts/energy';
import { BuildObject, buildObjectKey, IslandRole } from '@abnehm/contracts/island';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import { decideBuild } from '@abnehm/game-rules/building';
import { indexCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import { policies } from '../authorization/authorization.ts';
import { changeWriter } from '../coupling/change-writer.ts';
import { blueprintUnlock, couplingMember, island, islandField, islandObject } from '../db/schema/index.ts';
import { insertBooking, readBookings } from '../energy/bookings.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { vacateField } from './field-occupancy.ts';
import { gameRejection } from './game-rejection.ts';
import { islandObjectEntity } from './island-entities.ts';
import { progressChange } from './progress-change.ts';

// Bauen auf dem Server (Spezifikation 4, Abschnitte 2.5, 3, 7 und 11; Spezifikation 0, Abschnitt 4): Objekt,
// Feldbelegung und `build_debit` atomar in einem Fachbefehl, dazu der neu berechnete Inselfortschritt.
// Die Autorisierung (`island_field_build`) lässt nur eigene Felder in einer aktiven Kopplung zu. Hier
// prüfen die Spielregeln Katalogschlüssel, Freischaltung, Platzierung und die Schutzgrenze −30
// (`decideBuild`). Den Preis rechnet der Server selbst; die Nutzlast nennt keinen.
//
// Ist das Feld auf dem Server schon belegt, weil ein anderes eigenes Gerät offline darauf gebaut hat,
// gilt die Server-Eingangsreihenfolge wie bei `placeObject` (`field-occupancy.ts`): Das ältere Objekt
// wechselt atomar ins Lager. Festlegung in #191, weil die Spezifikation den Feldkonflikt nur für
// `placeObject` nennt.
//
// Levelaufstieg samt Freischaltungen, Ereignis und Intents im selben Befehl liefert #200.

const catalog = indexCatalog(gameCatalog);

export const buildObjectCommand: ServerCommand<BuildObject> = {
  type: 'buildObject',
  identity: 'none',
  policy: policies.resource('island_field_build', 'befehl'),
  payload: BuildObject,
  target: (operation) => ({ id: BuildObject.parse(operation.payload).fieldId }),
  canonicalRequest: (operation) => BuildObject.parse(operation.payload),
  // Alle IDs vergibt das Gerät; ein Duplikat ist nur der Retry desselben Baus.
  duplicate: () => [],
  async execute(tx, { actor, resource, payload, businessKey, at }) {
    if (businessKey !== buildObjectKey(payload.commandId)) throw new CommandRejection('invalid_payload');
    const couplingId = EntityId.parse(resource.couplingId);
    const [field] = await tx.select().from(islandField).where(eq(islandField.id, payload.fieldId));
    if (field === undefined) throw new Error('Inselfeld fehlt trotz Autorisierung');
    const islandId = EntityId.parse(field.islandId);
    const [current] = await tx.select({ state: island.state }).from(island).where(eq(island.id, islandId));
    if (current?.state !== 'aktiv') throw new CommandRejection('conflict');
    const [member] = await tx
      .select({ role: couplingMember.role })
      .from(couplingMember)
      .where(and(eq(couplingMember.couplingId, couplingId), eq(couplingMember.personId, actor.personId)));
    if (member?.role == null) throw new CommandRejection('conflict');
    const unlocked = await tx.select({ key: blueprintUnlock.catalogKey }).from(blueprintUnlock).where(eq(blueprintUnlock.islandId, islandId));
    const bookings = (await readBookings(tx, [actor.personId])).get(actor.personId)!;

    const decision = decideBuild(catalog, {
      blueprintKey: payload.blueprintKey,
      field: { key: field.fieldKey, ownerPersonId: field.ownerPersonId },
      person: { personId: actor.personId, role: IslandRole.parse(member.role) },
      unlockedBlueprints: new Set(unlocked.map((row) => row.key)),
      balance: summarizeEnergy(bookings).balance,
      checkedBy: 'server',
    });
    if (decision.type === 'verboten') throw gameRejection(decision);

    const changes: CanonicalChange[] = await vacateField(tx, { fieldId: EntityId.parse(field.id), couplingId, incoming: payload.islandObjectId, at });
    await changeWriter(tx, at)({ entityType: 'island_object', couplingId }, async (stamp) => {
      await tx.insert(islandObject).values({
        id: payload.islandObjectId,
        islandId,
        couplingId,
        ownerPersonId: actor.personId,
        catalogKey: payload.blueprintKey,
        origin: 'gebaut',
        level: 1,
        fieldId: field.id,
        ...stamp,
      });
      return payload.islandObjectId;
    });
    changes.push(await canonicalAfterWrite(tx, islandObjectEntity, payload.islandObjectId));
    // Nach dem Objekt, damit die Buchung auf jedem Gerät erst nach ihrem Objekt ankommt.
    changes.push(
      await insertBooking(tx, {
        type: 'build_debit',
        id: energyBookingId(payload.commandId),
        personId: actor.personId,
        amount: -decision.price,
        localDate: payload.localDate,
        bookingKey: payload.commandId,
        createdAt: Instant.parse(at.toISOString()),
        trigger: { commandId: payload.commandId, islandObjectId: payload.islandObjectId },
      }),
    );
    changes.push(await progressChange(tx, islandId, at));
    return { changes, idMappings: [] };
  },
};
