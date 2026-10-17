import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export type DatabaseSettings = {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
};

export type Database = {
  db: NodePgDatabase;
  close(): Promise<void>;
};

export function openDatabase(settings: DatabaseSettings): Database {
  const pool = new pg.Pool({ ...settings, max: 10, connectionTimeoutMillis: 5_000 });
  // Ohne Listener beendet ein Fehler einer ruhenden Verbindung (z. B. Postgres-Neustart) den Prozess.
  pool.on('error', (error) => {
    console.error('[datenbank] Ruhende Verbindung verloren:', errorCode(error));
  });
  return {
    db: drizzle({ client: pool }),
    close: () => pool.end(),
  };
}

/** Fehlerkennung ohne Meldungstext, damit keine Abfragedaten ins Log geraten. */
export function errorCode(error: unknown): string {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  return error instanceof Error ? error.name : 'unbekannt';
}
