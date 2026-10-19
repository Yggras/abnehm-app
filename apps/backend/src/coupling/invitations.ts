import { randomUUID } from 'node:crypto';

import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';
import { Instant } from '@abnehm/contracts/base';
import {
  AcceptInvitationRequest,
  AcceptInvitationResult,
  CheckInvitationRequest,
  CreateInvitationRequest,
  type CreateInvitationResult,
  type CheckInvitationResult,
  type InvitationError,
  type InvitationErrorCode,
} from '@abnehm/contracts/coupling';

import { forbiddenError, guard, policies, type Actor, type PersonActor } from '../authorization/authorization.ts';
import { jsonBody } from '../contract-validation.ts';
import { sqlStateOf, type Database, type DbExecutor } from '../database.ts';
import { couplingMember, invitation, person } from '../db/schema/index.ts';
import type { OnlineFlow } from '../online/flows.ts';
import { onlineRequestBinding, storedOnlineResult, storeOnlineResult, type OnlineRequestBinding } from '../online/online-requests.ts';
import type { SecurityLog } from '../security-log/security-log.ts';
import { lockSyncClock } from '../sync/change-log.ts';
import { couple, couplingOfPair } from './couple.ts';
import type { InviteCodes } from './invite-codes.ts';
import type { InvitationLimiter } from './invitation-limiter.ts';

// Einladung, Code prüfen und Annahme (Spezifikation 0, Abschnitt 9; #103). Alle drei sind reine
// Online-Abläufe einer Person; Konto und Person stammen ausschließlich aus der Sitzung.

/** Gültigkeit eines Codes (Designwert, nicht wissenschaftlich belegt). */
export const INVITATION_VALIDITY_MS = 24 * 60 * 60 * 1000;

/** Versuche bei Unique-Verletzung, Deadlock oder Serialisierungsfehler, bevor der Fehler durchgeht. */
const MAX_TRANSACTION_ATTEMPTS = 5;

export type InvitationsDependencies = Readonly<{
  database: Database;
  clock: Clock;
  codes: InviteCodes;
  /** Schlüssel des Anfrage-Hashes in `online_request`; das Einladungs-Secret. */
  requestHashKey: string;
  limiter: InvitationLimiter;
  securityLog: SecurityLog;
  /** Quelladresse der Anfrage, wie die Begrenzung der Anmeldung sie bestimmt. */
  ipAddressOf(request: Request): string | null;
}>;

type Outcome<T> = Readonly<{ type: 'ok'; value: T }> | Readonly<{ type: 'error'; error: InvitationError | typeof forbiddenError }>;

const fail = (code: InvitationErrorCode | 'operation_conflict'): Outcome<never> => ({
  type: 'error',
  error: { code, retryable: code === 'invite_rate_limited' },
});
const forbidden: Outcome<never> = { type: 'error', error: forbiddenError };

/** Fehlversuche im Sinne der Begrenzung: Der Code führt zu keiner Einladung, die angenommen werden kann. */
const failedAttempts: readonly InvitationErrorCode[] = ['invite_invalid', 'invite_expired', 'invite_consumed', 'invite_self'];

