import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';

import type * as schema from './schema';

/** Synchrone Drizzle-Datenbank über dem Schema; expo-sqlite und better-sqlite3 liefern beide diese Form. */
export type SqliteDatabase = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** Eine geöffnete SQLite-Datei. */
export type SqliteConnection = {
  db: SqliteDatabase;
  close(): void;
  /** Schließt die Verbindung und löscht die Datei samt Begleitdateien (WAL, Journal). */
  destroy(): void;
};

/**
 * Öffnet eine SQLite-Datei mit eingeschalteten Fremdschlüsseln. Produktiv über expo-sqlite
 * (`expo-connection.ts`), in Tests über better-sqlite3 (`testing/`).
 */
export type OpenSqlite = (fileName: string) => SqliteConnection;
