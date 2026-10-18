import { fileURLToPath } from 'node:url';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { Database } from '../database.ts';

/** Ordner der mit drizzle-kit erzeugten Migrationen (apps/backend/drizzle). */
export const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Bringt die Datenbank auf den Stand der mitgelieferten Migrationen. Drizzle merkt sich angewandte
 * Migrationen in `drizzle.__drizzle_migrations` und führt sie in einer Transaktion aus
 * (https://orm.drizzle.team/docs/migrations); ein erneuter Aufruf ist deshalb folgenlos.
 */
export async function migrateDatabase(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder });
}
