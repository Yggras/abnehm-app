import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { inject } from 'vitest';

import { openDatabase, pgConnection, type Database, type DatabaseSettings } from '../../src/database.ts';

/** Zugang zum Test-Postgres dieses Laufs (siehe `postgres-server.ts`). */
export function testServerSettings(): DatabaseSettings {
  return inject('postgres');
}

/** Legt eine leere, nur für den aufrufenden Test bestimmte Datenbank an. */
export async function createTestDatabase(): Promise<{ handle: Database; drop(): Promise<void> }> {
  const server = testServerSettings();
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  await withAdminClient(server, (admin) => admin.query(`CREATE DATABASE "${name}"`));
  const handle = openDatabase({ ...server, name });
  return {
    handle,
    drop: async () => {
      await handle.close();
      await withAdminClient(server, (admin) => admin.query(`DROP DATABASE "${name}" WITH (FORCE)`));
    },
  };
}

async function withAdminClient(server: DatabaseSettings, action: (client: pg.Client) => Promise<unknown>) {
  const client = new pg.Client(pgConnection(server));
  await client.connect();
  try {
    await action(client);
  } finally {
    await client.end();
  }
}
