import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';

import { errorCodeForLog } from './log.ts';

export type DatabaseSettings = {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
};

/** Datenbank oder laufende Transaktion; Module schreiben damit auch in der Transaktion des Aufrufers. */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT>;

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

/**
 * Führt eine Schreibtransaktion aus und wiederholt sie bei Unique-Verletzung (23505), Deadlock (40P01)
 * oder Serialisierungsfehler (40001): Der neue Versuch prüft alles erneut und kommt so zu einem stabilen
 * fachlichen Ausgang. Nach `attempts` Versuchen oder bei jedem anderen Fehler geht der Fehler durch.
 */
export async function transactionWithRetry<T>(database: Database, work: (tx: DbExecutor) => Promise<T>, { attempts = 5 } = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await database.db.transaction(work);
    } catch (error) {
      const code = sqlStateOf(error);
      if (attempt >= attempts || (code !== '23505' && code !== '40P01' && code !== '40001')) throw error;
    }
  }
}

/**
 * SQLSTATE eines Postgres-Fehlers, auch wenn Drizzle ihn als `cause` einpackt; sonst `undefined`
 * (https://www.postgresql.org/docs/current/errcodes-appendix.html).
 */
export function sqlStateOf(error: unknown): string | undefined {
  return sqlState(error) ?? sqlState((error as { cause?: unknown } | null)?.cause);
}

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}
