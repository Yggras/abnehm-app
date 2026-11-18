import { and, eq, isNull } from 'drizzle-orm';

import type { EntityId, ServerVersion } from '@abnehm/contracts/base';
import { bookingReferences, EnergyBooking, summarizeEnergy } from '@abnehm/contracts/energy';

import type { ReadContext, TransactionContext } from '../local-db';
import { energyBooking } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { immutableDayEntity } from '../sync';

// Energiebuchungen der App (Spezifikation 0, Abschnitt 4). Buchungen sind unveränderlich: Es gibt nur
// Anlegen und Lesen. Korrigiert wird mit einer Gegenbuchung, die der Server anlegt und der Sync bringt.
// Art, Vorzeichen und Buchungsschlüssel prüft das Vertragsschema, Eindeutigkeit der Schlüssel die Tabelle.

/** Legt eine Buchung an; eine ungültige Art oder ein verbotenes Vorzeichen scheitern vor dem Schreiben. */
export function appendBooking(tx: TransactionContext, booking: EnergyBooking): void {
  sqliteOf(tx).insert(energyBooking).values(rowOf(EnergyBooking.parse(booking), null)).run();
}

/** Energiebestand und Beitrag zur eigenen Levelhälfte. Den angezeigten Bestand liefert `shownEnergy`. */
export function readEnergy(tx: ReadContext, personId: EntityId): { balance: number; levelHalf: number } {
  return summarizeEnergy(bookingsOf(tx, personId));
}

/** Alle Buchungen einer Person, etwa für die verbaute Energie je Insel (`spentOnIsland`). */
export function bookingsOf(tx: ReadContext, personId: EntityId): EnergyBooking[] {
  return sqliteOf(tx).select().from(energyBooking).where(eq(energyBooking.personId, personId)).all().map(bookingOf);
}

/**
 * Die Buchung zu einem Buchungsschlüssel, etwa `tagesziel:<person>:<tag>:<platz>`. Über den Schlüssel
 * erkennt Spezifikation 4 erstmalige Gutschriften dauerhaft, auch nachdem der Sync ein Duplikat ersetzt hat.
 */
export function bookingByKey(tx: ReadContext, bookingKey: string): EnergyBooking | null {
  const row = sqliteOf(tx).select().from(energyBooking).where(eq(energyBooking.bookingKey, bookingKey)).get();
  return row === undefined ? null : bookingOf(row);
}

/** Lokal unbestätigte Buchung entfernen, wenn der Server ihren Fachbefehl dauerhaft abgelehnt hat. */
export function removeUnconfirmedBooking(tx: TransactionContext, bookingId: EntityId): void {
  sqliteOf(tx).delete(energyBooking).where(and(eq(energyBooking.id, bookingId), isNull(energyBooking.serverVersion))).run();
}

/** Sync-Entität: Buchungen kommen nur als kanonische Datensätze, nie als Upsert oder Löschung. */
export const energyBookingEntity = immutableDayEntity({
  entityType: 'energy_booking',
  ownerField: 'personId',
  record: EnergyBooking,
  table: energyBooking,
  row: (booking) => rowOf(booking, null),
});

function rowOf(booking: EnergyBooking, serverVersion: ServerVersion | null): typeof energyBooking.$inferInsert {
  return {
    id: booking.id,
    personId: booking.personId,
    type: booking.type,
    amount: booking.amount,
    localDate: booking.localDate,
    bookingKey: booking.bookingKey,
    trigger: booking.trigger,
    ...bookingReferences(booking),
    createdAt: booking.createdAt,
    serverVersion,
  };
}

function bookingOf(row: typeof energyBooking.$inferSelect): EnergyBooking {
  const { id, personId, type, amount, localDate, bookingKey, trigger, createdAt } = row;
  return EnergyBooking.parse({ id, personId, type, amount, localDate, bookingKey, trigger, createdAt });
}
