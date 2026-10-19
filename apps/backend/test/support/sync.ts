import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { EntityId, Instant, ServerVersion, type SyncCursor } from '@abnehm/contracts/base';
import { TestWaterUpsert, type TestWaterRecord } from '@abnehm/contracts/fixtures';
import {
  currentSyncSchemaVersion,
  PullResponse,
  PushResponse,
  type OutboxOperation,
  type PullPageToken,
  type PushResult,
} from '@abnehm/contracts/sync';

import { waterEntry } from '../../src/db/schema/index.ts';
import { policies } from '../../src/authorization/authorization.ts';
import { nextServerVersion, recordChange } from '../../src/sync/change-log.ts';
import type { ServerCommand } from '../../src/sync/commands.ts';
import { ownedEntity, type ServerSyncEntity } from '../../src/sync/registry.ts';
import { call, type Device, type Reply } from './auth-client.ts';
import type { TestBackend } from './app.ts';

// Sync-Hilfen für Integrationstests (#99): die Test-Entität auf `water_entry` und Aufrufe von Push und
// Pull über die echte Hono-App. Den echten Wassereintrag meldet Spezifikation 3 an.

/** Serverseite der Test-Entität; nur in Tests angemeldet. */
export const testWaterEntity = ownedEntity({
  entityType: 'water_entry',
  resource: 'water_entry',
  table: waterEntry,
  upsert: TestWaterUpsert,
  deletable: true,
  columns: (payload) => ({
    amountMl: payload.amountMl,
    origin: 'manuell',
    loggedAt: new Date(payload.loggedAt),
    localDate: payload.localDate,
    timeZone: payload.timeZone,
    utcOffsetMinutes: payload.utcOffsetMinutes,
  }),
  record: (row): TestWaterRecord => ({
    personId: EntityId.parse(row.personId),
    amountMl: row.amountMl,
    loggedAt: Instant.parse(row.loggedAt.toISOString()),
    localDate: row.localDate as TestWaterRecord['localDate'],
    timeZone: row.timeZone as TestWaterRecord['timeZone'],
    utcOffsetMinutes: row.utcOffsetMinutes,
    createdAt: Instant.parse(row.createdAt.toISOString()),
    updatedAt: Instant.parse(row.updatedAt.toISOString()),
  }),
});

/** Ausschließlich im Test-Artefakt injizierter Fachbefehl: eine natürliche Tageskennung. */
const TestGoalCommand = TestWaterUpsert.extend({ localId: EntityId });
export const testWaterCommand: ServerCommand = {
  type: 'saveMealFavorite',
  identity: 'mapped',
  policy: policies.resource('water_entry', 'befehl'),
  payload: TestGoalCommand,
  target: (operation) => ({ id: operation.payload.localId as string }),
  canonicalRequest: (operation) => {
    const { localId, ...values } = TestGoalCommand.parse(operation.payload);
    void localId;
    return values;
  },
  duplicate(operation, original) {
    const record = original.changes?.find((change) => change.type === 'record' && change.entityType === 'water_entry');
    if (record === undefined) throw new Error('Kanonischer Datensatz des Fachbefehls fehlt');
    return [{ entityType: 'water_entry', from: EntityId.parse(operation.payload.localId), to: record.entityId }];
  },
  async execute(tx, { actor, payload, at }) {
    const values = TestGoalCommand.parse(payload);
    const [existing] = await tx.select().from(waterEntry).where(and(eq(waterEntry.personId, actor.personId), eq(waterEntry.loggedAt, new Date(values.loggedAt))));
    if (existing !== undefined) throw new Error('Natürlicher Schlüssel ohne verarbeitetes Kommando');
    const serverVersion = await nextServerVersion(tx);
    await testWaterEntity.write(tx, { entityId: values.localId, ownerPersonId: actor.personId, payload: values,
      exists: false, serverVersion, at });
    await recordChange(tx, { position: serverVersion, entityType: 'water_entry', entityId: values.localId,
      operation: 'upsert', ownerPersonId: actor.personId, createdAt: at });
    const stored = (await testWaterEntity.read(tx, [values.localId])).get(values.localId);
    if (stored === undefined) throw new Error('Fachbefehl lieferte keine Zeile');
    return { changes: [{ type: 'record', entityType: 'water_entry', entityId: values.localId,
      serverVersion: ServerVersion.parse(serverVersion.toString()), data: stored.data }],
      idMappings: [{ entityType: 'water_entry', from: values.localId, to: values.localId }] };
  },
};

