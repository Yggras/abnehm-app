import { createSystemClock, type Clock } from '@abnehm/clock';

import { createApp } from './app.ts';
import { createAuthModule, type AuthSettings } from './auth/auth-module.ts';
import { bundledPasswordBlocklist } from './auth/password-blocklist.ts';
import { createAuthorization, policies } from './authorization/authorization.ts';
import { couplingSyncEntities } from './coupling/coupling-entities.ts';
import { createInvitationLimiter } from './coupling/invitation-limiter.ts';
import { invitationRoutes } from './coupling/invitations.ts';
import { createInviteCodes, type InvitationSettings } from './coupling/invite-codes.ts';
import { createSharedActions } from './coupling/shared-actions.ts';
import { createUncoupling } from './coupling/uncoupling.ts';
import { dailyGoalCommands, dailyGoalCompletionEntity } from './daily-goals/completions.ts';
import { energyBookingEntity } from './energy/bookings.ts';
import type { Database } from './database.ts';
import { createJobRegistry } from './jobs/job-registry.ts';
import { createLogout } from './logout/logout.ts';
import { partnerProjectionEntities } from './partner-projections/entities.ts';
import { createPartnerProjections } from './partner-projections/projections.ts';
import { sharingSyncEntities } from './partner-projections/sharing-entities.ts';
import { personTimeZoneCommand } from './person/time-zone.ts';
import { createGoalVersionCommand, goalVersionEntity } from './plan/goal-versions.ts';
import { createWeeklyPlanVersionCommand, weeklyPlanVersionEntity } from './plan/weekly-plan-versions.ts';
import { createSecurityLog } from './security-log/security-log.ts';
import { personEntity } from './sync/person-entity.ts';
import { createSync } from './sync/sync.ts';
import { waterEntryEntity } from './trackers/water-entity.ts';

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
  sync.registerCommand(personTimeZoneCommand);
  for (const entity of couplingSyncEntities) sync.registerEntity(entity);
  // Gemeinsame Aktionen: Spezifikation 4 meldet ihre Arten an `sharedActions` an.
  const sharedActions = createSharedActions();
  for (const command of sharedActions.commands) sync.registerCommand(command);
  // Entkopplungs-Kern: Spezifikation 4 meldet ihre Beobachter an, Spezifikation 5 ruft ihn aus `requestUncoupling` auf.
  const uncoupling = createUncoupling();
  // Ziele und Wochenplan (Spezifikation 1): Fassungen nur über ihre Fachbefehle.
  sync.registerEntity(goalVersionEntity);
  sync.registerEntity(weeklyPlanVersionEntity);
  sync.registerCommand(createGoalVersionCommand);
  sync.registerCommand(createWeeklyPlanVersionCommand);
  sync.registerEntity(dailyGoalCompletionEntity);
  sync.registerEntity(energyBookingEntity);
  for (const command of dailyGoalCommands) sync.registerCommand(command);
  // Wasser, Sport und Gewicht (Spezifikation 3).
  sync.registerEntity(waterEntryEntity);
  // Partner-Projektionen: Die Bereiche melden ihre Projectors an `partnerProjections` an.
  const partnerProjections = createPartnerProjections({ clock });
  for (const entity of [...partnerProjectionEntities, ...sharingSyncEntities({ clock, securityLog })]) sync.registerEntity(entity);
  sync.registerPrePullStep('partner_projections', partnerProjections.prePullStep);
  const invitations = invitationRoutes({
    database,
    clock,
    codes: createInviteCodes(invitationSettings.codeSecret),
    limiter: createInvitationLimiter({ clock }),
    securityLog,
    ipAddressOf: auth.ipAddressOf,
  });
  // Serverseitige Abmelde-Haken melden die Bereiche hier an, etwa Spezifikation 5 die Push-Deaktivierung.
  const logout = createLogout({ database, clock, auth, securityLog });
  const jobs = createJobRegistry({ clock });
  jobs.register(securityLog.cleanupJob);
  return {
    app: createApp({ database, clock, auth, authorization, sync, invitations, logout }),
    clock,
    securityLog,
    auth,
    authorization,
    sync,
    logout,
    partnerProjections,
    sharedActions,
    uncoupling,
    jobs,
  };
}

export type Backend = ReturnType<typeof createBackend>;
