import { Hono } from 'hono';

import type { Database } from './database.ts';
import { statusRoutes } from './status.ts';

export type AppDependencies = {
  database: Database;
};

/** Die vollständige Hono-App. Alle fachlichen Pfade sind versioniert (`/v1/…`). */
export function createApp({ database }: AppDependencies) {
  return new Hono().route('/v1', statusRoutes({ database }));
}

export type App = ReturnType<typeof createApp>;
