import type * as schema from '../schema';

// Minimale gültige Zeilen für Tests der lokalen Datenbank. Werte sind synthetisch.

const instant = '2026-10-14T12:00:00.000Z';

export function personRow(id: string, accountId: string): typeof schema.person.$inferInsert {
  return {
    id,
    accountId,
    displayName: 'Testperson',
    onboardingStatus: 'begonnen',
    timeZone: 'Europe/Berlin',
    createdAt: instant,
    updatedAt: instant,
  };
}

export function waterRow(id: string, personId: string, amountMl = 250): typeof schema.waterEntry.$inferInsert {
  return {
    id,
    personId,
    amountMl,
    origin: 'manuell',
    loggedAt: instant,
    localDate: '2026-10-14',
    timeZone: 'Europe/Berlin',
    utcOffsetMinutes: 120,
    createdAt: instant,
    updatedAt: instant,
  };
}
