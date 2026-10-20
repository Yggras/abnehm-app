import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import pg from 'pg';
import type { TestProject } from 'vitest/node';

import { openDatabase, pgConnection, type DatabaseSettings } from '../../src/database.ts';
import { migrateDatabase } from '../../src/db/migrate.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    postgres: DatabaseSettings;
  }
}

/** Vollständig migrierte Vorlage, die der Testlauf einmal anlegt (siehe `createMigratedTemplate`). */
export const migratedTemplate = 'test_migrated_template';

const run = promisify(execFile);
const composeFile = fileURLToPath(new URL('../compose.yaml', import.meta.url));

/**
 * Startet für jeden Testlauf ein eigenes, flüchtiges Postgres (tmpfs, nur auf
 * 127.0.0.1, zufälliges Passwort) und räumt es danach wieder ab.
 */
export default async function startTestPostgres(project: TestProject) {
  const projectName = `abnehm-test-${process.pid}-${randomBytes(3).toString('hex')}`;
  const password = randomBytes(24).toString('hex');
  const compose = (...args: string[]) =>
    run('docker', ['compose', '--project-name', projectName, '--file', composeFile, ...args], {
      env: { ...process.env, TEST_POSTGRES_PASSWORD: password },
    });

  await compose('up', '--detach', '--wait', '--quiet-pull');
  const { stdout } = await compose('port', 'postgres', '5432');
  const published = /^(?<host>[\d.]+):(?<port>\d+)$/.exec(stdout.trim())?.groups;
  if (published?.host === undefined || published.port === undefined) {
    throw new Error(`Unerwartete Portangabe von docker compose: ${stdout}`);
  }

  const server = { host: published.host, port: Number(published.port), user: 'test', password, name: 'test' };
  await createMigratedTemplate(server);
  project.provide('postgres', server);

  return async () => {
    await compose('down', '--volumes', '--timeout', '0');
  };
}

/** Migriert einmal pro Lauf in eine Vorlage, von der `createTestBackend` jede Testdatenbank kopiert. */
async function createMigratedTemplate(server: DatabaseSettings) {
  const admin = new pg.Client(pgConnection(server));
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${migratedTemplate}"`);
  } finally {
    await admin.end();
  }
  const template = openDatabase({ ...server, name: migratedTemplate });
  try {
    await migrateDatabase(template);
  } finally {
    // Postgres kopiert eine Vorlage nur, solange niemand mit ihr verbunden ist.
    await template.close();
  }
}
