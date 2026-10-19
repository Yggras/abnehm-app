/** @jest-environment node */
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { z } from 'zod';

import { createLocalDatabases } from '../local-db/local-databases';
import { outbox, person, waterEntry } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { personRow } from '../local-db/testing/rows';
import { createLocalCommandRegistry } from './commands';
import { createSyncWriter } from './outbox';
import { createSyncEngine } from './engine';
import { createSyncRegistry } from './registry';

const personId = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01');
const entryId = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02');
const opId = EntityId.parse('0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b03');
const now = Instant.parse('2026-10-14T12:00:00.000Z');

it('schreibt Fachzeile und genau eine Operation atomar; eine Ablehnung rollt beide zurück', async () => {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  try {
    const database = await databases.open('konto_a');
    database.transaction((tx) => sqliteOf(tx).insert(person).values(personRow(personId, 'konto_a')).run());
    const clock = createTestClock({ instant: now, timeZone: TimeZone.parse('Europe/Berlin') });
    const writer = createSyncWriter({ registry: createSyncRegistry([]), clock, newId: () => opId });
    let reject = true;
    const commands = createLocalCommandRegistry({ database, writer, commands: [{
      type: 'saveMealFavorite', payload: z.strictObject({ amountMl: z.int().positive() }), referencePaths: [],
      apply(tx, payload) {
        sqliteOf(tx).insert(waterEntry).values({ id: entryId, personId, amountMl: z.number().parse(payload.amountMl), origin: 'manuell',
          loggedAt: now, localDate: '2026-10-14', timeZone: 'Europe/Berlin', utcOffsetMinutes: 120,
          createdAt: now, updatedAt: now }).run();
        if (reject) throw new Error('Fachregel abgelehnt');
        return [{ entityType: 'water_entry', entityId: entryId }];
      },
      reconcileRejected(tx) { sqliteOf(tx).delete(waterEntry).run(); },
    }] });
    expect(() => commands.execute('saveMealFavorite', 'goal:2026-10-14:1', { amountMl: 250 })).toThrow('Fachregel abgelehnt');
    expect(database.read((tx) => sqliteOf(tx).select().from(waterEntry).all())).toHaveLength(0);
    expect(database.read((tx) => sqliteOf(tx).select().from(outbox).all())).toHaveLength(0);
    reject = false;
    commands.execute('saveMealFavorite', 'goal:2026-10-14:1', { amountMl: 250 });
    expect(database.read((tx) => sqliteOf(tx).select().from(waterEntry).all())).toHaveLength(1);
    expect(database.read((tx) => sqliteOf(tx).select().from(outbox).all())).toMatchObject([{ type: 'saveMealFavorite', businessKey: 'goal:2026-10-14:1' }]);
    expect(() => commands.execute('saveMealFavorite', 'goal:other', { amountMl: -1 })).toThrow();
    const engine = createSyncEngine({ database, registry: createSyncRegistry([]), clock, commands, installationId: opId,
      transport: {
        async push(request) {
          return { type: 'ok' as const, body: { results: request.operations.map((operation) => ({
            type: 'permanently_rejected' as const, operationId: operation.operationId,
            error: { code: 'conflict' as const, retryable: false },
            canonical: { type: 'absent' as const, entityType: 'command_result', entityId: operation.operationId },
          })) } };
        },
        async pull() { return { type: 'ok' as const, body: { changes: [], next: { type: 'complete' as const, cursor: '0' as never } } }; },
      },
    });
    expect(await engine.sync()).toEqual({ push: 'done', pull: 'done' });
    expect(database.read((tx) => sqliteOf(tx).select().from(waterEntry).all())).toHaveLength(0);
    expect(database.read((tx) => sqliteOf(tx).select().from(outbox).all())).toHaveLength(0);
  } finally {
    databases.lock(); files.remove();
  }
});
