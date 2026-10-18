import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';

import type { AuthModule } from './auth/auth-module.ts';
import type { Authorization } from './authorization/authorization.ts';
import type { Database } from './database.ts';
import { bootstrapRoutes } from './person/bootstrap.ts';
import { statusRoutes } from './status.ts';

export type AppDependencies = {
  database: Database;
  clock: Clock;
  auth: AuthModule;
  authorization: Authorization;
};

/**
 * Die vollständige Hono-App. Alle Pfade sind versioniert (`/v1/…`), Better Auth unter `/v1/auth`.
 * Jede Route beginnt mit einem Guard der zentralen Autorisierung; `enforce` lehnt alle anderen ab.
 */
export function createApp({ database, clock, auth, authorization }: AppDependencies) {
  return new Hono()
    .use('*', authorization.enforce)
    .route('/v1', statusRoutes({ database }))
    .route('/v1', auth.routes)
    .route('/v1', bootstrapRoutes({ database, clock }));
}

export type App = ReturnType<typeof createApp>;
