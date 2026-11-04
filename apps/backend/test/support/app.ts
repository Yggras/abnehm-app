import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onTestFinished } from 'vitest';

import type { Clock } from '@abnehm/clock';

import { createFakeMealVision, type FakeMealVision } from '../../dev/meal-vision/fake-analyzer.ts';
import { createBackend, type Backend } from '../../src/backend.ts';
import type { Database } from '../../src/database.ts';
import type { MealVisionAnalyzer } from '../../src/nutrition/meal-vision.ts';
import { migratedTemplate } from './postgres-server.ts';
import { createTestDatabase } from './postgres.ts';

/** Basis-URL der Test-App; Anfragen gehen über `app.request`, nicht übers Netz. */
export const testBaseUrl = 'http://backend.test';

export type TestBackend = Backend & {
  database: Database;
  /** Eigenes Verzeichnis der Fotoentwürfe; es entsteht erst mit dem ersten Bild. */
  photoStorageDirectory: string;
  /** Der Fake der Fotoanalyse, sofern der Test keinen eigenen Analyzer übergibt. */
  fakeMealVision: FakeMealVision;
};

/**
 * Die echte Hono-App über einer gegebenen Datenbank, mit denselben Modulen wie `src/main.ts`.
 * Ohne `clock` gilt die Systemuhr; Better Auth rechnet Sitzungsablauf ohnehin mit `Date`, deshalb
 * steuern Tests die Zeit dort mit `vi.setSystemTime`. Die Fotoanalyse läuft über den Fake.
 */
export function createTestApp(database: Database, { clock, syncPullPageSize, mealVisionAnalyzer }: TestAppOptions = {}): TestBackend {
  const authSettings = { secret: 'test-secret-mit-mindestens-zweiunddreissig-zeichen', baseUrl: testBaseUrl, trustedProxies: [] };
  const invitationSettings = { codeSecret: 'test-einladungs-secret-mit-mindestens-32-zeichen' };
  const photoStorageDirectory = join(tmpdir(), `abnehm-fotos-${randomUUID()}`);
  const fakeMealVision = createFakeMealVision();
  const backend = createBackend({
    database,
    authSettings,
    invitationSettings,
    clock,
    syncPullPageSize,
    photoStorageDirectory,
    mealVisionAnalyzer: mealVisionAnalyzer ?? fakeMealVision.analyzer,
  });
  return { ...backend, database, photoStorageDirectory, fakeMealVision };
}

export type TestAppOptions = { clock?: Clock; syncPullPageSize?: number; mealVisionAnalyzer?: MealVisionAnalyzer };

/** Frisch migrierte, eigene Datenbank samt App; wird nach dem Test verworfen, ebenso die Fotoentwürfe. */
export async function createTestBackend(options: TestAppOptions = {}): Promise<TestBackend> {
  const database = await createTestDatabase({ template: migratedTemplate });
  onTestFinished(() => database.drop());
  const backend = createTestApp(database.handle, options);
  onTestFinished(() => rm(backend.photoStorageDirectory, { recursive: true, force: true }));
  return backend;
}
