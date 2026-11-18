import { and, eq, isNull, ne } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId, ServerVersion } from '@abnehm/contracts/base';
import { energyBookingId } from '@abnehm/contracts/energy';
import { IslandRole, PlaceObject, placeObjectKey, UpgradeObject, upgradeObjectKey, type PlacementTarget } from '@abnehm/contracts/island';
import { IslandObjectOrigin } from '@abnehm/contracts/island-records';
import { decidePlacement, decideUpgrade, nextStage, type PlaceDecision, type UpgradeRefusal } from '@abnehm/game-rules/building';
import { indexCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import { appendBooking, energyBookingEntity, readEnergy, removeUnconfirmedBooking } from '../energy';
import type { TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { couplingMember, island, islandField, islandObject } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { LocalCommand, SyncWriter } from '../sync';
import { buildObjectCommand } from './build-object';

// Aufwerten und Platzieren in der App (Spezifikation 4, Abschnitte 2.5, 7 und 11; Spezifikation 0,
// Abschnitt 4; #194). Beides geht offline: Die neue Stufe samt `upgrade_debit` bzw. das neue Feld stehen
// lokal sofort mit ihrer Outbox-Operation in einer Transaktion; die eigene Hälfte wächst beim Aufwerten
// mit. Das Gerät wertet nur bei ausreichendem lokalem Bestand auf und platziert nur auf freie eigene
// Felder, nach denselben Spielregeln wie der Server. Einlagern ist Platzieren im Lager, Platzieren ist
// kostenlos. Lehnt der Server dauerhaft ab, verschwindet die Buchung und die Stufe fällt zurück; nennt die
// Ablehnung das Objekt kanonisch, übernimmt die Engine danach diesen Stand.

const catalog = indexCatalog(gameCatalog);

export type ObjectCommandDependencies = Readonly<{
  writer: SyncWriter;
  newId: () => EntityId;
  /** Zeitpunkt und lokaler Tag der Änderung. */
  clock: Clock;
}>;

/** Nur auf dem Gerät: kein eigenes Objekt einer geschlüpften, aktiven Insel, oder das Zielfeld ist belegt. */
type DeviceRefusal = Readonly<{ type: 'verboten'; reason: 'kein_eigenes_objekt' | 'feld_belegt' }>;

export type UpgradeOutcome = Readonly<{ type: 'aufgewertet'; level: 2 | 3; price: number }> | UpgradeRefusal | DeviceRefusal;

export type PlaceOutcome = Readonly<{ type: 'platziert' }> | Exclude<PlaceDecision, { type: 'erlaubt' }> | DeviceRefusal;

/** Ein eigenes, nicht gelöschtes Objekt einer aktiven Insel in aktiver Kopplung, samt eigener Rolle. */
function ownObject(tx: TransactionContext, islandObjectId: EntityId) {
  const own = readOwnPerson(tx);
  if (own === undefined) return null;
  const db = sqliteOf(tx);
  const object = db.select().from(islandObject).where(eq(islandObject.id, islandObjectId)).get();
  if (object === undefined || object.ownerPersonId !== own.id || object.deletedAt !== null) return null;
  const current = db.select({ state: island.state }).from(island).where(eq(island.id, object.islandId)).get();
  const member = db
    .select({ role: couplingMember.role, status: couplingMember.couplingStatus })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, object.couplingId), eq(couplingMember.personId, own.id)))
    .get();
  if (current?.state !== 'aktiv' || member?.role == null || member.status !== 'aktiv') return null;
  return { object: { ...object, origin: IslandObjectOrigin.parse(object.origin) }, personId: EntityId.parse(own.id), role: IslandRole.parse(member.role) };
}

const noOwnObject = { type: 'verboten', reason: 'kein_eigenes_objekt' } as const;

/** Wertet ein eigenes gebautes Objekt um genau eine Stufe auf, in der Transaktion des Aufrufers. */
export function upgradeObject(tx: TransactionContext, { writer, newId, clock }: ObjectCommandDependencies, request: Readonly<{ islandObjectId: EntityId }>): UpgradeOutcome {
  const found = ownObject(tx, request.islandObjectId);
  if (found === null) return noOwnObject;
  const { object, personId } = found;
  const toLevel = nextStage(object.level);
  if (toLevel === null) return { type: 'verboten', reason: 'falsche_stufe' };
  const decision = decideUpgrade(catalog, { object, toLevel, balance: readEnergy(tx, personId).balance, checkedBy: 'geraet' });
  if (decision.type === 'verboten') return decision;

  const { instant, localDate } = clock.read();
  const payload = UpgradeObject.parse({ commandId: newId(), islandObjectId: object.id, toLevel, localDate });
  const bookingId = energyBookingId(payload.commandId);
  sqliteOf(tx).update(islandObject).set({ level: toLevel, updatedAt: instant }).where(eq(islandObject.id, object.id)).run();
  appendBooking(tx, {
    type: 'upgrade_debit',
    id: bookingId,
    personId,
    amount: -decision.price,
    localDate,
    bookingKey: payload.commandId,
    createdAt: instant,
    trigger: { commandId: payload.commandId, islandObjectId: payload.islandObjectId, toLevel },
  });
  writer.command(tx, {
    type: 'upgradeObject',
    businessKey: upgradeObjectKey(payload.commandId),
    payload,
    knownServerVersion: ServerVersion.nullable().parse(object.serverVersion),
    affectedRefs: [
      { entityType: 'island_object', entityId: payload.islandObjectId },
      { entityType: energyBookingEntity.entityType, entityId: bookingId },
    ],
    referencePaths: [],
  });
  return { type: 'aufgewertet', level: toLevel, price: decision.price };
}

