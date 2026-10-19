import { randomUUID } from 'node:crypto';

import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { changeLog, person, processedOperation, waterEntry } from '../src/db/schema/index.ts';
import { payloadHash } from '../src/sync/sync.ts';
import { createTestBackend } from './support/app.ts';
import { newDevice, signIn, defaultPassword } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { deleteOp, faultyWaterEntity, installationB, push, pushRaw, testWaterEntity, upsertOp, water } from './support/sync.ts';

// Push über die echte Hono-App mit Postgres (Spezifikation 0, Abschnitt 10; #99): terminale Ergebnisse,
// Retry nach verlorener Antwort, gemischter Batch, transienter Rollback, Löschmarkierungen,
// Last-Write-Wins und Felder, die nie Teil eines Client-Updates sind.

async function setup(options: { entity?: ReturnType<typeof faultyWaterEntity> } = {}) {
  const backend = await createTestBackend();
  backend.sync.registerEntity(options.entity ?? testWaterEntity);
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  return { backend, anna };
}

async function changeEntries(backend: Awaited<ReturnType<typeof setup>>['backend']) {
  return backend.database.db.select().from(changeLog).orderBy(asc(changeLog.position));
}

describe('Push', () => {
  it('übernimmt ein Create mit Eigentümer aus der Sitzung und hält das Ergebnis samt Hash fest', async () => {
    const { backend, anna } = await setup();
    const id = randomUUID();
    const operation = upsertOp(id, water(250));

    const [result] = await push(backend, anna.device, [operation]);

    expect(result).toMatchObject({
      type: 'applied',
      operationId: operation.operationId,
      canonical: { type: 'record', entityType: 'water_entry', entityId: id, data: { amountMl: 250 } },
    });
    const [row] = await backend.database.db.select().from(waterEntry).where(eq(waterEntry.id, id));
    expect(row?.personId).toBe(anna.personId);
    expect(result?.type === 'applied' && result.canonical.type !== 'absent' && result.canonical.serverVersion).toBe(row?.serverVersion.toString());
    const [stored] = await backend.database.db.select().from(processedOperation);
    expect(stored).toMatchObject({
      operationId: operation.operationId,
      personId: anna.personId,
      operationType: 'upsert_entity',
      entityType: 'water_entry',
      entityId: id,
      payloadHash: payloadHash(operation),
      outcome: 'applied',
    });
    const entries = await changeEntries(backend);
    expect(entries.at(-1)).toMatchObject({ entityType: 'water_entry', entityId: id, operation: 'upsert', ownerPersonId: anna.personId });
  });

  it('beantwortet den identischen Retry nach verlorener Antwort unverändert mit already_applied', async () => {
    const { backend, anna } = await setup();
    const operation = upsertOp(randomUUID(), water(250));
    const [first] = await push(backend, anna.device, [operation]);
    const before = await changeEntries(backend);

    // Auch von einer zweiten Installation derselben Person: Die Installationskennung begründet nichts.
    const [retry] = await push(backend, anna.device, [operation], installationB);

    expect(retry).toEqual({ ...first, type: 'already_applied' });
    expect(await changeEntries(backend)).toEqual(before);
    expect(await backend.database.db.select().from(processedOperation)).toHaveLength(1);
  });

  it('lehnt eine wiederverwendete Operations-ID mit anderem Inhalt als operation_conflict ab, eine fremde Person generisch', async () => {
    const { backend, anna } = await setup();
    const id = randomUUID();
    const operation = upsertOp(id, water(250));
    const [applied] = await push(backend, anna.device, [operation]);

    // Auch abweichende Metadaten machen aus dem Retry einen Konflikt.
    const [otherTime] = await push(backend, anna.device, [{ ...operation, createdAt: '2026-10-14T13:00:00.000Z' as typeof operation.createdAt }]);
    expect(otherTime).toMatchObject({ type: 'permanently_rejected', error: { code: 'operation_conflict' } });
    const [conflict] = await push(backend, anna.device, [{ ...operation, payload: water(300) }]);
    expect(conflict).toMatchObject({ type: 'permanently_rejected', error: { code: 'operation_conflict', retryable: false } });
    // Kanonischer Zustand der eigenen Entität, unverändert.
    expect(conflict?.type === 'permanently_rejected' && conflict.canonical).toEqual(applied?.type === 'applied' && applied.canonical);

    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const [foreign] = await push(backend, philipp.device, [operation]);
    expect(foreign).toEqual({
      type: 'permanently_rejected',
      operationId: operation.operationId,
      error: { code: 'forbidden', retryable: false },
      canonical: { type: 'absent', entityType: 'water_entry', entityId: id },
    });
  });

  it('hält im gemischten Batch gültige Operationen, auch wenn unabhängige dauerhaft scheitern', async () => {
    const { backend, anna } = await setup();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const foreignId = randomUUID();
    await push(backend, philipp.device, [upsertOp(foreignId, water(100))]);

    const first = upsertOp(randomUUID(), water(250));
    const tooMuch = upsertOp(randomUUID(), water(3001)); // erst die Datenbankregel lehnt ab
    const foreign = upsertOp(foreignId, water(500));
    const unknown = upsertOp(randomUUID(), { amountMl: 1 }, { entityType: 'unbekannt' });
    const last = upsertOp(randomUUID(), water(400));
    const results = await push(backend, anna.device, [first, tooMuch, foreign, unknown, last]);

    expect(results.map((result) => [result.type, result.type === 'permanently_rejected' ? result.error.code : null])).toEqual([
      ['applied', null],
      ['permanently_rejected', 'invalid_payload'],
      ['permanently_rejected', 'forbidden'],
      ['permanently_rejected', 'forbidden'],
      ['applied', null],
    ]);
    const rows = await backend.database.db.select({ amountMl: waterEntry.amountMl, personId: waterEntry.personId }).from(waterEntry);
    expect(rows).toEqual(
      expect.arrayContaining([
        { amountMl: 250, personId: anna.personId },
        { amountMl: 400, personId: anna.personId },
        { amountMl: 100, personId: philipp.personId },
      ]),
    );
    expect(rows).toHaveLength(3);
    // Auch Ablehnungen sind terminal festgehalten und kommen beim Retry unverändert zurück.
    expect(await backend.database.db.select().from(processedOperation)).toHaveLength(6);
    expect(await push(backend, anna.device, [tooMuch, foreign])).toEqual([results[1], results[2]]);
  });

  it('rollt bei einem vorübergehenden Fehler den ganzen Batch zurück und bestätigt nichts', async () => {
    const entity = faultyWaterEntity();
    const { backend, anna } = await setup({ entity });
    const before = await changeEntries(backend);
    const operations = [upsertOp(randomUUID(), water(250)), upsertOp(randomUUID(), water(300))];

    // Die erste Operation ist schon geschrieben, als die zweite an der Verbindung scheitert.
    entity.failAfter(1);
    const failing = await pushRaw(backend, anna.device, operations);
    expect(failing.status).toBe(503);
    expect(failing.body).toBeNull();
    expect(await backend.database.db.select().from(waterEntry)).toHaveLength(0);
    expect(await changeEntries(backend)).toEqual(before);
    expect(await backend.database.db.select().from(processedOperation)).toHaveLength(0);

    // Derselbe Batch gelingt danach vollständig.
    const results = await push(backend, anna.device, operations);
    expect(results.map((result) => result.type)).toEqual(['applied', 'applied']);
  });

  it('löscht per Löschmarkierung; Löschen gewinnt gegen ein späteres Offline-Update', async () => {
    const { backend, anna } = await setup();
    const id = randomUUID();
    await push(backend, anna.device, [upsertOp(id, water(250))]);

    const [deleted] = await push(backend, anna.device, [deleteOp(id)]);
    expect(deleted).toMatchObject({ type: 'applied', canonical: { type: 'tombstone', entityId: id } });
    const [late] = await push(backend, anna.device, [upsertOp(id, water(999), { knownServerVersion: '1' })]);
    expect(late).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' }, canonical: { type: 'tombstone', entityId: id } });

    // Die Zeile bleibt als Löschmarkierung erhalten, samt Änderungsprotokoll und verarbeiteten Operationen.
    const [row] = await backend.database.db.select().from(waterEntry).where(eq(waterEntry.id, id));
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.amountMl).toBe(250);
    expect((await changeEntries(backend)).filter((entry) => entry.entityId === id).map((entry) => entry.operation)).toEqual(['upsert', 'delete']);
    expect(await backend.database.db.select().from(processedOperation)).toHaveLength(3);
  });

  it('entscheidet einen Feldkonflikt zweier Geräte nach Server-Eingangsreihenfolge, nicht nach bekannter Version', async () => {
    const { backend, anna } = await setup();
    const second = (await signIn(backend, 'anna@example.test', defaultPassword, newDevice())).device;
    const id = randomUUID();
    const [created] = await push(backend, anna.device, [upsertOp(id, water(250))]);
    const known = created?.type === 'applied' && created.canonical.type !== 'absent' ? created.canonical.serverVersion : null;

    // Beide Geräte ändern offline ausgehend von derselben Version; das spätere gewinnt vollständig.
    await push(backend, second, [upsertOp(id, water(500, { utcOffsetMinutes: 60 }), { knownServerVersion: known })]);
    const [last] = await push(backend, anna.device, [upsertOp(id, water(300), { knownServerVersion: known })]);

    expect(last).toMatchObject({ type: 'applied', canonical: { data: { amountMl: 300, utcOffsetMinutes: 120 } } });
    const [row] = await backend.database.db.select().from(waterEntry).where(eq(waterEntry.id, id));
    expect(row).toMatchObject({ amountMl: 300, utcOffsetMinutes: 120 });
  });

  it('nimmt Eigentums- und Serverfelder nie aus der Nutzlast', async () => {
    const { backend, anna } = await setup();
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const id = randomUUID();
    await push(backend, anna.device, [upsertOp(id, water(250))]);

    const results = await push(backend, anna.device, [
      upsertOp(id, { ...water(300), personId: philipp.personId }),
      upsertOp(id, { ...water(300), personId: anna.personId }),
      upsertOp(id, { ...water(300), serverVersion: '1' }),
      upsertOp(id, { ...water(300), createdAt: '2020-01-01T00:00:00.000Z' }),
    ]);

    expect(results.map((result) => result.type === 'permanently_rejected' && result.error.code)).toEqual([
      'forbidden',
      'invalid_payload',
      'invalid_payload',
      'invalid_payload',
    ]);
    const [row] = await backend.database.db.select().from(waterEntry).where(eq(waterEntry.id, id));
    expect(row).toMatchObject({ amountMl: 250, personId: anna.personId });
  });

  it('ändert die Person über den Upsert, aber nie ihre Zeitzone oder den Konto-Verweis; Löschen gibt es nicht', async () => {
    const { backend, anna } = await setup();
    const [before] = await backend.database.db.select().from(person).where(eq(person.id, anna.personId));
    const upsert = {
      id: anna.personId,
      displayName: 'Anna B.',
      calculationSex: null,
      birthDate: null,
      heightCm: null,
      activityLevel: null,
      pregnantOrBreastfeeding: null,
      knownEatingDisorder: null,
      disclaimerAcceptedAt: null,
      onboardingStatus: 'begonnen',
      onboardingCompletedAt: null,
      goalWeightReachedG: null,
      goalWeightReachedAt: null,
    };

    const results = await push(backend, anna.device, [
      upsertOp(anna.personId, upsert, { entityType: 'person' }),
      upsertOp(anna.personId, { ...upsert, timeZone: 'America/New_York' }, { entityType: 'person' }),
      upsertOp(anna.personId, { ...upsert, id: randomUUID() }, { entityType: 'person' }),
      deleteOp(anna.personId, { entityType: 'person' }),
    ]);

    expect(results[0]).toMatchObject({
      type: 'applied',
      canonical: { type: 'record', entityType: 'person', data: { displayName: 'Anna B.', timeZone: 'Europe/Berlin', accountId: anna.accountId } },
    });
    expect(results.slice(1).map((result) => result.type === 'permanently_rejected' && result.error.code)).toEqual([
      'invalid_payload',
      'invalid_payload',
      'forbidden',
    ]);
    const [after] = await backend.database.db.select().from(person).where(eq(person.id, anna.personId));
    expect(after).toMatchObject({ displayName: 'Anna B.', timeZone: before?.timeZone, accountId: before?.accountId, deletedAt: null });
  });

  it('lehnt eine fremde Vertragsversion mit schema_update_required ab und Personenfelder in der Hülle als ungültig', async () => {
    const { backend, anna } = await setup();
    const operation = upsertOp(randomUUID(), water(250));
    const { call } = await import('./support/auth-client.ts');

    const tooNew = await call(backend, 'POST', '/v1/sync/push', anna.device, { schemaVersion: 2, installationId: randomUUID(), operations: [operation] });
    expect(tooNew).toMatchObject({ status: 400, body: { code: 'schema_update_required', retryable: false } });
    const withPerson = await call(backend, 'POST', '/v1/sync/push', anna.device, {
      schemaVersion: 1,
      installationId: randomUUID(),
      personId: anna.personId,
      operations: [operation],
    });
    expect(withPerson).toMatchObject({ status: 400, body: { code: 'invalid_payload' } });
    const oldOperation = await call(backend, 'POST', '/v1/sync/push', anna.device, {
      schemaVersion: 1,
      installationId: randomUUID(),
      operations: [{ ...operation, schemaVersion: 2 }],
    });
    expect(oldOperation).toMatchObject({ status: 400, body: { code: 'schema_update_required' } });
    expect(await backend.database.db.select().from(waterEntry)).toHaveLength(0);
  });
});
