import { createSystemClock, type Clock } from '@abnehm/clock';

import { createApp } from './app.ts';
import { createAuthModule, type AuthSettings } from './auth/auth-module.ts';
import { createAuthorization, policies } from './authorization/authorization.ts';
import { bundledPasswordBlocklist } from './auth/password-blocklist.ts';
import type { Database } from './database.ts';
import { createJobRegistry } from './jobs/job-registry.ts';
import { createSecurityLog } from './security-log/security-log.ts';

/**
 * Setzt die Module des Backends über einer Datenbank zusammen; gemeinsam genutzt von `main.ts`, den
 * Server-Kommandos und den Integrationstests. Weitere Bereiche melden ihre Jobs hier an, ohne die
 * Registry zu ändern.
 */
export function createBackend({ database, authSettings, clock = createSystemClock({ timeZone: () => 'UTC' }) }: {
  database: Database;
  authSettings: AuthSettings;
  /** Der Server rechnet in UTC; lokale Tage einer Person liest er mit `clock.read(person.timeZone)`. */
  clock?: Clock;
}) {
  const securityLog = createSecurityLog({ database, clock });
  const auth = createAuthModule({ database, clock, securityLog, passwordBlocklist: bundledPasswordBlocklist(), settings: authSettings });
  const authorization = createAuthorization({ database, sessions: auth.sessions, clock, securityLog });
  // Fachbefehle melden hier ihre Policy an, Bereiche ebenso wie der Betrieb.
  authorization.registerCommand('passwort_reset', policies.adminCommand('passwort_reset'));
  const jobs = createJobRegistry({ clock });
  jobs.register(securityLog.cleanupJob);
  return { app: createApp({ database, clock, auth, authorization }), clock, securityLog, auth, authorization, jobs };
}

export type Backend = ReturnType<typeof createBackend>;
