import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import type { OpenSqlite } from './connection';
import * as schema from './schema';

/**
 * Produktiver Adapter: eine Datei je Konto im Standardverzeichnis von expo-sqlite
 * (https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/). Beobachtet wird über den eigenen
 * Commit-Hinweis von `LocalDatabase.observe`, nicht über den Change-Listener von expo-sqlite:
 * Der meldet Änderungen aller geöffneten Dateien und wüsste nichts vom Kontowechsel.
 */
export const openExpoSqlite: OpenSqlite = (fileName) => {
  const client = openDatabaseSync(fileName);
  client.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    db: drizzle(client, { schema }),
    close: () => client.closeSync(),
  };
};
