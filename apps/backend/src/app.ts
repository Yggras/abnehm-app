import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';

import type { AuthModule } from './auth/auth-module.ts';
import type { Database } from './database.ts';
import { bootstrapRoutes } from './person/bootstrap.ts';
import { statusRoutes } from './status.ts';

export type AppDependencies = {
  database: Database;
  clock: Clock;
  auth: AuthModule;
};

/** Die vollständige Hono-App. Alle Pfade sind versioniert (`/v1/…`), Better Auth unter `/v1/auth`. */
export function createApp({ database, clock, auth }: AppDependencies) {
  return new Hono()
    .route('/v1', statusRoutes({ database }))
    .route('/v1', auth.routes)
    .route('/v1', bootstrapRoutes({ database, clock, sessions: auth.sessions }));
}

export type App = ReturnType<typeof createApp>;
