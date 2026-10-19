/** @jest-environment node */
import { EntityId, Instant, LocalDate, TimeZone } from '@abnehm/contracts/base';
import { dailyGoalKey, type DailyGoalSnapshot } from '@abnehm/contracts/daily-goals';
import { dailyBonusKey, EnergyBooking, energyBookingId } from '@abnehm/contracts/energy';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import * as schema from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { appendBooking, bookingByKey, readEnergy } from './bookings';
import { insertCompletionForTest, insertDailyGoalForTest, insertPersonForTest } from '../daily-goals/testing/persisted';

// Nachweis für #105: Energiebuchungen der App (Spezifikation 0, Abschnitt 4). Buchungen sind
// unveränderlich, verbotene Vorzeichen scheitern, korrigiert wird nur mit Gegenbuchung, und die
// Lesefunktion liefert Bestand und Levelhälfte.

const anna = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const partner = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const at = Instant.parse('2026-10-14T12:00:00.000Z');
const today = LocalDate.parse('2026-10-14');
const uuid = (n: number) => EntityId.parse(`5e5e5e5e-0000-4000-8000-${String(n).padStart(12, '0')}`);

const base = (slot: 1 | 2 | 3) => ({ personId: anna, localDate: today, slot, timeZone: TimeZone.parse('Europe/Berlin'), dayEndsAt: Instant.parse('2026-10-14T22:00:00.000Z') });
const snapshots: DailyGoalSnapshot[] = [
  { type: 'gewogen', ...base(1) },
  { type: 'wasserziel', ...base(2), targetMl: 1500 },
  { type: 'sporteinheit', ...base(3), minimumSingleSessionMinutes: 20 },
];

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup(): Promise<LocalDatabase> {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open('konto_a');
  database.transaction((tx) => {
    insertPersonForTest(tx, anna);
    // Drei erfüllte Tagesziele, damit Gutschriften und Bonus ihre Erfüllungen referenzieren können.
    snapshots.forEach((snapshot) => {
      insertDailyGoalForTest(tx, uuid(10 + snapshot.slot), snapshot);
      insertCompletionForTest(tx, uuid(20 + snapshot.slot), uuid(10 + snapshot.slot), snapshot, at);
    });
    // Ein Inselobjekt für Ausgaben (Spezifikation 4 legt es im Betrieb an).
    const s = sqliteOf(tx);
    const stamps = { createdAt: at, updatedAt: at };
    s.insert(schema.coupling).values({ id: uuid(30), personLowId: anna, personHighId: partner, status: 'aktiv', startedAt: at, ...stamps }).run();
    s.insert(schema.island).values({ id: uuid(31), couplingId: uuid(30), state: 'aktiv', hatchedAt: at, timeZone: 'Europe/Berlin', ...stamps }).run();
    s.insert(schema.islandObject)
      .values({ id: uuid(32), islandId: uuid(31), couplingId: uuid(30), ownerPersonId: anna, catalogKey: 'steg', origin: 'gebaut', level: 1, ...stamps })
      .run();
  });
  return database;
}

const credit = (slot: 1 | 2 | 3): EnergyBooking => {
  const bookingKey = dailyGoalKey(anna, today, slot);
  return EnergyBooking.parse({ type: 'daily_goal_credit', id: energyBookingId(bookingKey), personId: anna, amount: 1, localDate: today,
    bookingKey, createdAt: at, trigger: { dailyGoalCompletionId: uuid(20 + slot), slot } });
};
const bonus = EnergyBooking.parse({ type: 'daily_bonus_credit', id: energyBookingId(dailyBonusKey(anna, today)), personId: anna, amount: 1,
  localDate: today, bookingKey: dailyBonusKey(anna, today), createdAt: at, trigger: { dailyGoalCompletionIds: [uuid(21), uuid(22), uuid(23)] } });
const build = (amount: number) => EnergyBooking.parse({ type: 'build_debit', id: uuid(40), personId: anna, amount, localDate: today,
  bookingKey: uuid(40), createdAt: at, trigger: { commandId: uuid(40), islandObjectId: uuid(32) } });
const counterOf = (original: EnergyBooking) => EnergyBooking.parse({ type: 'counter_booking', id: uuid(41), personId: anna,
  amount: -original.amount, localDate: today, bookingKey: `gegenbuchung:${original.id}`, createdAt: at,
  trigger: { originalBookingId: original.id, originalType: original.type, originalAmount: original.amount } });

describe('Energiebuchungen der App', () => {
  it('Bestand ist die Summe aller Buchungen, die Levelhälfte zählt nur Ausgaben', async () => {
    const database = await setup();
    expect(database.read((tx) => readEnergy(tx, anna))).toEqual({ balance: 0, levelHalf: 0 });
    database.transaction((tx) => [credit(1), credit(2), credit(3), bonus, build(-3)].forEach((booking) => appendBooking(tx, booking)));
    expect(database.read((tx) => readEnergy(tx, anna))).toEqual({ balance: 1, levelHalf: 3 });
  });

  it('ein negativer Mehrgeräte-Zwischenstand bleibt in der Summe negativ', async () => {
    const database = await setup();
    database.transaction((tx) => [credit(1), build(-3)].forEach((booking) => appendBooking(tx, booking)));
    expect(database.read((tx) => readEnergy(tx, anna))).toEqual({ balance: -2, levelHalf: 3 });
  });

  it('bucht höchstens einmal je Buchungsschlüssel und findet die Buchung über ihn', async () => {
    const database = await setup();
    database.transaction((tx) => appendBooking(tx, credit(2)));
    expect(() => database.transaction((tx) => appendBooking(tx, { ...credit(2), id: uuid(99) }))).toThrow(/booking_key/);
    expect(database.read((tx) => bookingByKey(tx, dailyGoalKey(anna, today, 2)))).toEqual(credit(2));
    expect(database.read((tx) => bookingByKey(tx, dailyGoalKey(anna, today, 3)))).toBeNull();
  });

  it('lehnt verbotene Vorzeichen und Arten ab, bevor etwas geschrieben wird', async () => {
    const database = await setup();
    for (const forbidden of [{ ...credit(1), amount: 2 }, { ...build(-3), amount: 3 }, { ...credit(1), type: 'geschenk' }]) {
      expect(() => database.transaction((tx) => appendBooking(tx, forbidden as never))).toThrow();
    }
    expect(database.read((tx) => readEnergy(tx, anna))).toEqual({ balance: 0, levelHalf: 0 });
  });

  it('korrigiert nur über eine Gegenbuchung; die ursprüngliche Buchung bleibt unverändert', async () => {
    const database = await setup();
    database.transaction((tx) => [credit(1), build(-3), counterOf(build(-3))].forEach((booking) => appendBooking(tx, booking)));
    expect(database.read((tx) => readEnergy(tx, anna))).toEqual({ balance: 1, levelHalf: 0 });
    expect(database.read((tx) => bookingByKey(tx, uuid(40)))).toEqual(build(-3));
    // Eine zweite Gegenbuchung derselben Buchung gibt es nicht.
    expect(() => database.transaction((tx) => appendBooking(tx, { ...counterOf(build(-3)), id: uuid(42) }))).toThrow(/booking_key/);
  });
});
