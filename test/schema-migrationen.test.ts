import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it, onTestFinished } from 'vitest';

// Die eingecheckten Migrationen müssen zum Schema passen: drizzle-kit erzeugt aus dem aktuellen
// Schema gegen eine Kopie der Migrationen keine weitere. Fehlt eine Migration, schlägt der Test fehl,
// bis sie mit `drizzle-kit generate` erzeugt und eingecheckt ist.

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const drizzleKit = join(root, 'node_modules/.bin/drizzle-kit');

const projects = [
  {
    name: 'Postgres (Backend)',
    config: { dialect: 'postgresql', schema: 'apps/backend/src/db/schema/index.ts' },
    migrations: 'apps/backend/drizzle',
  },
  {
    name: 'SQLite (App)',
    config: { dialect: 'sqlite', driver: 'expo', schema: 'apps/mobile/src/local-db/schema/index.ts' },
    migrations: 'apps/mobile/src/local-db/migrations',
  },
];

describe('Migrationen passen zum Schema', () => {
  it.each(projects)('$name', async ({ config, migrations }) => {
    const directory = mkdtempSync(join(tmpdir(), 'abnehm-migrationen-'));
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    const out = join(directory, 'migrations');
    cpSync(join(root, migrations), out, { recursive: true });
    const configFile = join(directory, 'drizzle.config.json');
    // drizzle-kit erwartet `out` relativ zum Arbeitsverzeichnis.
    writeFileSync(configFile, JSON.stringify({ ...config, schema: join(root, config.schema), out: relative(root, out) }));
    const before = readdirSync(out).sort();

    const { stdout, stderr } = await run(drizzleKit, ['generate', '--config', configFile], { cwd: root });

    expect(stdout + stderr).toContain('No schema changes');
    expect(readdirSync(out).sort()).toEqual(before);
  }, 60_000);
});
