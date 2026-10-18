import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { Instant } from '@abnehm/contracts/base';
import type { StatusResponse } from '@abnehm/contracts/status';

import { guard, policies } from './authorization/authorization.ts';
import type { Database } from './database.ts';
import { errorCodeForLog } from './log.ts';

type Ok = Extract<StatusResponse, { type: 'ok' }>;
type Unavailable = Extract<StatusResponse, { type: 'database_unavailable' }>;

/** Status-Endpunkt, öffentlich: antwortet erst, nachdem Postgres eine Abfrage beantwortet hat. */
export function statusRoutes({ database }: { database: Database }) {
  return new Hono().get('/status', guard(policies.public()), async (c) => {
    let databaseTime: Instant;
    try {
      const result = await database.db.execute<{ database_time: string }>(
        sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as database_time`,
      );
      databaseTime = Instant.parse(result.rows[0]?.database_time);
    } catch (error) {
      console.error('[status] Datenbank nicht erreichbar:', errorCodeForLog(error));
      return c.json({ type: 'database_unavailable' } satisfies Unavailable, 503);
    }
    return c.json({ type: 'ok', databaseTime } satisfies Ok, 200);
  });
}
