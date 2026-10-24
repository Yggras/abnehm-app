import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { policies } from '../src/authorization/authorization.ts';
import { notificationIntent, processedOperation, waterEntry } from '../src/db/schema/index.ts';
import { insertNotificationIntent } from '../src/sync/notification-intents.ts';
import { CommandRejection } from '../src/sync/commands.ts';
import { createTestBackend, type TestBackend } from './support/app.ts';
import { authorizationCases, personWithSession, registeredCommandCases, httpOutcome, type AuthorizationScenario } from './support/authorization.ts';
import { dailyGoalCommandScenarios } from './support/daily-goals.ts';
import type { Device } from './support/auth-client.ts';
import { personTimeZoneScenario } from './support/person-time-zone.ts';
import { sharedActionCommandScenarios } from './support/shared-actions.ts';
import { push, pushRaw, testWaterEntity, upsertOp, water } from './support/sync.ts';
import { EntityId, ServerVersion } from '@abnehm/contracts/base';
import { currentSyncSchemaVersion, type OutboxOperation } from '@abnehm/contracts/sync';

const command = (id: string, key: string, amountMl = 250): Extract<OutboxOperation, { businessKey: string }> => ({
  type: 'saveMealFavorite', operationId: EntityId.parse(id), businessKey: key, payload: { amountMl, localId: id },
  knownServerVersion: null, schemaVersion: currentSyncSchemaVersion, createdAt: '2026-10-14T12:00:00.000Z' as never,
});

async function setup() {
  const backend = await createTestBackend();
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  backend.sync.registerEntity(testWaterEntity);
  const payloadSchema = z.strictObject({ amountMl: z.int().positive(), localId: EntityId });
  backend.sync.registerCommand({ type: 'saveMealFavorite', identity: 'mapped', policy: policies.resource('water_entry', 'befehl'),
    payload: payloadSchema,
    target: (operation) => ({ id: operation.payload.localId as string }),
    duplicate: (operation, original) => {
      const canonical = original.changes?.find((change) => change.type === 'record' && change.entityType === 'water_entry');
      if (canonical === undefined) throw new Error('Kanonische Identität fehlt');
      return [{ entityType: 'water_entry', from: EntityId.parse(operation.payload.localId), to: canonical.entityId }];
    },
    canonicalRequest: (operation) => ({ amountMl: operation.payload.amountMl }),
    async execute(tx, { actor, payload, at }) {
      const input = payloadSchema.parse(payload);
      const existing = await tx.select().from(waterEntry).where(eq(waterEntry.id, input.localId));
      if (input.amountMl === 999) {
        await tx.insert(waterEntry).values({ id: input.localId, personId: actor.personId, amountMl: 250, origin: 'manuell', loggedAt: at,
          localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, createdAt: at, updatedAt: at, serverVersion: 1n });
        throw new CommandRejection('conflict');
      }
      if (existing.length === 0) await tx.insert(waterEntry).values({ id: input.localId, personId: actor.personId, amountMl: input.amountMl,
        origin: 'manuell', loggedAt: at, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
        createdAt: at, updatedAt: at, serverVersion: 1n });
      const row = (await testWaterEntity.read(tx, [input.localId])).get(input.localId);
      if (row === undefined) throw new Error('Testzeile fehlt');
      return { changes: [{ type: 'record', entityType: 'water_entry', entityId: input.localId,
        serverVersion: ServerVersion.parse(row.serverVersion.toString()), data: row.data }],
        idMappings: [{ entityType: 'water_entry', from: input.localId, to: input.localId }] };
    },
  });
  return { backend, anna };
}

