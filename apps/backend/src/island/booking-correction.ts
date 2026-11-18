import { eq } from 'drizzle-orm';

import { EntityId } from '@abnehm/contracts/base';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import type { DbExecutor } from '../database.ts';
import { communityProject, energyBooking, islandObject } from '../db/schema/index.ts';
import { bookCounterBooking } from '../energy/bookings.ts';
import { progressChange } from './progress-change.ts';

// Fehlerkorrektur an Spielbuchungen (Spezifikation 4, Abschnitt 1; Spezifikation 0, Abschnitt 4): nur als
// Gegenbuchung mit exaktem Gegenzeichen, serverintern und ohne Client-Befehl. Eine Gegenbuchung wirkt mit
// Gegenzeichen auf Bestand und `S_p`; war die ursprüngliche Buchung eine Ausgabe für eine Insel, berechnet
// derselbe Aufruf deren Fortschritt neu. Levelaufstieg aus einer Korrektur liefert wie beim Bauen #200.

export type BookingCorrection = Readonly<{ originalBookingId: EntityId; at: Date }>;

/** Bucht die Gegenbuchung in der Transaktion des Aufrufers und liefert alle kanonischen Änderungen. */
export async function correctBooking(tx: DbExecutor, { originalBookingId, at }: BookingCorrection): Promise<CanonicalChange[]> {
  const counter = await bookCounterBooking(tx, { originalBookingId, at });
  const islandId = await islandOfSpending(tx, originalBookingId);
  return islandId === null ? [counter] : [counter, await progressChange(tx, islandId, at)];
}

/** Die Insel, für die eine Buchung ausgegeben wurde; `null` bei Gutschriften. */
async function islandOfSpending(tx: DbExecutor, bookingId: EntityId): Promise<EntityId | null> {
  const [booking] = await tx
    .select({ objectId: energyBooking.islandObjectId, projectId: energyBooking.communityProjectId })
    .from(energyBooking)
    .where(eq(energyBooking.id, bookingId));
  if (booking?.objectId != null) {
    const [object] = await tx.select({ islandId: islandObject.islandId }).from(islandObject).where(eq(islandObject.id, booking.objectId));
    return object === undefined ? null : EntityId.parse(object.islandId);
  }
  if (booking?.projectId != null) {
    const [project] = await tx.select({ islandId: communityProject.islandId }).from(communityProject).where(eq(communityProject.id, booking.projectId));
    return project === undefined ? null : EntityId.parse(project.islandId);
  }
  return null;
}
