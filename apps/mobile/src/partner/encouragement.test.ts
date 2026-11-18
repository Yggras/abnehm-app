/** @jest-environment node */
import { randomUUID } from 'node:crypto';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, ServerVersion, TimeZone } from '@abnehm/contracts/base';
import { sendEncouragementKey } from '@abnehm/contracts/partner';
import type { PushResult } from '@abnehm/contracts/sync';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { coupling, couplingMember, encouragement, person } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { personRow } from '../local-db/testing/rows';
import { createSyncRegistry, createSyncWriter, foundationSyncEntities } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { encouragementEntity, readEncourageSheet, sendEncouragement, sendEncouragementCommand } from './encouragement';

// Nachweis für #123: Anfeuern in der App (Spezifikation 5, Abschnitt 4) gegen eine echte SQLite-Datei
// mit den Migrationen der App. Die Anfeuerung entsteht lokal sofort samt Outbox-Operation; der Zähler
// des Sheets zählt die eigenen Anfeuerungen des lokalen Tags. Den Server prüft
// apps/backend/test/encouragement-sync-app.test.ts.

const PHILIPP = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const ANNA = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const COUPLING = EntityId.parse('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c01');
const start = { instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') };

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function setup({ coupled = true }: { coupled?: boolean } = {}) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database: LocalDatabase = await databases.open('konto_philipp');
  database.transaction((tx) => {
    const db = sqliteOf(tx);
    db.insert(person).values(personRow(PHILIPP, 'konto_philipp')).run();
    if (!coupled) return;
    const stamp = { createdAt: start.instant, updatedAt: start.instant, serverVersion: ServerVersion.parse('1') };
    db.insert(coupling).values({ id: COUPLING, personLowId: PHILIPP, personHighId: ANNA, status: 'aktiv', startedAt: start.instant, endedAt: null, reactivatedAt: null, ...stamp }).run();
    for (const [personId, displayName] of [[PHILIPP, 'Philipp'], [ANNA, 'Anna']] as const) {
      db.insert(couplingMember).values({ id: randomUUID(), couplingId: COUPLING, couplingStatus: 'aktiv', personId, role: null, displayName, ...stamp }).run();
    }
  });
  const clock = createTestClock(start);
  const registry = createSyncRegistry([...foundationSyncEntities, encouragementEntity]);
  const newId = () => EntityId.parse(randomUUID());
  const writer = createSyncWriter({ registry, clock, newId });
  const send = (messageKey: Parameters<typeof sendEncouragement>[2]) =>
    database.transaction((tx) => sendEncouragement(tx, { writer, newId, clock }, messageKey));
  const sheet = () => database.read((tx) => readEncourageSheet(tx, clock.read().localDate));
  return { database, clock, send, sheet };
}

const rows = (database: LocalDatabase) => database.read((tx) => sqliteOf(tx).select().from(encouragement).all());
const outbox = (database: LocalDatabase) => database.read((tx) => pendingOperations(tx, 100));

describe('Anfeuern in der App', () => {
  it('legt die Anfeuerung an den Partner lokal an und merkt sendEncouragement ohne Empfänger vor', async () => {
    const { database, send } = await setup();

    expect(send('stark_heute')).toEqual({ type: 'gesendet' });

    const [row] = rows(database);
    expect(row).toEqual(expect.objectContaining({
      couplingId: COUPLING, senderPersonId: PHILIPP, recipientPersonId: ANNA, messageKey: 'stark_heute', sentAt: start.instant,
      localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, thankedAt: null, serverVersion: null,
    }));
    expect(outbox(database)).toEqual([
      expect.objectContaining({
        type: 'sendEncouragement',
        businessKey: sendEncouragementKey(EntityId.parse(row!.id)),
        payload: { encouragementId: row!.id, messageKey: 'stark_heute', createdAt: start.instant, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120 },
      }),
    ]);
  });

  it('zählt im Sheet die eigenen Anfeuerungen des lokalen Tags herunter, auch über drei hinaus', async () => {
    const { send, sheet, clock } = await setup();
    expect(sheet()).toEqual({ type: 'coupled', partnerDisplayName: 'Anna', remainingPushes: 3 });

    send('du_schaffst_das');
    expect(sheet()).toMatchObject({ remainingPushes: 2 });
    send('ich_denk_an_dich');
    send('stolz_auf_dich');
    expect(sheet()).toMatchObject({ remainingPushes: 0 });
    // Weiter anfeuern geht; Anna sieht es dann ohne Push.
    expect(send('gemeinsam_fuer_momo')).toEqual({ type: 'gesendet' });
    expect(sheet()).toMatchObject({ remainingPushes: 0 });

    // Am nächsten lokalen Tag zählt der Tag neu (Mitternacht in Berlin ist 22:00 UTC).
    clock.set(Instant.parse('2026-10-14T22:00:00.000Z'));
    expect(sheet()).toMatchObject({ remainingPushes: 3 });
  });

  it('erhaltene Anfeuerungen des Partners zählen nicht', async () => {
    const { database, sheet } = await setup();
    database.transaction((tx) => sqliteOf(tx).insert(encouragement).values({
      id: randomUUID(), couplingId: COUPLING, senderPersonId: ANNA, recipientPersonId: PHILIPP, messageKey: 'stark_heute', sentAt: start.instant,
      localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120, pushStatus: 'ausstehend', thankedAt: null,
      createdAt: start.instant, updatedAt: start.instant, deletedAt: null, serverVersion: ServerVersion.parse('2'),
    }).run());

    expect(sheet()).toMatchObject({ remainingPushes: 3 });
  });

  it('ohne aktive Kopplung sendet sie nichts', async () => {
    const { database, send, sheet } = await setup({ coupled: false });

    expect(sheet()).toEqual({ type: 'solo' });
    expect(send('stark_heute')).toEqual({ type: 'nicht_gekoppelt' });
    expect(rows(database)).toEqual([]);
    expect(outbox(database)).toEqual([]);
  });

  it('lehnt der Server dauerhaft ab, verschwindet die unbestätigte Anfeuerung', async () => {
    const { database, send } = await setup();
    send('stark_heute');
    const [operation] = outbox(database);
    if (operation === undefined || !('businessKey' in operation)) throw new Error('Operation fehlt');
    const rejection: Extract<PushResult, { type: 'permanently_rejected' }> = {
      type: 'permanently_rejected', operationId: operation.operationId, error: { code: 'forbidden', retryable: false },
      canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId },
    };

    database.transaction((tx) => sendEncouragementCommand.reconcileRejected(tx, operation, rejection));

    expect(rows(database)).toEqual([]);
  });
});
