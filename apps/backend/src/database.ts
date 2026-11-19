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
  /**
   * Hört auf `NOTIFY` im Kanal `channel` (https://www.postgresql.org/docs/current/sql-listen.html) über
   * eine eigene Verbindung des Pools. Postgres stellt eine Benachrichtigung aus einer Transaktion erst nach
   * deren Commit zu, nach einem Rollback nie (https://www.postgresql.org/docs/current/sql-notify.html).
   * Bricht die Verbindung ab, verbindet sich der Listener nach kurzer Pause neu; Benachrichtigungen
   * dazwischen gehen verloren. Liefert die Funktion zum Beenden.
   */
  listen(channel: string, onNotify: () => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
};

/** Pause vor dem erneuten Verbinden eines abgebrochenen Listeners; Designwert, nicht belegt. */
const LISTEN_RECONNECT_MS = 5_000;

export function openDatabase(settings: DatabaseSettings): Database {
  const pool = new pg.Pool({ ...pgConnection(settings), max: 10, connectionTimeoutMillis: 5_000 });
  // node-postgres: Ohne Listener wird der Fehler einer ruhenden Verbindung zum „uncaught error“
  // und kann den Prozess beenden (https://node-postgres.com/apis/pool#error).
  pool.on('error', (error) => {
    console.error('[datenbank] Ruhende Verbindung verloren:', errorCodeForLog(error));
  });

  async function listen(channel: string, onNotify: () => void) {
    if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error(`Ungültiger Kanal: ${channel}`);
    let stopped = false;
    let client: pg.PoolClient | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      const connected = await pool.connect();
      // Eine Verbindung mit LISTEN gehört dem Listener, bis er endet; Fehler beenden sie (`release(error)`).
      connected.on('notification', (message) => {
        if (message.channel === channel) onNotify();
      });
      connected.on('error', (error) => {
        console.error(`[datenbank] Listener ${channel} verloren:`, errorCodeForLog(error));
        connected.release(error);
        if (client === connected) client = null;
        if (!stopped) retry = setTimeout(() => void connect().catch(reconnectLater), LISTEN_RECONNECT_MS);
      });
      try {
        await connected.query(`LISTEN ${channel}`);
      } catch (error) {
        connected.release(error instanceof Error ? error : true);
        throw error;
      }
      // Beendet, während die Verbindung entstand (etwa ein Reconnect beim Herunterfahren): gleich zurückgeben,
      // sonst hielte sie `pool.end()` auf.
      if (stopped) {
        connected.release();
        return;
      }
      client = connected;
    }
    function reconnectLater(error: unknown) {
      console.error(`[datenbank] Listener ${channel} nicht verbunden:`, errorCodeForLog(error));
      if (!stopped) retry = setTimeout(() => void connect().catch(reconnectLater), LISTEN_RECONNECT_MS);
    }

    await connect();
    return async () => {
      stopped = true;
      if (retry !== null) clearTimeout(retry);
      const current = client;
      client = null;
      if (current === null) return;
      await current.query(`UNLISTEN ${channel}`).catch(() => {});
      current.release();
    };
  }

  return {
    db: drizzle({ client: pool }),
    listen,
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
