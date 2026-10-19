import { eq, inArray } from 'drizzle-orm';

import { Instant, ServerVersion, type EntityId } from '@abnehm/contracts/base';
import { bookingReferences, counterBookingKey, EnergyBooking, energyBookingId } from '@abnehm/contracts/energy';
import type { CanonicalRecord } from '@abnehm/contracts/sync';

import type { DbExecutor } from '../database.ts';
import { energyBooking } from '../db/schema/index.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';
import type { ServerSyncEntity } from '../sync/registry.ts';

// Energiebuchungen auf dem Server (Spezifikation 0, Abschnitt 4). Buchungen entstehen nur in
// Fachbefehlen und sind unveränderlich; Postgres verhindert Update und Delete per Trigger. Korrigiert
// wird ausschließlich mit einer Gegenbuchung mit exaktem Gegenzeichen.

/** Sync-Entität: nur lesbar, kein generisches Upsert oder Löschen. */
export const energyBookingEntity: ServerSyncEntity = {
  entityType: 'energy_booking',
  resource: 'energy_booking',
  upsert: null,
  deletable: false,
  async read(tx, ids) {
    if (ids.length === 0) return new Map();
    const rows = await tx.select().from(energyBooking).where(inArray(energyBooking.id, [...ids]));
    return new Map(rows.map((row) => [row.id, { serverVersion: row.serverVersion, deletedAt: null, data: bookingOf(row) }]));
  },
  async write() {
    throw new Error('Energiebuchungen entstehen nur in Fachbefehlen');
  },
  async remove() {
    throw new Error('Energiebuchungen sind unveränderlich');
  },
};

/**
 * Legt eine Buchung samt Serverversion und Änderungsprotokoll an. Art und Vorzeichen prüft das
 * Vertragsschema, die Eindeutigkeit des Buchungsschlüssels die Tabelle (`energy_booking_key_uq`).
 */
export async function insertBooking(tx: DbExecutor, booking: EnergyBooking): Promise<CanonicalRecord> {
  const parsed = EnergyBooking.parse(booking);
  const serverVersion = await nextServerVersion(tx);
  const createdAt = new Date(parsed.createdAt);
  await tx.insert(energyBooking).values({
    id: parsed.id,
    personId: parsed.personId,
    type: parsed.type,
    amount: parsed.amount,
    localDate: parsed.localDate,
    bookingKey: parsed.bookingKey,
    trigger: parsed.trigger,
    ...bookingReferences(parsed),
    createdAt,
    serverVersion,
  });
  await recordChange(tx, { position: serverVersion, entityType: 'energy_booking', entityId: parsed.id, operation: 'upsert',
    ownerPersonId: parsed.personId, createdAt });
  return { type: 'record', entityType: 'energy_booking', entityId: parsed.id, serverVersion: ServerVersion.parse(serverVersion.toString()), data: parsed };
}

/**
 * Korrigiert eine technisch oder fachlich irrtümlich erzeugte Buchung mit exaktem Gegenzeichen. Je
 * Buchung gibt es höchstens eine Gegenbuchung (`gegenbuchung:<buchung>`), Gegenbuchungen selbst werden
 * nicht korrigiert. Eine spätere Korrektur eines erfüllten Tagesziels ist ausdrücklich kein Anlass.
 */
export async function bookCounterBooking(tx: DbExecutor, { originalBookingId, at }: { originalBookingId: EntityId; at: Date }): Promise<CanonicalRecord> {
  const [row] = await tx.select().from(energyBooking).where(eq(energyBooking.id, originalBookingId));
  if (row === undefined) throw new Error('Ursprüngliche Buchung fehlt');
  const original = bookingOf(row);
  if (original.type === 'counter_booking') throw new Error('Eine Gegenbuchung wird nicht korrigiert');
  const bookingKey = counterBookingKey(original.id);
  return insertBooking(tx, {
    type: 'counter_booking',
    id: energyBookingId(bookingKey),
    personId: original.personId,
    amount: -original.amount,
    localDate: original.localDate,
    bookingKey,
    createdAt: Instant.parse(at.toISOString()),
    trigger: { originalBookingId: original.id, originalType: original.type, originalAmount: original.amount },
  });
}

function bookingOf(row: typeof energyBooking.$inferSelect): EnergyBooking {
  const { id, personId, type, amount, localDate, bookingKey, trigger } = row;
  return EnergyBooking.parse({ id, personId, type, amount, localDate, bookingKey, trigger, createdAt: row.createdAt.toISOString() });
}
