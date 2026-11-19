import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';

import type { AuthModule } from './auth/auth-module.ts';
import type { Authorization } from './authorization/authorization.ts';
import type { invitationRoutes } from './coupling/invitations.ts';
import type { Database } from './database.ts';
import type { Logout } from './logout/logout.ts';
import type { PushInstallations } from './notifications/push-installations.ts';
import type { MealPhotos } from './nutrition/meal-photos.ts';
import type { PhotoDrafts } from './nutrition/photo-drafts.ts';
import { bootstrapRoutes } from './person/bootstrap.ts';
import { statusRoutes } from './status.ts';
import type { Sync } from './sync/sync.ts';

export type AppDependencies = {
  database: Database;
  clock: Clock;
  auth: AuthModule;
  authorization: Authorization;
  sync: Sync;
  invitations: ReturnType<typeof invitationRoutes>;
  logout: Logout;
  photoDrafts: PhotoDrafts;
  mealPhotos: Pick<MealPhotos, 'routes'>;
  pushInstallations: PushInstallations;
};

/**
 * Die vollständige Hono-App. Alle Pfade sind versioniert (`/v1/…`), Better Auth unter `/v1/auth`.
 * Jede Route beginnt mit einem Guard der zentralen Autorisierung; `enforce` lehnt alle anderen ab.
 */
export function createApp({ database, clock, auth, authorization, sync, invitations, logout, photoDrafts, mealPhotos, pushInstallations }: AppDependencies) {
  return new Hono()
    .use('*', authorization.enforce)
    .route('/v1', statusRoutes({ database }))
    .route('/v1', auth.routes)
    .route('/v1', logout.routes)
    .route('/v1', bootstrapRoutes({ database, clock }))
    .route('/v1', sync.routes)
    .route('/v1', invitations)
    .route('/v1', photoDrafts.routes)
    .route('/v1', mealPhotos.routes)
    .route('/v1', pushInstallations.routes);
}

export type App = ReturnType<typeof createApp>;
