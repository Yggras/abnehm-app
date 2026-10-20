import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { inject } from 'vitest';

import { openDatabase, pgConnection, type Database, type DatabaseSettings } from '../../src/database.ts';

/** Zugang zum Test-Postgres dieses Laufs (siehe `postgres-server.ts`). */
export function testServerSettings(): DatabaseSettings {
  return inject('postgres');
}

/**
 * Legt eine nur für den aufrufenden Test bestimmte Datenbank an: leer oder als Kopie von `template`
 * (https://www.postgresql.org/docs/current/manage-ag-templatedbs.html).
 */
export async function createTestDatabase({ template }: { template?: string } = {}): Promise<{ handle: Database; drop(): Promise<void> }> {
  const server = testServerSettings();
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  await withAdminClient(server, (admin) => admin.query(`CREATE DATABASE "${name}"${template === undefined ? '' : ` TEMPLATE "${template}"`}`));
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
