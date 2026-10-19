import { eq } from 'drizzle-orm';

import { EntityId, LocalDate, type ServerVersion } from '@abnehm/contracts/base';
import { EnergyBooking, summarizeEnergy } from '@abnehm/contracts/energy';

import type { ReadContext, TransactionContext } from '../local-db';
import { energyBooking } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { SyncEntityAdapter } from '../sync';

// Energiebuchungen der App (Spezifikation 0, Abschnitt 4). Buchungen sind unveränderlich: Es gibt nur
// Anlegen und Lesen. Korrigiert wird mit einer Gegenbuchung, die der Server anlegt und der Sync bringt.
// Art, Vorzeichen und Buchungsschlüssel prüft das Vertragsschema, Eindeutigkeit der Schlüssel die Tabelle.

/** Legt eine Buchung an; eine ungültige Art oder ein verbotenes Vorzeichen scheitern vor dem Schreiben. */
export function appendBooking(tx: TransactionContext, booking: EnergyBooking): void {
  sqliteOf(tx).insert(energyBooking).values(rowOf(EnergyBooking.parse(booking), null)).run();
}

/** Energiebestand und Beitrag zur eigenen Levelhälfte. Den angezeigten Bestand liefert `shownEnergy`. */
export function readEnergy(tx: ReadContext, personId: EntityId): { balance: number; levelHalf: number } {
  return summarizeEnergy(sqliteOf(tx).select().from(energyBooking).where(eq(energyBooking.personId, personId)).all().map(bookingOf));
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
  const row = sqliteOf(tx).select({ serverVersion: energyBooking.serverVersion }).from(energyBooking).where(eq(energyBooking.id, bookingId)).get();
  if (row !== undefined && row.serverVersion === null) sqliteOf(tx).delete(energyBooking).where(eq(energyBooking.id, bookingId)).run();
}

/** Sync-Entität: Buchungen kommen nur als kanonische Datensätze, nie als Upsert oder Löschung. */
export const energyBookingEntity: SyncEntityAdapter<never, EnergyBooking> = {
  entityType: 'energy_booking',
  ownerField: 'personId',
  upsert: null,
  deletable: false,
  record: EnergyBooking,
  applyCanonical(tx, { entityId, serverVersion, data }) {
    if (data.id !== entityId) throw new Error('Energiebuchung mit abweichender ID');
    const local = sqliteOf(tx).select({ serverVersion: energyBooking.serverVersion }).from(energyBooking).where(eq(energyBooking.id, entityId)).get();
    if (local?.serverVersion != null && BigInt(local.serverVersion) > BigInt(serverVersion)) return;
    // Ein lokales Duplikat derselben ID wird vollständig durch den kanonischen Datensatz ersetzt.
    const row = rowOf(data, serverVersion);
    sqliteOf(tx).insert(energyBooking).values(row).onConflictDoUpdate({ target: energyBooking.id, set: row }).run();
  },
  applyTombstone() {
    throw new Error('Energiebuchungen sind unveränderlich und werden nie gelöscht');
  },
  reconcileRejected() {
    throw new Error('Energiebuchungen entstehen nur in Fachbefehlen');
  },
  affectedDays(tx, entityId) {
    const row = sqliteOf(tx)
      .select({ personId: energyBooking.personId, localDate: energyBooking.localDate })
      .from(energyBooking)
      .where(eq(energyBooking.id, entityId))
      .get();
    return row === undefined ? [] : [{ type: 'tag', personId: EntityId.parse(row.personId), localDate: LocalDate.parse(row.localDate) }];
  },
};

function rowOf(booking: EnergyBooking, serverVersion: ServerVersion | null): typeof energyBooking.$inferInsert {
  const { trigger } = booking;
  return {
    id: booking.id,
    personId: booking.personId,
    type: booking.type,
    amount: booking.amount,
    localDate: booking.localDate,
    bookingKey: booking.bookingKey,
    trigger,
    dailyGoalCompletionId: 'dailyGoalCompletionId' in trigger ? trigger.dailyGoalCompletionId : null,
    islandObjectId: 'islandObjectId' in trigger ? trigger.islandObjectId : null,
    communityProjectId: 'projectId' in trigger ? trigger.projectId : null,
    originalBookingId: 'originalBookingId' in trigger ? trigger.originalBookingId : null,
    createdAt: booking.createdAt,
    serverVersion,
  };
}

function bookingOf(row: typeof energyBooking.$inferSelect): EnergyBooking {
  const { id, personId, type, amount, localDate, bookingKey, trigger, createdAt } = row;
  return EnergyBooking.parse({ id, personId, type, amount, localDate, bookingKey, trigger, createdAt });
}
