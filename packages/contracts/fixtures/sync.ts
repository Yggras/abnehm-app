import { z } from 'zod';

import { EntityId, Instant, LocalDate, TimeZone } from '../src/base.ts';
import {
  CanonicalChange,
  CanonicalIdMapping,
  CommandType,
  CanonicalRecord,
  CanonicalState,
  CanonicalTombstone,
  EntityData,
  InstallationId,
  OutboxOperation,
  PullPageToken,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  PushResult,
  SyncEntityType,
  SyncSchemaVersion,
} from '../src/sync.ts';
import { fixtures, without } from './define.ts';
import { installation, now, operation, operation2, philipp, waterEntry } from './ids.ts';

const water = { amountMl: 250, loggedAt: now, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 };

const upsert = {
  type: 'upsert_entity',
  operationId: operation,
  entityType: 'water_entry',
  entityId: waterEntry,
  payload: water,
  knownServerVersion: null,
  schemaVersion: 1,
  createdAt: now,
} as const;

const remove = { ...without(upsert, 'payload'), type: 'delete_entity', operationId: operation2, knownServerVersion: '1841' } as const;

const record = { type: 'record', entityType: 'water_entry', entityId: waterEntry, serverVersion: '1842', data: water } as const;
const tombstone = { type: 'tombstone', entityType: 'water_entry', entityId: waterEntry, serverVersion: '1843', deletedAt: now } as const;
const absent = { type: 'absent', entityType: 'water_entry', entityId: waterEntry } as const;
const forbidden = { type: 'permanently_rejected', operationId: operation, error: { code: 'forbidden', retryable: false }, canonical: absent } as const;

