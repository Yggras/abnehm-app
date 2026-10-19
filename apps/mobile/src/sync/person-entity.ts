import { eq } from 'drizzle-orm';

import { EntityId, type Instant, type ServerVersion } from '@abnehm/contracts/base';
import { PersonRecord, PersonUpsert } from '@abnehm/contracts/person';

import type { TransactionContext } from '../local-db';
import { readOwnPerson } from '../local-db/person-header';
import { person } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import type { SyncWriter } from './outbox';
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

/** Felder, die Bereiche an der eigenen Person ändern: Spezifikation 1 Körperdaten und Onboarding-Stand, Spezifikation 5 den Anzeigenamen. */
export type PersonChange = Partial<Omit<PersonUpsert, 'id'>>;

/**
 * Ändert Felder der eigenen Person und merkt in derselben Transaktion den vollständigen Upsert vor
 * (Last-Write-Wins). Konto-Verweis, Zeitzone und Serverfelder gehören nicht dazu; die Zeitzone ändert
 * nur `updatePersonTimeZone`. Vor dem ersten Pull gibt es keine Person, das ist ein Aufruffehler.
 */
export function updateOwnPerson(tx: TransactionContext, writer: SyncWriter, change: PersonChange, at: Instant): PersonUpsert {
  const row = readOwnPerson(tx);
  if (row === undefined) throw new Error('Die eigene Person ist lokal noch nicht angekommen');
  // Die Spalten tragen dieselben Namen wie die Upsert-Felder; das Schema prüft die Werte der Zeile.
  const payload = PersonUpsert.parse({ id: row.id, ...personFields(row as unknown as PersonUpsert), ...change });
  sqliteOf(tx).update(person).set({ ...personFields(payload), updatedAt: at }).where(eq(person.id, row.id)).run();
  writer.upsert(tx, { entityType: 'person', entityId: EntityId.parse(row.id), payload, knownServerVersion: row.serverVersion as ServerVersion | null });
  return payload;
}

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
