import { onTestFinished } from 'vitest';

import type { Clock } from '@abnehm/clock';

import { createBackend, type Backend } from '../../src/backend.ts';
import type { Database } from '../../src/database.ts';
import { migrateDatabase } from '../../src/db/migrate.ts';
import { createTestDatabase } from './postgres.ts';

/** Basis-URL der Test-App; Anfragen gehen über `app.request`, nicht übers Netz. */
export const testBaseUrl = 'http://backend.test';

export type TestBackend = Backend & { database: Database };

/**
 * Die echte Hono-App über einer gegebenen Datenbank, mit denselben Modulen wie `src/main.ts`.
 * Ohne `clock` gilt die Systemuhr; Better Auth rechnet Sitzungsablauf ohnehin mit `Date`, deshalb
 * steuern Tests die Zeit dort mit `vi.setSystemTime`.
 */
export function createTestApp(database: Database, { clock, syncPullPageSize }: TestAppOptions = {}): TestBackend {
  const authSettings = { secret: 'test-secret-mit-mindestens-zweiunddreissig-zeichen', baseUrl: testBaseUrl, trustedProxies: [] };
  return { ...createBackend({ database, authSettings, clock, syncPullPageSize }), database };
}

export type TestAppOptions = { clock?: Clock; syncPullPageSize?: number };

/** Frisch migrierte, eigene Datenbank samt App; wird nach dem Test verworfen. */
export async function createTestBackend(options: TestAppOptions = {}): Promise<TestBackend> {
  const database = await createTestDatabase();
  onTestFinished(() => database.drop());
  await migrateDatabase(database.handle);
  return createTestApp(database.handle, options);
}