export const syncFixtures = {
  CommandType: fixtures(CommandType, {
    valid: { 'Tageszielerfüllung': 'completeDailyGoal' },
    invalid: { 'unbekannter Befehl': 'inventSomething' },
  }),
  CanonicalIdMapping: fixtures(CanonicalIdMapping, {
    valid: { 'lokales Duplikat': { entityType: 'daily_goal_completion', from: operation, to: operation2 } },
    invalid: { 'ungültige kanonische ID': { entityType: 'daily_goal_completion', from: operation, to: 'invalid' } },
  }),
  SyncSchemaVersion: fixtures(SyncSchemaVersion, {
    valid: { 'erste Version': 1 },
    invalid: { 'null': 0, 'als Zeichenfolge': '1' },
  }),
  SyncEntityType: fixtures(SyncEntityType, {
    valid: { 'Wassereintrag': 'water_entry', 'Person': 'person' },
    invalid: { 'Tabellenname mit Schema': 'public.water_entry', 'camelCase': 'waterEntry' },
  }),
  InstallationId: fixtures(InstallationId, {
    valid: { 'UUID': installation },
    invalid: { 'Gerätename': 'Philipps iPhone' },
  }),
  EntityData: fixtures(EntityData, {
    valid: { 'Felder einer Entität': water, 'leer': {} },
    invalid: { 'Liste': [water], 'Spalte statt Feld': { amount_ml: 250 } },
  }),
  OutboxOperation: fixtures(OutboxOperation, {
    valid: { 'Create': upsert, 'Update': { ...upsert, knownServerVersion: '1841' }, 'Löschen': remove, 'Fachbefehl': { type: 'completeDailyGoal', operationId: operation, businessKey: 'goal:1', payload: {}, knownServerVersion: null, schemaVersion: 1, createdAt: now } },
    invalid: {
      'Patch statt vollständiger Nutzlast': { ...upsert, patch: { amountMl: 300 } },
      'ohne bekannte Serverversion': without(upsert, 'knownServerVersion'),
      'Löschen mit Nutzlast': { ...remove, payload: water },
      'unbekannter Typ': { ...upsert, type: 'patch_entity' },
      'ohne Schema-Version': without(upsert, 'schemaVersion'),
    },
  }),
  CanonicalRecord: fixtures(CanonicalRecord, {
    valid: { 'Wassereintrag': record },
    invalid: { 'ohne Serverversion': without(record, 'serverVersion'), 'Serverversion als Zahl': { ...record, serverVersion: 1842 } },
  }),
  CanonicalTombstone: fixtures(CanonicalTombstone, {
    valid: { 'gelöschter Wassereintrag': tombstone },
    invalid: { 'mit Inhalt': { ...tombstone, data: water } },
  }),
  CanonicalChange: fixtures(CanonicalChange, {
    valid: { 'Datensatz': record, 'Löschmarkierung': tombstone },
    invalid: { 'abwesend': absent },
  }),
  CanonicalState: fixtures(CanonicalState, {
    valid: { 'Datensatz': record, 'Löschmarkierung': tombstone, 'abwesend': absent },
    invalid: { 'abwesend mit Inhalt': { ...absent, data: water } },
  }),
  PushResult: fixtures(PushResult, {
    valid: {
      'übernommen': { type: 'applied', operationId: operation, canonical: record },
      'schon übernommen': { type: 'already_applied', operationId: operation, canonical: record },
      'abgelehnt mit kanonischer Löschmarkierung': {
        type: 'permanently_rejected',
        operationId: operation,
        error: { code: 'conflict', retryable: false },
        canonical: tombstone,
      },
      'verboten': forbidden,
    },
    invalid: {
      'verboten mit kanonischem Datensatz': { ...forbidden, canonical: record },
      'verboten mit Kontext': { ...forbidden, error: { code: 'forbidden', context: { owner: philipp }, retryable: false } },
      'Ablehnung wiederholbar': { ...forbidden, error: { code: 'conflict', retryable: true } },
      'übernommen ohne kanonisches Ergebnis': { type: 'applied', operationId: operation },
    },
  }),
  PushRequest: fixtures(PushRequest, {
    valid: { 'Create und Löschen': { schemaVersion: 1, installationId: installation, operations: [upsert, remove] } },
    invalid: {
      'leer': { schemaVersion: 1, installationId: installation, operations: [] },
      'doppelte Operations-ID': { schemaVersion: 1, installationId: installation, operations: [upsert, upsert] },
      'mit Personen-ID': { schemaVersion: 1, installationId: installation, personId: philipp, operations: [upsert] },
    },
  }),
  PushResponse: fixtures(PushResponse, {
    valid: { 'je Operation ein Ergebnis': { results: [{ type: 'applied', operationId: operation, canonical: record }, forbidden] } },
    invalid: { 'Ergebnis ohne Operations-ID': { results: [{ type: 'applied', canonical: record }] } },
  }),
  PullPageToken: fixtures(PullPageToken, {
    valid: { 'Obergrenze und Position': 'v1.0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01.1900.1850' },
    invalid: { 'JSON': '{"upper":1900}' },
  }),
  PullRequest: fixtures(PullRequest, {
    valid: {
      'vollständiger Pull': { schemaVersion: 1, installationId: installation, cursor: null, pageToken: null },
      'ab Cursor': { schemaVersion: 1, installationId: installation, cursor: '1841', pageToken: null },
    },
    invalid: {
      'ohne Installationskennung': { schemaVersion: 1, cursor: null, pageToken: null },
      'Cursor als Zahl': { schemaVersion: 1, installationId: installation, cursor: 1841, pageToken: null },
    },
  }),
  PullResponse: fixtures(PullResponse, {
    valid: {
      'weitere Seite': { changes: [record], next: { type: 'page', pageToken: 'v1.0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01.1900.1842' } },
      'letzte Seite': { changes: [tombstone], next: { type: 'complete', cursor: '1900' } },
    },
    invalid: {
      'abwesende Entität': { changes: [absent], next: { type: 'complete', cursor: '1900' } },
      'ohne Fortsetzung': { changes: [] },
    },
  }),
};

/**
 * Test-Entität für Sync-Tests auf der Tabelle `water_entry`. Sie ist kein Teil des Transportkatalogs:
 * Den echten Wassereintrag meldet Spezifikation 3 an. Die Mengengrenze fehlt bewusst, damit Tests auch
 * eine Nutzlast schicken können, die erst an der Datenbankregel scheitert.
 */
export const TestWaterUpsert = z.strictObject({
  amountMl: z.int().positive(),
  loggedAt: Instant,
  localDate: LocalDate,
  timeZone: TimeZone,
  utcOffsetMinutes: z.int(),
});
export type TestWaterUpsert = z.infer<typeof TestWaterUpsert>;

export const TestWaterRecord = z.strictObject({ ...TestWaterUpsert.shape, personId: EntityId, createdAt: Instant, updatedAt: Instant });
export type TestWaterRecord = z.infer<typeof TestWaterRecord>;
