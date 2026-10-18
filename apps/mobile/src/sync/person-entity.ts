import { eq } from 'drizzle-orm';

import { PersonRecord, PersonUpsert } from '@abnehm/contracts/person';

import { person } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { sqliteEntity } from './sqlite-entity';

// Die eigene Person im App-Sync (Spezifikation 0, Abschnitte 8 und 9). Sie entsteht lokal erst mit dem
// ersten Pull nach dem Bootstrap; Konto-Verweis und Zeitzone setzt nur der Server.

const personFields = (data: PersonUpsert) => ({
  displayName: data.displayName,
  calculationSex: data.calculationSex,
  birthDate: data.birthDate,
  heightCm: data.heightCm,
  activityLevel: data.activityLevel,
  pregnantOrBreastfeeding: data.pregnantOrBreastfeeding,
  knownEatingDisorder: data.knownEatingDisorder,
  disclaimerAcceptedAt: data.disclaimerAcceptedAt,
  onboardingStatus: data.onboardingStatus,
  onboardingCompletedAt: data.onboardingCompletedAt,
  goalWeightReachedG: data.goalWeightReachedG,
  goalWeightReachedAt: data.goalWeightReachedAt,
});

export const personEntity = sqliteEntity({
  entityType: 'person',
  ownerField: 'accountId',
  upsert: PersonUpsert,
  deletable: false,
  record: PersonRecord,
  table: person,
  row: (entityId, data) => ({
    id: entityId,
    accountId: data.accountId,
    ...personFields(data),
    timeZone: data.timeZone,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  }),
  replay(tx, entityId, change) {
    // Personen werden nie gelöscht; ein offener Upsert ändert nur die eigenen Felder.
    if (change.type !== 'upsert_entity') return;
    sqliteOf(tx)
      .update(person)
      .set({ ...personFields(change.payload), updatedAt: change.createdAt })
      .where(eq(person.id, entityId))
      .run();
  },
});
