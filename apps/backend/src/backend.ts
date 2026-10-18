import { createSystemClock, type Clock } from '@abnehm/clock';

import { createApp } from './app.ts';
import { createAuthModule, type AuthSettings } from './auth/auth-module.ts';
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
  const jobs = createJobRegistry({ clock });
  jobs.register(securityLog.cleanupJob);
  return { app: createApp({ database, clock, auth }), clock, securityLog, auth, jobs };
}

export type Backend = ReturnType<typeof createBackend>;