/** Test-Entität, deren Schreiben auf Wunsch wie ein Verbindungsabbruch scheitert. */
export function faultyWaterEntity(): ServerSyncEntity & { failAfter(successfulWrites: number): void } {
  let remaining: number | null = null;
  return {
    ...testWaterEntity,
    async write(tx, change) {
      if (remaining === 0) {
        remaining = null;
        throw Object.assign(new Error('Verbindung verloren'), { code: 'ECONNRESET' });
      }
      if (remaining !== null) remaining--;
      return testWaterEntity.write(tx, change);
    },
    failAfter(successfulWrites) {
      remaining = successfulWrites;
    },
  };
}

export const installationA = EntityId.parse('c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4ea1');
export const installationB = EntityId.parse('c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4eb2');

export function water(amountMl: number, overrides: Partial<TestWaterUpsert> = {}): TestWaterUpsert {
  return TestWaterUpsert.parse({
    amountMl,
    loggedAt: '2026-10-14T12:00:00.000Z',
    localDate: '2026-10-14',
    timeZone: 'Europe/Berlin',
    utcOffsetMinutes: 120,
    ...overrides,
  });
}

let created = 0;
/** Eine Upsert-Operation; ohne `operationId` mit frischer ID. */
export function upsertOp(
  entityId: string,
  payload: Record<string, unknown>,
  options: { operationId?: string; knownServerVersion?: string | null; entityType?: string } = {},
): Extract<OutboxOperation, { type: 'upsert_entity' }> {
  return {
    type: 'upsert_entity',
    operationId: EntityId.parse(options.operationId ?? randomUUID()),
    entityType: options.entityType ?? 'water_entry',
    entityId: EntityId.parse(entityId),
    payload,
    knownServerVersion: options.knownServerVersion == null ? null : ServerVersion.parse(options.knownServerVersion),
    schemaVersion: currentSyncSchemaVersion,
    createdAt: Instant.parse(new Date(Date.UTC(2026, 9, 14, 12, 0, created++)).toISOString()),
  };
}

export function deleteOp(entityId: string, options: { operationId?: string; entityType?: string } = {}): OutboxOperation {
  const { operationId, entityType, entityId: id, knownServerVersion, schemaVersion, createdAt } = upsertOp(entityId, {}, options);
  return { type: 'delete_entity', operationId, entityType, entityId: id, knownServerVersion, schemaVersion, createdAt };
}

export async function pushRaw(backend: TestBackend, device: Device, operations: unknown[], installationId: string = installationA): Promise<Reply> {
  return call(backend, 'POST', '/v1/sync/push', device, { schemaVersion: currentSyncSchemaVersion, installationId, operations });
}

/** Push, der gelingen muss; liefert die geprüften Ergebnisse. */
export async function push(backend: TestBackend, device: Device, operations: OutboxOperation[], installationId?: string): Promise<PushResult[]> {
  const reply = await pushRaw(backend, device, operations, installationId);
  if (reply.status !== 200) throw new Error(`Push fehlgeschlagen: ${reply.status} ${JSON.stringify(reply.body)}`);
  return PushResponse.parse(reply.body).results;
}

export async function pullRaw(
  backend: TestBackend,
  device: Device,
  { cursor = null, pageToken = null, installationId = installationA }: { cursor?: string | null; pageToken?: string | null; installationId?: string } = {},
): Promise<Reply> {
  return call(backend, 'POST', '/v1/sync/pull', device, { schemaVersion: currentSyncSchemaVersion, installationId, cursor, pageToken });
}

export async function pullPage(backend: TestBackend, device: Device, options: { cursor?: string | null; pageToken?: PullPageToken | null } = {}) {
  const reply = await pullRaw(backend, device, options);
  if (reply.status !== 200) throw new Error(`Pull fehlgeschlagen: ${reply.status} ${JSON.stringify(reply.body)}`);
  return PullResponse.parse(reply.body);
}

/** Alle Seiten eines Pulls; liefert Änderungen, Seitenzahl und den endgültigen Cursor. */
export async function pullAll(backend: TestBackend, device: Device, cursor: SyncCursor | null = null) {
  const changes: PullResponse['changes'] = [];
  let pageToken: PullPageToken | null = null;
  let pages = 0;
  for (;;) {
    const page: PullResponse = await pullPage(backend, device, { cursor, pageToken });
    pages++;
    changes.push(...page.changes);
    if (page.next.type === 'complete') return { changes, pages, cursor: page.next.cursor };
    pageToken = page.next.pageToken;
  }
}
