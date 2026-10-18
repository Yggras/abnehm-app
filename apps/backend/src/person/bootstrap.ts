import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';
import { BootstrapPersonRequest, BootstrapPersonResult } from '@abnehm/contracts/auth';

import type { SessionAuthenticator } from '../auth/auth-module.ts';
import { requireSession } from '../auth/require-session.ts';
import { jsonBody } from '../contract-validation.ts';
import type { Database, DbExecutor } from '../database.ts';
import { person } from '../db/schema/index.ts';
import { nextServerVersion, recordChange } from '../sync/change-log.ts';

/**
 * `POST /v1/person/bootstrap` (Spezifikation 0, Abschnitt 9): erzeugt nach der Kontoanlage genau eine
 * Person mit servergesetztem `account_id`, Anzeigename und `onboarding_status = begonnen`. Idempotent:
 * Gibt es die Person des Kontos schon, kommt sie unverändert zurück. Das Konto stammt ausschließlich
 * aus der Sitzung; Konto- oder Personen-IDs im Body lehnt der Vertrag ab.
 */
export function bootstrapRoutes({ database, clock, sessions }: { database: Database; clock: Clock; sessions: SessionAuthenticator }) {
  return new Hono().post('/person/bootstrap', requireSession(sessions), jsonBody(BootstrapPersonRequest), async (c) => {
    const { accountId } = c.var.session;
    const request = c.req.valid('json');
    const result = await database.db.transaction(async (tx) => {
      const existing = await personOf(tx, accountId);
      if (existing !== null) return existing;
      const now = new Date(clock.read().instant);
      const serverVersion = await nextServerVersion(tx);
      const id = randomUUID();
      // Bei gleichzeitigen Aufrufen gewinnt der erste; der zweite liest dessen Person.
      const inserted = await tx
        .insert(person)
        .values({
          id,
          accountId,
          displayName: request.displayName,
          onboardingStatus: 'begonnen',
          timeZone: request.timeZone,
          createdAt: now,
          updatedAt: now,
          serverVersion,
        })
        .onConflictDoNothing({ target: person.accountId })
        .returning({ id: person.id });
      if (inserted.length === 1) {
        await recordChange(tx, { position: serverVersion, entityType: 'person', entityId: id, operation: 'upsert', ownerPersonId: id, createdAt: now });
      }
      const created = await personOf(tx, accountId);
      if (created === null) throw new Error('Person nach dem Bootstrap nicht gefunden');
      return created;
    });
    return c.json(result, 200);
  });
}

async function personOf(tx: DbExecutor, accountId: string): Promise<BootstrapPersonResult | null> {
  const [row] = await tx
    .select({
      personId: person.id,
      displayName: person.displayName,
      onboardingStatus: person.onboardingStatus,
      timeZone: person.timeZone,
      serverVersion: person.serverVersion,
    })
    .from(person)
    .where(eq(person.accountId, accountId));
  if (row === undefined) return null;
  return BootstrapPersonResult.parse({ ...row, serverVersion: row.serverVersion.toString() });
}