export function invitationRoutes({ database, clock, codes, requestHashKey, limiter, securityLog, ipAddressOf }: InvitationsDependencies) {
  const now = () => new Date(clock.read().instant);

  /** Ein identischer Retry erhält das gespeicherte Ergebnis, eine fremde `requestId` nur `forbidden`. */
  async function stored<T>(executor: DbExecutor, binding: OnlineRequestBinding, read: (result: Record<string, unknown>) => T) {
    const found = await storedOnlineResult(executor, binding);
    if (found.type === 'foreign') return forbidden;
    if (found.type === 'conflict') return fail('operation_conflict');
    if (found.type === 'stored') return { type: 'ok', value: read(found.result) } as const;
    return null;
  }

  /**
   * Führt eine Schreibtransaktion aus und wiederholt sie bei Unique-Verletzung, Deadlock oder
   * Serialisierungsfehler: Der neue Versuch prüft alles erneut und kommt so zu einem stabilen
   * fachlichen Ausgang, etwa `already_coupled` nach einer gleichzeitigen Annahme.
   */
  async function retrying<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await database.db.transaction(work);
      } catch (error) {
        if (attempt >= MAX_TRANSACTION_ATTEMPTS || !isContention(error)) throw error;
      }
    }
  }

  function binding(actor: Actor, flow: OnlineFlow, request: { requestId: string }): OnlineRequestBinding {
    return onlineRequestBinding({ hashKey: requestHashKey, accountId: actor.accountId, flow, request });
  }

  // Code erzeugen ---------------------------------------------------------------------------------

  const fromStoredInvitation = (result: Record<string, unknown>): CreateInvitationResult => ({
    code: codes.codeFor(String(result.invitationId)),
    expiresAt: Instant.parse(result.expiresAt),
  });

  async function create(actor: PersonActor, request: CreateInvitationRequest): Promise<Outcome<CreateInvitationResult>> {
    const bound = binding(actor, 'einladung_erzeugen', request);
    return retrying(async (tx) => {
      const retry = await stored(tx, bound, fromStoredInvitation);
      if (retry !== null) return retry;
      if (await anyActivelyCoupled(tx, [actor.personId])) return fail('already_coupled');
      const at = now();
      const expiresAt = new Date(at.getTime() + INVITATION_VALIDITY_MS);
      // Eine neue zufällige ID ergibt einen neuen Code; kollidiert er mit einem offenen, gilt die nächste.
      for (;;) {
        const id = randomUUID();
        const codeHmac = codes.hmacOf(codes.codeFor(id));
        // Ein abgelaufener, nie verbrauchter Code sperrt seinen Wert nicht länger.
        await tx
          .delete(invitation)
          .where(and(eq(invitation.codeHmac, codeHmac), isNull(invitation.consumedAt), lte(invitation.expiresAt, at)));
        const inserted = await tx
          .insert(invitation)
          .values({ id, inviterPersonId: actor.personId, codeHmac, expiresAt, createdAt: at })
          .onConflictDoNothing()
          .returning({ id: invitation.id });
        if (inserted.length === 0) continue;
        const result = { invitationId: id, expiresAt: expiresAt.toISOString() };
        await storeOnlineResult(tx, bound, result, at);
        return { type: 'ok', value: fromStoredInvitation(result) } as const;
      }
    });
  }

  // Code prüfen und annehmen ----------------------------------------------------------------------

  /**
   * Die Einladung zum Code, sofern sie sich annehmen lässt. Unter mehreren Einladungen mit demselben
   * HMAC zählt die offene, sonst die zuletzt verbrauchte. `lock` sperrt die Zeile bis zum Ende der
   * Transaktion (Einladung vor Personen).
   */
  async function usableInvitation(executor: DbExecutor, actor: PersonActor, codeHmac: string, lock: boolean) {
    const query = executor
      .select()
      .from(invitation)
      .where(eq(invitation.codeHmac, codeHmac))
      .orderBy(sql`${invitation.consumedAt} is null desc`, desc(invitation.createdAt))
      .limit(1);
    const [found] = lock ? await query.for('update') : await query;
    if (found === undefined) return fail('invite_invalid');
    if (found.consumedAt !== null) return fail('invite_consumed');
    if (found.expiresAt.getTime() <= now().getTime()) return fail('invite_expired');
    if (found.inviterPersonId === actor.personId) return fail('invite_self');
    if (await anyActivelyCoupled(executor, [found.inviterPersonId])) return fail('already_coupled');
    return { type: 'ok', value: found } as const;
  }

  /** Begrenzung um einen Ablauf: gesperrt ohne Datenbankzugriff, danach je Ausgang gezählt. */
  async function limited<T>(actor: PersonActor, code: string, ipAddress: string | null, run: (codeHmac: string) => Promise<Outcome<T>>) {
    const attempt = { accountId: actor.accountId, codeHmac: codes.hmacOf(code), ipAddress };
    if (limiter.isBlocked(attempt)) return fail('invite_rate_limited');
    const outcome = await run(attempt.codeHmac);
    const failed = outcome.type === 'error' && failedAttempts.includes(outcome.error.code as InvitationErrorCode);
    limiter.record(attempt, { failed });
    return outcome;
  }

  async function check(actor: PersonActor, request: CheckInvitationRequest, ipAddress: string | null): Promise<Outcome<CheckInvitationResult>> {
    // Die eigene Kopplung hängt nicht am Code und verrät deshalb nichts über ihn.
    if (await anyActivelyCoupled(database.db, [actor.personId])) return fail('already_coupled');
    return limited(actor, request.code, ipAddress, async (codeHmac) => {
      const found = await usableInvitation(database.db, actor, codeHmac, false);
      if (found.type === 'error') return found;
      const inviter = found.value.inviterPersonId;
      const [named] = await database.db.select({ displayName: person.displayName }).from(person).where(eq(person.id, inviter));
      const previous = await couplingOfPair(database.db, [inviter, actor.personId]);
      return { type: 'ok', value: { inviterDisplayName: named!.displayName, reactivates: previous !== null } };
    });
  }

  async function accept(actor: PersonActor, request: AcceptInvitationRequest, ipAddress: string | null): Promise<Outcome<AcceptInvitationResult>> {
    const bound = binding(actor, 'einladung_annehmen', request);
    // Ein Retry nach verlorener Antwort ist kein neuer Versuch und unterliegt keiner Begrenzung.
    const retry = await stored(database.db, bound, AcceptInvitationResult.parse);
    if (retry !== null) return retry;
    if (await anyActivelyCoupled(database.db, [actor.personId])) return fail('already_coupled');
    return limited(actor, request.code, ipAddress, (codeHmac) =>
      retrying(async (tx) => {
        // Dieselbe Sperrfolge wie ein Push: zuerst die Sync-Clock, dann Einladung, dann beide Personen in
        // stabiler ID-Reihenfolge. So wartet die Annahme, statt mit einem Push zu verklemmen.
        await lockSyncClock(tx);
        const again = await stored(tx, bound, AcceptInvitationResult.parse);
        if (again !== null) return again;
        const found = await usableInvitation(tx, actor, codeHmac, true);
        if (found.type === 'error') return found;
        const pair = [found.value.inviterPersonId, actor.personId] as const;
        await tx
          .select({ id: person.id })
          .from(person)
          .where(inArray(person.id, [...pair]))
          .orderBy(asc(person.id))
          .for('update');
        if (await anyActivelyCoupled(tx, pair)) return fail('already_coupled');
        const at = now();
        await tx.update(invitation).set({ consumedAt: at, consumedByPersonId: actor.personId }).where(eq(invitation.id, found.value.id));
        const coupled = await couple(tx, pair, at);
        await securityLog.record({ type: 'kopplung', accountId: actor.accountId, ...coupled }, tx);
        const result = AcceptInvitationResult.parse(coupled);
        await storeOnlineResult(tx, bound, result, at);
        return { type: 'ok', value: result } as const;
      }),
    );
  }

  // Routen ----------------------------------------------------------------------------------------

  /** Vor dem Bootstrap gibt es keine Person; die Abläufe verweigern dann generisch. */
  const personOf = (actor: Actor): PersonActor | null => (actor.personId === null ? null : { ...actor, personId: actor.personId });

  return new Hono()
    .post('/invitations', guard(policies.authenticated()), jsonBody(CreateInvitationRequest), async (c) => {
      const actor = personOf(c.var.actor);
      const outcome = actor === null ? forbidden : await create(actor, c.req.valid('json'));
      return outcome.type === 'ok' ? c.json(outcome.value, 200) : c.json(outcome.error, statusOf(outcome.error));
    })
    .post('/invitations/check', guard(policies.authenticated()), jsonBody(CheckInvitationRequest), async (c) => {
      const actor = personOf(c.var.actor);
      const outcome = actor === null ? forbidden : await check(actor, c.req.valid('json'), ipAddressOf(c.req.raw));
      return outcome.type === 'ok' ? c.json(outcome.value, 200) : c.json(outcome.error, statusOf(outcome.error));
    })
    .post('/invitations/accept', guard(policies.authenticated()), jsonBody(AcceptInvitationRequest), async (c) => {
      const actor = personOf(c.var.actor);
      const outcome = actor === null ? forbidden : await accept(actor, c.req.valid('json'), ipAddressOf(c.req.raw));
      return outcome.type === 'ok' ? c.json(outcome.value, 200) : c.json(outcome.error, statusOf(outcome.error));
    });
}

/** `403` generisch, `429` begrenzt, `409` bei wiederverwendeter `requestId`, sonst `422`. */
function statusOf({ code }: InvitationError | typeof forbiddenError): 403 | 409 | 422 | 429 {
  if (code === 'forbidden') return 403;
  if (code === 'invite_rate_limited') return 429;
  return code === 'operation_conflict' ? 409 : 422;
}

/** Ob eine der Personen aktives Mitglied einer Kopplung ist. */
async function anyActivelyCoupled(executor: DbExecutor, personIds: readonly string[]) {
  const [found] = await executor
    .select({ id: couplingMember.id })
    .from(couplingMember)
    .where(and(inArray(couplingMember.personId, [...personIds]), eq(couplingMember.couplingStatus, 'aktiv')))
    .limit(1);
  return found !== undefined;
}

/**
 * Konkurrenz zweier Transaktionen statt eines fachlichen Fehlers: Unique-Verletzung (23505), Deadlock
 * (40P01) oder Serialisierungsfehler (40001) laut https://www.postgresql.org/docs/current/errcodes-appendix.html.
 */
function isContention(error: unknown): boolean {
  const code = sqlStateOf(error);
  return code === '23505' || code === '40P01' || code === '40001';
}
