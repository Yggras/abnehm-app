import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import type { OpenSqlite } from '../connection';
import * as schema from '../schema';

/**
 * Test-Adapter: echte SQLite-Dateien über better-sqlite3 in einem eigenen temporären Verzeichnis,
 * mit denselben Pragmas wie der produktive expo-sqlite-Adapter. Nur in Tests mit
 * `@jest-environment node` nutzbar.
 */
export function createBetterSqliteFiles(): { openSqlite: OpenSqlite; files(): string[]; remove(): void } {
  const directory = mkdtempSync(join(tmpdir(), 'abnehm-local-db-'));
  const opened = new Set<string>();
  return {
    openSqlite: (fileName) => {
      opened.add(fileName);
      const client = new Database(join(directory, fileName));
      client.pragma('journal_mode = WAL');
      client.pragma('foreign_keys = ON');
      return { db: drizzle(client, { schema }), close: () => client.close() };
    },
    files: () => [...opened].sort(),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}
