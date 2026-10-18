import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import type { OpenSqlite } from './connection';
import * as schema from './schema';

/**
 * Produktiver Adapter: eine Datei je Konto im Standardverzeichnis von expo-sqlite
 * (https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/). Beobachtet wird über den eigenen
 * Commit-Hinweis von `LocalDatabase.observe`, nicht über `useLiveQuery` von Drizzle: Es hört auf
 * den globalen Change-Listener von expo-sqlite und vergleicht nur den Tabellennamen, nicht die Datei
 * (https://unpkg.com/drizzle-orm@0.45.4/expo-sqlite/query.js; Ereignisfelder `databaseFilePath`
 * und `tableName` laut `DatabaseChangeEvent` in der SQLite-Doku oben). Vom Kontowechsel wüsste es nichts.
 */
export const openExpoSqlite: OpenSqlite = (fileName) => {
  const client = openDatabaseSync(fileName);
  client.execSync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return {
    db: drizzle(client, { schema }),
    close: () => client.closeSync(),
  };
};