describe('Fachbefehl über Push', () => {
  it('führt denselben Schlüssel für dieselbe Person nur einmal aus, auch mit neuer Operations-ID', async () => {
    const { backend, anna } = await setup();
    const first = command(randomUUID(), 'goal:1');
    const [applied] = await push(backend, anna.device, [first]);
    const second = command(randomUUID(), 'goal:1');
    const [duplicate] = await push(backend, anna.device, [second]);
    expect(applied?.type).toBe('applied');
    expect(duplicate).toMatchObject({ type: 'already_applied', operationId: second.operationId });
    expect(await push(backend, anna.device, [second])).toEqual([duplicate]);
    const [sameIdDifferentLocalId] = await push(backend, anna.device, [{ ...second, payload: { ...second.payload, localId: randomUUID() } }]);
    expect(sameIdDifferentLocalId).toMatchObject({ type: 'permanently_rejected', error: { code: 'operation_conflict' } });
    expect(await backend.database.db.select().from(waterEntry)).toHaveLength(1);
    expect(await backend.database.db.select().from(processedOperation)).toHaveLength(2);
    const [conflict] = await push(backend, anna.device, [{ ...second, operationId: EntityId.parse(randomUUID()), payload: { ...second.payload, amountMl: 300 } }]);
    expect(conflict).toMatchObject({ type: 'permanently_rejected', error: { code: 'operation_conflict' } });
  });

  it('lehnt einen kaputten Befehls-Payload dauerhaft ab und führt die Nachbaroperationen aus', async () => {
    const { backend, anna } = await setup();
    const operations = [command(randomUUID(), 'goal:before'), { ...command(randomUUID(), 'goal:invalid'), payload: { amountMl: 250 } },
      command(randomUUID(), 'goal:after')];
    const results = await push(backend, anna.device, operations);
    expect(results.map((result) => result.type === 'permanently_rejected' ? result.error.code : result.type)).toEqual([
      'applied', 'invalid_payload', 'applied',
    ]);
    expect(await backend.database.db.select().from(waterEntry)).toHaveLength(2);
  });

  it('rollt einen fehlgeschlagenen Befehl samt Fachzeile zurück und lässt unabhängige Operationen weiterlaufen', async () => {
    const { backend, anna } = await setup();
    const results = await push(backend, anna.device, [command(randomUUID(), 'goal:fail', 999), command(randomUUID(), 'goal:ok')]);
    expect(results.map((result) => result.type)).toEqual(['permanently_rejected', 'applied']);
    expect(results[0]).toMatchObject({ error: { code: 'conflict' } });
    expect(await push(backend, anna.device, [command(results[0]!.operationId, 'goal:fail', 999)])).toEqual([results[0]]);
    expect(await backend.database.db.select().from(waterEntry)).toHaveLength(1);
  });

  it('erfasst alle registrierten Fachbefehle im Negativtest-Gerüst', async () => {
    const { backend } = await setup();
    // Die Welten der echten Fachbefehle sind andere; deren Fälle laufen in ihren eigenen Tests.
    const real = { ...dailyGoalCommandScenarios, ...sharedActionCommandScenarios, updatePersonTimeZone: personTimeZoneScenario } as unknown as Parameters<typeof registeredCommandCases>[1];
    expect(() => registeredCommandCases(backend, real)).toThrow('saveMealFavorite');
    const scenario = {
      policy: policies.resource('water_entry', 'befehl'),
      arrange: async () => {
        const world = await setup();
        const ownId = randomUUID();
        await push(world.backend, world.anna.device, [upsertOp(ownId, water(250))]);
        return { backend: world.backend, actor: world.anna.device, ownId };
      },
      attempt: async (world, device) => {
        const reply = await pushRaw(world.backend, device, [command(world.ownId, 'goal:access')]);
        if (reply.status !== 200) return httpOutcome(reply);
        return (reply.body as { results: { type: string }[] }).results[0]?.type === 'permanently_rejected' ? 'verweigert' : 'erlaubt';
      },
      manipulierte_id: async (world) => {
        const philipp = await personWithSession(world.backend, 'philipp@example.test', 'Philipp');
        const foreignId = randomUUID();
        await push(world.backend, philipp.device, [upsertOp(foreignId, water(200))]);
        const reply = await pushRaw(world.backend, world.actor, [command(foreignId, 'goal:foreign')]);
        expect(reply.body).toMatchObject({ results: [{ type: 'permanently_rejected', error: { code: 'forbidden' } }] });
        return 'verweigert';
      },
    } satisfies AuthorizationScenario<{ backend: TestBackend; actor: Device; ownId: string },
      'ohne_sitzung' | 'fremde_person' | 'manipulierte_id'>;
    // Vollständig erst mit den Szenarien der echten Fachbefehle; deren Fälle laufen in ihren eigenen Tests (#105, #110).
    expect(() => registeredCommandCases(backend, { ...real, saveMealFavorite: scenario })).not.toThrow();
    const cases = authorizationCases({ ...scenario, command: 'saveMealFavorite' });
    const wrong = authorizationCases({ ...scenario, policy: policies.resource('weight_entry', 'befehl'), command: 'saveMealFavorite' });
    await expect(wrong.find((testCase) => testCase.name.startsWith('Fachbefehl'))!.run()).rejects.toThrow();
    for (const testCase of cases) {
      try { await testCase.run(); } catch (error) { throw new Error(`${testCase.name}: ${String(error)}`); }
    }
  }, 20_000);

  it('verwehrt fremdem Akteur die wiederverwendete Operations-ID ohne kanonische Daten', async () => {
    const { backend, anna } = await setup();
    const operation = command(randomUUID(), 'goal:privat');
    await push(backend, anna.device, [operation]);
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    const [foreign] = await push(backend, philipp.device, [operation]);
    expect(foreign).toEqual({ type: 'permanently_rejected', operationId: operation.operationId,
      error: { code: 'forbidden', retryable: false },
      canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId } });
  });

  it('liefert beim Retry keine ehemals lesbaren abgeleiteten Daten nach Rechteentzug aus', async () => {
    const { backend, anna } = await setup();
    const targetId = randomUUID();
    const disclosedId = randomUUID();
    await push(backend, anna.device, [upsertOp(targetId, water(250)), upsertOp(disclosedId, water(300))]);
    backend.sync.registerCommand({ type: 'confirmPhotoDraft', identity: 'none', policy: policies.resource('water_entry', 'befehl'),
      payload: z.strictObject({ targetId: EntityId, disclosedId: EntityId }),
      target: (operation) => ({ id: operation.payload.targetId }),
      canonicalRequest: (operation) => operation.payload,
      duplicate: () => [],
      async execute(tx, { payload }) {
        const row = (await testWaterEntity.read(tx, [EntityId.parse(payload.disclosedId)])).get(String(payload.disclosedId));
        if (row === undefined) throw new Error('Testdatensatz fehlt');
        return { idMappings: [], changes: [{ type: 'record', entityType: 'water_entry', entityId: EntityId.parse(payload.disclosedId),
          serverVersion: ServerVersion.parse(row.serverVersion.toString()), data: row.data }] };
      },
    });
    const operation = { ...command(randomUUID(), 'bonus:1'), type: 'confirmPhotoDraft' as const,
      payload: { targetId, disclosedId } };
    expect((await push(backend, anna.device, [operation]))[0]?.type).toBe('applied');
    const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
    await backend.database.db.update(waterEntry).set({ personId: philipp.personId }).where(eq(waterEntry.id, disclosedId));
    expect((await push(backend, anna.device, [operation]))[0]).toEqual({ type: 'permanently_rejected',
      operationId: operation.operationId, error: { code: 'forbidden', retryable: false },
      canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId } });
  });

  it('verweigert einem ID-erzeugenden Handler ohne vollständige kanonische Zuordnung die Bestätigung', async () => {
    const { backend, anna } = await setup();
    backend.sync.registerCommand({ type: 'confirmPhotoDraft', identity: 'mapped', policy: policies.resource('water_entry', 'befehl'),
      payload: z.strictObject({ localId: EntityId }), target: (operation) => ({ id: operation.payload.localId }),
      canonicalRequest: () => ({}), duplicate: () => [],
      async execute() { return { changes: [], idMappings: [] }; },
    });
    const request = { ...command(randomUUID(), 'bonus:broken'), type: 'confirmPhotoDraft' as const, payload: { localId: randomUUID() } };
    expect((await push(backend, anna.device, [request]))[0]).toMatchObject({ type: 'permanently_rejected',
      error: { code: 'invalid_payload' } });
  });

  it('verhindert generisches Schreiben historischer Zielversionen und materialisierter Tagesziele', async () => {
    const { backend } = await setup();
    for (const resource of ['goal_version', 'weekly_plan_version', 'daily_goal'] as const) {
      expect(() => backend.sync.registerEntity({ ...testWaterEntity, entityType: resource, resource })).toThrow();
    }
  });

  it('lehnt unbekannte Fachbefehle am HTTP-Vertrag ab', async () => {
    const { backend, anna } = await setup();
    expect((await pushRaw(backend, anna.device, [{ ...command(randomUUID(), 'goal:1'), type: 'anything' }])).status).toBe(400);
  });

  it('prüft Intents strikt, dedupliziert sie und rollt sie mit der Transaktion zurück', async () => {
    const { backend, anna } = await setup();
    const event = EntityId.parse(randomUUID());
    const intent = { sourceEventId: event, recipientPersonId: EntityId.parse(anna.personId), type: 'levelaufstieg',
      intentId: `${event}:${anna.personId}:levelaufstieg`, messageKey: 'levelaufstieg', payload: { level: 2 }, createdAt: '2026-10-14T12:00:00.000Z' };
    await backend.database.db.transaction(async (tx) => {
      await insertNotificationIntent(tx, intent);
      await insertNotificationIntent(tx, intent);
      await expect(insertNotificationIntent(tx, { ...intent, payload: { level: 2, weightG: 80000 } })).rejects.toThrow();
      await expect(insertNotificationIntent(tx, { ...intent, type: 'unbekannt' })).rejects.toThrow();
    });
    expect(await backend.database.db.select().from(notificationIntent)).toHaveLength(1);
    const anotherEvent = EntityId.parse(randomUUID());
    await expect(backend.database.db.transaction(async (tx) => {
      await insertNotificationIntent(tx, { ...intent, sourceEventId: anotherEvent, intentId: `${anotherEvent}:${anna.personId}:levelaufstieg` });
      throw new Error('Fachbefehl zurückgerollt');
    })).rejects.toThrow('Fachbefehl zurückgerollt');
    expect(await backend.database.db.select().from(notificationIntent)).toHaveLength(1);
  });
});
