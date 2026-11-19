import { eq } from 'drizzle-orm';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { energyBookingId, summarizeEnergy } from '@abnehm/contracts/energy';
import { PlaceObject, placeObjectKey, UpgradeObject, upgradeObjectKey } from '@abnehm/contracts/island';
import { IslandObjectOrigin } from '@abnehm/contracts/island-records';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import { decidePlacement, decideUpgrade } from '@abnehm/game-rules/building';
import { indexCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import { policies } from '../authorization/authorization.ts';
import { changeWriter, updated } from '../coupling/change-writer.ts';
import type { DbExecutor } from '../database.ts';
import { islandField, islandObject } from '../db/schema/index.ts';
import { insertBooking, readBookings } from '../energy/bookings.ts';
import { CommandRejection, type ServerCommand } from '../sync/commands.ts';
import { canonicalAfterWrite } from '../sync/sync.ts';
import { vacateField } from './field-occupancy.ts';
import { gameRejection, type GameRefusal } from './game-rejection.ts';
import { islandObjectEntity } from './island-entities.ts';
import { playingRole } from './playing-role.ts';
import { progressChanges } from './progress-change.ts';

// Aufwerten und Platzieren auf dem Server (Spezifikation 4, Abschnitte 2.5, 3, 7 und 11; Spezifikation 0,
// Abschnitte 4 und 10; #194). Die Autorisierung (`island_object_own`) lässt nur eigene, nicht gelöschte
// Objekte in einer aktiven Kopplung zu und beim Platzieren nur ein eigenes Zielfeld derselben Insel. Hier
// prüfen die Spielregeln Katalogschlüssel, Stufe, Platzierung und die Schutzgrenze −30.
//
// Eine fachliche Ablehnung nennt das Objekt in seinem kanonischen Zustand; das Gerät übernimmt ihn
// (Spezifikation 0, Abschnitt 10). So landet etwa eine auf zwei Geräten doppelt vorgemerkte Aufwertung
// genau einmal auf dem Server, und das zweite Gerät zeigt danach die Stufe des ersten.
//
// Hebt eine Aufwertung die Insel auf ein neues Level, entstehen Freischaltungen, Ereignis und Intents im
// selben Befehl (`progressChanges`, #200).

const catalog = indexCatalog(gameCatalog);

/**
 * Das Objekt samt Rolle der Person, gelesen nach erfolgreicher Autorisierung; die Insel muss geschlüpft
 * und aktiv sein.
 */
async function activeObject(tx: DbExecutor, islandObjectId: EntityId, personId: EntityId) {
  const [object] = await tx.select().from(islandObject).where(eq(islandObject.id, islandObjectId));
  if (object === undefined) throw new Error('Inselobjekt fehlt trotz Autorisierung');
  const role = await playingRole(tx, { islandId: object.islandId, couplingId: EntityId.parse(object.couplingId), personId });
  if (role === null) throw new CommandRejection('conflict', await canonicalAfterWrite(tx, islandObjectEntity, islandObjectId));
  return { object: { ...object, origin: IslandObjectOrigin.parse(object.origin) }, role };
}

/** Lehnt nach den Spielregeln ab und nennt dabei den kanonischen Zustand des Objekts. */
async function refuse(tx: DbExecutor, islandObjectId: EntityId, refusal: GameRefusal): Promise<never> {
  throw gameRejection(refusal, await canonicalAfterWrite(tx, islandObjectEntity, islandObjectId));
}

export const upgradeObjectCommand: ServerCommand<UpgradeObject> = {
  type: 'upgradeObject',
  identity: 'none',
  policy: policies.resource('island_object_own', 'befehl'),
  payload: UpgradeObject,
  target: (operation) => ({ id: UpgradeObject.parse(operation.payload).islandObjectId }),
  canonicalRequest: (operation) => UpgradeObject.parse(operation.payload),
  // Alle IDs vergibt das Gerät; ein Duplikat ist nur der Retry derselben Aufwertung.
  duplicate: () => [],
  async execute(tx, { actor, resource, payload, businessKey, at }) {
    if (businessKey !== upgradeObjectKey(payload.commandId)) throw new CommandRejection('invalid_payload');
    const couplingId = EntityId.parse(resource.couplingId);
    const { object } = await activeObject(tx, payload.islandObjectId, actor.personId);
    const bookings = (await readBookings(tx, [actor.personId])).get(actor.personId)!;
    const decision = decideUpgrade(catalog, {
      object: { catalogKey: object.catalogKey, origin: object.origin, level: object.level },
      toLevel: payload.toLevel,
      balance: summarizeEnergy(bookings).balance,
      checkedBy: 'server',
    });
    if (decision.type === 'verboten') return refuse(tx, payload.islandObjectId, decision);

    await changeWriter(tx, at)({ entityType: 'island_object', couplingId }, async (stamp) => {
      await tx.update(islandObject).set({ level: payload.toLevel, ...updated(stamp) }).where(eq(islandObject.id, payload.islandObjectId));
      return payload.islandObjectId;
    });
    const changes: CanonicalChange[] = [await canonicalAfterWrite(tx, islandObjectEntity, payload.islandObjectId)];
    // Nach dem Objekt, damit die Buchung auf jedem Gerät erst nach ihrer Stufe ankommt.
    changes.push(
      await insertBooking(tx, {
        type: 'upgrade_debit',
        id: energyBookingId(payload.commandId),
        personId: actor.personId,
        amount: -decision.price,
        localDate: payload.localDate,
        bookingKey: payload.commandId,
        createdAt: Instant.parse(at.toISOString()),
        trigger: { commandId: payload.commandId, islandObjectId: payload.islandObjectId, toLevel: payload.toLevel },
      }),
    );
    changes.push(...(await progressChanges(tx, EntityId.parse(object.islandId), at)));
    return { changes, idMappings: [] };
  },
};

export const placeObjectCommand: ServerCommand<PlaceObject> = {
  type: 'placeObject',
  identity: 'none',
  policy: policies.resource('island_object_own', 'befehl'),
  payload: PlaceObject,
  target(operation) {
    const { islandObjectId, target } = PlaceObject.parse(operation.payload);
    return target.type === 'feld' ? { id: islandObjectId, fieldId: target.fieldId } : { id: islandObjectId };
  },
  canonicalRequest: (operation) => PlaceObject.parse(operation.payload),
  // Platzieren legt nichts an; ein Duplikat ist nur der Retry derselben Platzierung.
  duplicate: () => [],
  async execute(tx, { actor, resource, payload, businessKey, at }) {
    if (businessKey !== placeObjectKey(payload.commandId)) throw new CommandRejection('invalid_payload');
    const couplingId = EntityId.parse(resource.couplingId);
    const { object, role } = await activeObject(tx, payload.islandObjectId, actor.personId);
    const fieldId = payload.target.type === 'feld' ? payload.target.fieldId : null;
    if (fieldId !== null) {
      const [field] = await tx.select().from(islandField).where(eq(islandField.id, fieldId));
      if (field === undefined) throw new Error('Inselfeld fehlt trotz Autorisierung');
      const decision = decidePlacement(catalog, {
        object: { catalogKey: object.catalogKey, origin: object.origin },
        field: { key: field.fieldKey, ownerPersonId: field.ownerPersonId },
        person: { personId: actor.personId, role },
      });
      if (decision.type === 'verboten') return refuse(tx, payload.islandObjectId, decision);
    }
    // Steht das Objekt schon dort, ändert sich nichts; die Antwort nennt seinen Zustand.
    if (object.fieldId === fieldId) return { changes: [await canonicalAfterWrite(tx, islandObjectEntity, payload.islandObjectId)], idMappings: [] };

    const changes: CanonicalChange[] = fieldId === null ? [] : await vacateField(tx, { fieldId, couplingId, incoming: payload.islandObjectId, at });
    await changeWriter(tx, at)({ entityType: 'island_object', couplingId }, async (stamp) => {
      await tx.update(islandObject).set({ fieldId, ...updated(stamp) }).where(eq(islandObject.id, payload.islandObjectId));
      return payload.islandObjectId;
    });
    changes.push(await canonicalAfterWrite(tx, islandObjectEntity, payload.islandObjectId));
    return { changes, idMappings: [] };
  },
};
