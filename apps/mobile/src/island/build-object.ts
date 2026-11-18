import { and, eq, isNull } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';
import { EntityId } from '@abnehm/contracts/base';
import { energyBookingId } from '@abnehm/contracts/energy';
import { BuildObject, buildObjectKey, IslandRole } from '@abnehm/contracts/island';
import { decideBuild, type BuildRefusal } from '@abnehm/game-rules/building';
import { indexCatalog } from '@abnehm/game-rules/catalog';
import { gameCatalog } from '@abnehm/game-rules/content';

import { appendBooking, energyBookingEntity, readEnergy, removeUnconfirmedBooking } from '../energy';
import type { TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { blueprintUnlock, couplingMember, island, islandField, islandObject } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { LocalCommand, SyncWriter } from '../sync';

// Bauen in der App (Spezifikation 4, Abschnitte 2.5, 7 und 11; Spezifikation 0, Abschnitt 4): ein Bauplan
// auf ein eigenes freies Feld. Objekt und `build_debit` entstehen lokal sofort mit ihrer Outbox-Operation
// in einer Transaktion; die eigene Hälfte wächst damit offline. Das Gerät erlaubt den Bau nur bei
// ausreichendem lokalem Bestand (`decideBuild`). Der Server bestätigt mit den kanonischen Zeilen und dem
// neuen Inselfortschritt; lehnt er dauerhaft ab, verschwinden Objekt und Buchung in derselben Transaktion
// wie die Operation. Die eigene Hälfte ist abgeleitet und folgt von selbst.

const catalog = indexCatalog(gameCatalog);

export type BuildOutcome =
  | Readonly<{ type: 'gebaut'; islandObjectId: EntityId }>
  | BuildRefusal
  /** Nur auf dem Gerät: Das Feld ist schon belegt, oder die Insel ist noch nicht geschlüpft. */
  | Readonly<{ type: 'verboten'; reason: 'feld_belegt' | 'keine_insel' }>;

export type BuildDependencies = Readonly<{
  writer: SyncWriter;
  newId: () => EntityId;
  /** Zeitpunkt und lokaler Tag des Baus. */
  clock: Clock;
}>;

/** Baut in der Transaktion des Aufrufers; `fieldId` ist ein materialisiertes Inselfeld. */
export function buildObject(tx: TransactionContext, { writer, newId, clock }: BuildDependencies, request: Readonly<{ fieldId: EntityId; blueprintKey: string }>): BuildOutcome {
  const own = readOwnPerson(tx);
  if (own === undefined) return { type: 'verboten', reason: 'keine_insel' };
  const personId = EntityId.parse(own.id);
  const db = sqliteOf(tx);
  const field = db.select().from(islandField).where(eq(islandField.id, request.fieldId)).get();
  const current = field && db.select({ state: island.state }).from(island).where(eq(island.id, field.islandId)).get();
  const member = field && db
    .select({ role: couplingMember.role, status: couplingMember.couplingStatus })
    .from(couplingMember)
    .where(and(eq(couplingMember.couplingId, field.couplingId), eq(couplingMember.personId, personId)))
    .get();
  if (field === undefined || current?.state !== 'aktiv' || member?.role == null || member.status !== 'aktiv') return { type: 'verboten', reason: 'keine_insel' };
  const occupied = db.select({ id: islandObject.id }).from(islandObject).where(and(eq(islandObject.fieldId, field.id), isNull(islandObject.deletedAt))).get();
  if (occupied !== undefined) return { type: 'verboten', reason: 'feld_belegt' };

  const decision = decideBuild(catalog, {
    blueprintKey: request.blueprintKey,
    field: { key: field.fieldKey, ownerPersonId: field.ownerPersonId },
    person: { personId, role: IslandRole.parse(member.role) },
    unlockedBlueprints: new Set(db.select({ key: blueprintUnlock.catalogKey }).from(blueprintUnlock).where(eq(blueprintUnlock.islandId, field.islandId)).all().map((row) => row.key)),
    balance: readEnergy(tx, personId).balance,
    checkedBy: 'geraet',
  });
  if (decision.type === 'verboten') return decision;

  const { instant, localDate } = clock.read();
  const payload = BuildObject.parse({ commandId: newId(), islandObjectId: newId(), fieldId: field.id, blueprintKey: request.blueprintKey, localDate });
  const bookingId = energyBookingId(payload.commandId);
  db.insert(islandObject).values({
    id: payload.islandObjectId,
    islandId: field.islandId,
    couplingId: field.couplingId,
    ownerPersonId: personId,
    catalogKey: payload.blueprintKey,
    origin: 'gebaut',
    level: 1,
    fieldId: field.id,
    createdAt: instant,
    updatedAt: instant,
    deletedAt: null,
    serverVersion: null,
  }).run();
  appendBooking(tx, {
    type: 'build_debit',
    id: bookingId,
    personId,
    amount: -decision.price,
    localDate,
    bookingKey: payload.commandId,
    createdAt: instant,
    trigger: { commandId: payload.commandId, islandObjectId: payload.islandObjectId },
  });
  writer.command(tx, {
    type: 'buildObject',
    businessKey: buildObjectKey(payload.commandId),
    payload,
    knownServerVersion: null,
    affectedRefs: [
      { entityType: 'island_object', entityId: payload.islandObjectId },
      { entityType: energyBookingEntity.entityType, entityId: bookingId },
    ],
    referencePaths: [],
  });
  return { type: 'gebaut', islandObjectId: payload.islandObjectId };
}

/**
 * Der Fachbefehl für die lokale Befehls-Registry. Erzeugen darf ihn nur der Spieldienst (`buildObject`
 * oben), der vorher prüft; die Registry braucht ihn für die Reconciliation einer dauerhaften Ablehnung.
 */
export const buildObjectCommand: LocalCommand<BuildObject> = {
  type: 'buildObject',
  payload: BuildObject,
  referencePaths: [],
  apply() {
    throw new Error('buildObject entsteht nur im Spieldienst');
  },
  reconcileRejected(tx, operation) {
    const { commandId, islandObjectId } = BuildObject.parse(operation.payload);
    // Erst die Buchung, sie verweist auf das Objekt.
    removeUnconfirmedBooking(tx, energyBookingId(commandId));
    sqliteOf(tx).delete(islandObject).where(and(eq(islandObject.id, islandObjectId), isNull(islandObject.serverVersion))).run();
  },
};