/** Stellt ein eigenes Objekt auf ein freies eigenes Feld oder legt es ins Lager, in der Transaktion des Aufrufers. */
export function placeObject(tx: TransactionContext, { writer, newId, clock }: ObjectCommandDependencies, request: Readonly<{ islandObjectId: EntityId; target: PlacementTarget }>): PlaceOutcome {
  const found = ownObject(tx, request.islandObjectId);
  if (found === null) return noOwnObject;
  const { object, personId, role } = found;
  const db = sqliteOf(tx);
  const fieldId = request.target.type === 'feld' ? request.target.fieldId : null;
  if (fieldId !== null) {
    const field = db.select().from(islandField).where(eq(islandField.id, fieldId)).get();
    if (field === undefined || field.islandId !== object.islandId) return { type: 'verboten', reason: 'fremdes_feld' };
    const occupied = db
      .select({ id: islandObject.id })
      .from(islandObject)
      .where(and(eq(islandObject.fieldId, fieldId), isNull(islandObject.deletedAt), ne(islandObject.id, object.id)))
      .get();
    if (occupied !== undefined) return { type: 'verboten', reason: 'feld_belegt' };
    const decision = decidePlacement(catalog, { object, field: { key: field.fieldKey, ownerPersonId: field.ownerPersonId }, person: { personId, role } });
    if (decision.type === 'verboten') return decision;
  }

  const payload = PlaceObject.parse({ commandId: newId(), islandObjectId: object.id, fromFieldId: object.fieldId, target: request.target });
  db.update(islandObject).set({ fieldId, updatedAt: clock.read().instant }).where(eq(islandObject.id, object.id)).run();
  writer.command(tx, {
    type: 'placeObject',
    businessKey: placeObjectKey(payload.commandId),
    payload,
    knownServerVersion: ServerVersion.nullable().parse(object.serverVersion),
    affectedRefs: [{ entityType: 'island_object', entityId: payload.islandObjectId }],
    referencePaths: [],
  });
  return { type: 'platziert' };
}

/**
 * Die Fachbefehle für die lokale Befehls-Registry. Erzeugen darf sie nur der Spieldienst (oben), der
 * vorher prüft; die Registry braucht sie für die Reconciliation einer dauerhaften Ablehnung.
 */
export const upgradeObjectCommand: LocalCommand<UpgradeObject> = {
  type: 'upgradeObject',
  payload: UpgradeObject,
  referencePaths: [],
  apply() {
    throw new Error('upgradeObject entsteht nur im Spieldienst');
  },
  reconcileRejected(tx, operation) {
    const { commandId, islandObjectId, toLevel } = UpgradeObject.parse(operation.payload);
    removeUnconfirmedBooking(tx, energyBookingId(commandId));
    // Die Stufe fällt zurück; nennt die Ablehnung das Objekt, übernimmt die Engine danach dessen Stand.
    sqliteOf(tx)
      .update(islandObject)
      .set({ level: toLevel - 1 })
      .where(and(eq(islandObject.id, islandObjectId), eq(islandObject.level, toLevel)))
      .run();
  },
};

export const placeObjectCommand: LocalCommand<PlaceObject> = {
  type: 'placeObject',
  payload: PlaceObject,
  referencePaths: [],
  apply() {
    throw new Error('placeObject entsteht nur im Spieldienst');
  },
  // Das Objekt kehrt auf sein früheres Feld bzw. ins Lager zurück, sofern es noch am Ziel steht und das
  // frühere Feld frei ist (sonst ins Lager). Nennt die Ablehnung das Objekt kanonisch, übernimmt die Engine
  // danach diesen Stand; ohne ihn, etwa bei `forbidden`, bleibt dieser Rückfall (Spezifikation 4, Abschnitt 11).
  reconcileRejected(tx, operation) {
    const { islandObjectId, fromFieldId, target } = PlaceObject.parse(operation.payload);
    const db = sqliteOf(tx);
    const object = db.select({ fieldId: islandObject.fieldId }).from(islandObject).where(eq(islandObject.id, islandObjectId)).get();
    if (object === undefined || object.fieldId !== (target.type === 'feld' ? target.fieldId : null)) return;
    const taken =
      fromFieldId !== null &&
      db
        .select({ id: islandObject.id })
        .from(islandObject)
        .where(and(eq(islandObject.fieldId, fromFieldId), isNull(islandObject.deletedAt), ne(islandObject.id, islandObjectId)))
        .get() !== undefined;
    db.update(islandObject).set({ fieldId: taken ? null : fromFieldId }).where(eq(islandObject.id, islandObjectId)).run();
  },
};

/** Alle Fachbefehle auf Inselobjekten für die lokale Befehls-Registry: Bauen (#191), Aufwerten und Platzieren. */
export const islandObjectCommands = [buildObjectCommand, upgradeObjectCommand, placeObjectCommand] as readonly LocalCommand[];
