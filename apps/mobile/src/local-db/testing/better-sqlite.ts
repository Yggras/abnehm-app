import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
export function createBetterSqliteFiles(): {
  openSqlite: OpenSqlite;
  openedFileNames(): string[];
  /** Die Dateien, die jetzt im Verzeichnis liegen, samt Begleitdateien. */
  existingFileNames(): string[];
  remove(): void;
} {
  const directory = mkdtempSync(join(tmpdir(), 'abnehm-local-db-'));
  const opened = new Set<string>();
  return {
    openSqlite: (fileName) => {
      opened.add(fileName);
      const path = join(directory, fileName);
      const client = new Database(path);
      client.pragma('journal_mode = WAL');
      client.pragma('foreign_keys = ON');
      return {
        db: drizzle(client, { schema }),
        close: () => client.close(),
        destroy: () => {
          client.close();
          for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${path}${suffix}`, { force: true });
        },
      };
    },
    openedFileNames: () => [...opened].sort(),
    existingFileNames: () => readdirSync(directory).sort(),
    remove: () => rmSync(directory, { recursive: true, force: true }),
  };
}
