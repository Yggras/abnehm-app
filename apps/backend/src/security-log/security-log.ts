import { randomUUID } from 'node:crypto';

import { lt } from 'drizzle-orm';

import type { Clock } from '@abnehm/clock';

import type { Database, DbExecutor } from '../database.ts';
import { securityLog } from '../db/schema/index.ts';
import type { Job } from '../jobs/job-registry.ts';
import { SecurityEvent } from './events.ts';

export { SecurityEvent, type SecurityEventType } from './events.ts';

/** Aufbewahrung der Einträge laut #22. */
export const SECURITY_LOG_RETENTION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Sicherheitslog (Spezifikation 0, Abschnitt 11). Einzige Stelle, die `security_log` schreibt oder
 * löscht. `record` nimmt nur Ereignisse der geschlossenen Union `SecurityEvent` an und wirft bei allem
 * anderen, auch bei zusätzlichen Feldern.
 */
export type SecurityLog = {
  /** Schreibt ein Ereignis, auf Wunsch in der Transaktion des Aufrufers (etwa der Kopplungsannahme). */
  record(event: SecurityEvent, executor?: DbExecutor): Promise<void>;
  /** Benannter Cleanup-Lauf: löscht Einträge, die älter als 90 Tage sind. Idempotent. */
  readonly cleanupJob: Job;
};

/** Wie oft der Cleanup-Lauf startet (Designwert); ein Eintrag bleibt also höchstens 91 Tage. */
const CLEANUP_INTERVAL_MS = DAY_MS;

export function createSecurityLog({ database, clock }: { database: Database; clock: Clock }): SecurityLog {
  return {
    async record(event, executor = database.db) {
      const { type, ...details } = SecurityEvent.parse(event);
      const accountId = 'accountId' in details ? details.accountId : details.targetAccountId;
      await executor.insert(securityLog).values({
        id: randomUUID(),
        occurredAt: new Date(clock.read().instant),
        eventType: type,
        accountId,
        personId: null,
        details,
      });
    },
    cleanupJob: {
      name: 'sicherheitslog_aufraeumen',
      intervalMs: CLEANUP_INTERVAL_MS,
      async run() {
        const cutoff = Date.parse(clock.read().instant) - SECURITY_LOG_RETENTION_DAYS * DAY_MS;
        await database.db.delete(securityLog).where(lt(securityLog.occurredAt, new Date(cutoff)));
      },
    },
  };
}
