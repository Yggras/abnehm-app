import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { errorCodeForLog } from './log.ts';

export type DatabaseSettings = {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
};

export type Database = {
  db: NodePgDatabase;
  close(): Promise<void>;
};

export function openDatabase(settings: DatabaseSettings): Database {
  const pool = new pg.Pool({ ...pgConnection(settings), max: 10, connectionTimeoutMillis: 5_000 });
  // node-postgres: Ohne Listener wird der Fehler einer ruhenden Verbindung zum „uncaught error“
  // und kann den Prozess beenden (https://node-postgres.com/apis/pool#error).
  pool.on('error', (error) => {
    console.error('[datenbank] Ruhende Verbindung verloren:', errorCodeForLog(error));
  });
  return {
    db: drizzle({ client: pool }),
    close: () => pool.end(),
  };
}

/** Verbindungsangaben im Format von node-postgres. */
export function pgConnection({ host, port, name, user, password }: DatabaseSettings): pg.ClientConfig {
  return { host, port, database: name, user, password };
}
