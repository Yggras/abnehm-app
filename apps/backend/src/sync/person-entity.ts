import { eq, inArray } from 'drizzle-orm';

import { PersonRecord, PersonUpsert } from '@abnehm/contracts/person';

import { followDisplayName } from '../coupling/couple.ts';
import { person } from '../db/schema/index.ts';
import type { ServerSyncEntity } from './registry.ts';

// Die Person im Sync (Spezifikation 0, Abschnitte 8 und 9). Angelegt wird sie nur vom Bootstrap, gelöscht
// nie. Der allgemeine Upsert ändert alle Personenfelder außer Konto-Verweis und Zeitzone; die Zeitzone
// ändert ausschließlich `updatePersonTimeZone`, damit ein veralteter Datensatz sie nie zurücksetzt.

const iso = (value: Date | null) => (value === null ? null : value.toISOString());
const instant = (value: string | null) => (value === null ? null : new Date(value));

export const personEntity: ServerSyncEntity = {
  entityType: 'person',
  resource: 'person',
  upsert: PersonUpsert,
  deletable: false,
  async read(tx, ids) {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select()
      .from(person)
      .where(inArray(person.id, [...ids]));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          serverVersion: row.serverVersion,
          deletedAt: row.deletedAt,
          data: PersonRecord.parse({
            id: row.id,
            accountId: row.accountId,
            displayName: row.displayName,
            calculationSex: row.calculationSex,
            birthDate: row.birthDate,
            heightCm: row.heightCm,
            activityLevel: row.activityLevel,
            pregnantOrBreastfeeding: row.pregnantOrBreastfeeding,
            knownEatingDisorder: row.knownEatingDisorder,
            disclaimerAcceptedAt: iso(row.disclaimerAcceptedAt),
            onboardingStatus: row.onboardingStatus,
            onboardingCompletedAt: iso(row.onboardingCompletedAt),
            goalWeightReachedG: row.goalWeightReachedG,
            goalWeightReachedAt: iso(row.goalWeightReachedAt),
            timeZone: row.timeZone,
            createdAt: iso(row.createdAt),
            updatedAt: iso(row.updatedAt),
          }),
        },
      ]),
    );
  },
  async write(tx, change) {
    // Ohne bestehende Person verweigert schon die Autorisierung; anlegen kann sie nur der Bootstrap.
    if (!change.exists) throw new Error('Person wird nur vom Bootstrap angelegt');
    const payload = PersonUpsert.parse(change.payload);
    await tx
      .update(person)
      .set({
        displayName: payload.displayName,
        calculationSex: payload.calculationSex,
        birthDate: payload.birthDate,
        heightCm: payload.heightCm,
        activityLevel: payload.activityLevel,
        pregnantOrBreastfeeding: payload.pregnantOrBreastfeeding,
        knownEatingDisorder: payload.knownEatingDisorder,
        disclaimerAcceptedAt: instant(payload.disclaimerAcceptedAt),
        onboardingStatus: payload.onboardingStatus,
        onboardingCompletedAt: instant(payload.onboardingCompletedAt),
        goalWeightReachedG: payload.goalWeightReachedG,
        goalWeightReachedAt: instant(payload.goalWeightReachedAt),
        updatedAt: change.at,
        serverVersion: change.serverVersion,
      })
      .where(eq(person.id, change.entityId));
    // Der Partner liest den Namen nur am Kopplungsmitglied; er folgt in derselben Transaktion.
    await followDisplayName(tx, change.entityId, payload.displayName, change.at);
  },
  async remove() {
    throw new Error('Eine Person wird nicht gelöscht');
  },
};
