import { render, screen, act } from '@testing-library/react-native';
import { View } from 'react-native';
import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone } from '@abnehm/contracts/base';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { createSyncEngine } from '../sync/engine';
import { createSyncRegistry } from '../sync/registry';
import { appendOperation } from '../sync/outbox';
import { syncStatusSource } from '../session/sync-status-source';
import { SyncWarning } from './SyncWarning';

test('der Sicherungshinweis erscheint mit der Testuhr nach 24 Stunden und verschwindet nach Bestätigung', async () => {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: () => {} });
  const database = await databases.open('konto_a');
  const at = Instant.parse('2026-10-14T12:00:00.000Z');
  const clock = createTestClock({ instant: at, timeZone: TimeZone.parse('Europe/Berlin') });
  const id = EntityId.parse('10000000-0000-4000-8000-000000000001');
  database.transaction((tx) => appendOperation(tx, { type: 'delete_entity', operationId: id, entityType: 'water_entry', entityId: id,
    knownServerVersion: null, schemaVersion: 3, createdAt: at }));
  const engine = createSyncEngine({ database, registry: createSyncRegistry([]), clock, installationId: id,
    transport: { push: async (request) => ({ type: 'ok', body: { results: request.operations.map((operation) => ({
      type: 'applied' as const, operationId: operation.operationId,
      canonical: { type: 'absent' as const, entityType: 'water_entry', entityId: id },
    })) } }), pull: async () => ({ type: 'ok', body: { changes: [], next: { type: 'complete', cursor: '0' as never } } }) } });
  syncStatusSource.publish(engine.status());
  await render(<View><SyncWarning /></View>);
  expect(screen.queryByText('Noch nicht gesichert – verbinde dich mit dem Internet')).toBeNull();
  clock.advanceBy(24 * 60 * 60 * 1000 + 1);
  await act(async () => syncStatusSource.publish(engine.status()));
  expect(screen.getByText('Noch nicht gesichert – verbinde dich mit dem Internet')).toBeTruthy();
  await engine.sync();
  await act(async () => syncStatusSource.publish(engine.status()));
  expect(screen.queryByText('Noch nicht gesichert – verbinde dich mit dem Internet')).toBeNull();
  databases.lock(); files.remove();
});
