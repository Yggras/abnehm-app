import { createSystemClock, type Clock } from '@abnehm/clock';

import { createApp } from './app.ts';
import { createAuthModule, type AuthSettings } from './auth/auth-module.ts';
import { bundledPasswordBlocklist } from './auth/password-blocklist.ts';
import { createAuthorization, policies } from './authorization/authorization.ts';
import { couplingSyncEntities } from './coupling/coupling-entities.ts';
import { createInvitationLimiter } from './coupling/invitation-limiter.ts';
import { invitationRoutes } from './coupling/invitations.ts';
import { createInviteCodes, type InvitationSettings } from './coupling/invite-codes.ts';
import { dailyGoalCommands, dailyGoalCompletionEntity } from './daily-goals/completions.ts';
import { energyBookingEntity } from './energy/bookings.ts';
import type { Database } from './database.ts';
import { createJobRegistry } from './jobs/job-registry.ts';
import { createSecurityLog } from './security-log/security-log.ts';
import { personEntity } from './sync/person-entity.ts';
import { createSync } from './sync/sync.ts';

/**
 * Setzt die Module des Backends über einer Datenbank zusammen; gemeinsam genutzt von `main.ts`, den
 * Server-Kommandos und den Integrationstests. Weitere Bereiche melden ihre Jobs hier an, ohne die
 * Registry zu ändern.
 */
export function createBackend({
  database,
  authSettings,
  invitationSettings,
  clock = createSystemClock({ timeZone: () => 'UTC' }),
  syncPullPageSize,
}: {
  database: Database;
  authSettings: AuthSettings;
  invitationSettings: InvitationSettings;
  /** Der Server rechnet in UTC; lokale Tage einer Person liest er mit `clock.read(person.timeZone)`. */
  clock?: Clock;
  /** Einträge je Pull-Seite; Tests wählen wenige, um mehrere Seiten zu erzwingen. */
  syncPullPageSize?: number;
}) {
  const securityLog = createSecurityLog({ database, clock });
  const auth = createAuthModule({ database, clock, securityLog, passwordBlocklist: bundledPasswordBlocklist(), settings: authSettings });
  const authorization = createAuthorization({ database, sessions: auth.sessions, clock, securityLog });
  // Fachbefehle melden hier ihre Policy an, Bereiche ebenso wie der Betrieb.
  authorization.registerCommand('passwort_reset', policies.adminCommand('passwort_reset'));
  // Sync-Entitäten und Vor-Pull-Schritte melden die Bereiche hier an, ohne den Sync-Kern zu ändern.
  const sync = createSync({ database, clock, authorization, pullPageSize: syncPullPageSize });
  sync.registerEntity(personEntity);
  for (const entity of couplingSyncEntities) sync.registerEntity(entity);
  sync.registerEntity(dailyGoalCompletionEntity);
  sync.registerEntity(energyBookingEntity);
  for (const command of dailyGoalCommands) sync.registerCommand(command);
  const invitations = invitationRoutes({
    database,
    clock,
    codes: createInviteCodes(invitationSettings.codeSecret),
    limiter: createInvitationLimiter({ clock }),
    securityLog,
    ipAddressOf: auth.ipAddressOf,
  });
  const jobs = createJobRegistry({ clock });
  jobs.register(securityLog.cleanupJob);
  return { app: createApp({ database, clock, auth, authorization, sync, invitations }), clock, securityLog, auth, authorization, sync, jobs };
}

export type Backend = ReturnType<typeof createBackend>;
