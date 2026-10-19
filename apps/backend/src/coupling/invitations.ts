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
import { transactionWithRetry, type Database, type DbExecutor } from '../database.ts';
import { couplingMember, invitation, person } from '../db/schema/index.ts';
import type { OnlineFlow } from '../online/flows.ts';
import { storedOnlineResult, storeOnlineResult, type OnlineRequestBinding } from '../online/online-requests.ts';
import type { SecurityLog } from '../security-log/security-log.ts';
import { lockSyncClock } from '../sync/change-log.ts';
import { couple, couplingOfPair } from './couple.ts';
import type { InviteCodes } from './invite-codes.ts';
import type { InvitationLimiter } from './invitation-limiter.ts';

// Einladung, Code prüfen und Annahme (Spezifikation 0, Abschnitt 9; #103). Alle drei sind reine
// Online-Abläufe einer Person; Konto und Person stammen ausschließlich aus der Sitzung.

/** Gültigkeit eines Codes (Designwert, nicht wissenschaftlich belegt). */
export const INVITATION_VALIDITY_MS = 24 * 60 * 60 * 1000;

export type InvitationsDependencies = Readonly<{
  database: Database;
  clock: Clock;
  codes: InviteCodes;
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
const failedAttempts: ReadonlySet<string> = new Set<InvitationErrorCode>(['invite_invalid', 'invite_expired', 'invite_consumed', 'invite_self']);

export function invitationRoutes({ database, clock, codes, limiter, securityLog, ipAddressOf }: InvitationsDependencies) {
  const now = () => new Date(clock.read().instant);

  /** Ein identischer Retry erhält das gespeicherte Ergebnis, eine fremde `requestId` nur `forbidden`. */
  async function stored<T>(executor: DbExecutor, binding: OnlineRequestBinding, read: (result: Record<string, unknown>) => T) {
    const found = await storedOnlineResult(executor, binding);
    if (found.type === 'foreign') return forbidden;
    if (found.type === 'conflict') return fail('operation_conflict');
    if (found.type === 'stored') return { type: 'ok', value: read(found.result) } as const;
    return null;
  }

  const retrying = <T>(work: (tx: DbExecutor) => Promise<T>) => transactionWithRetry(database, work);

  const binding = (actor: Actor, flow: OnlineFlow, request: { requestId: string }) =>
    codes.bindRequest(request, { accountId: actor.accountId, flow });

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
    // Ist die einladende Person inzwischen gekoppelt, taugt der Code nicht mehr. Ein eigener Fehler verriete,
    // dass es ihn gibt; er zählt deshalb wie ein ungültiger Code.
    if (await anyActivelyCoupled(executor, [found.inviterPersonId])) return fail('invite_invalid');
    return { type: 'ok', value: found } as const;
  }

  /**
   * Begrenzung um einen Ablauf: gesperrt ohne Datenbankzugriff. Der Versuch zählt vorab als Fehlversuch
   * und wird nur bei einem anderen Ausgang freigegeben; ein abgebrochener Ablauf bleibt gezählt.
   */
  async function limited<T>(actor: PersonActor, code: string, ipAddress: string | null, run: (codeHmac: string) => Promise<Outcome<T>>) {
    const attempt = { accountId: actor.accountId, codeHmac: codes.hmacOf(code), ipAddress };
    const ticket = limiter.begin(attempt);
    if (ticket === null) return fail('invite_rate_limited');
    const outcome = await run(attempt.codeHmac);
    if (outcome.type === 'ok' || !failedAttempts.has(outcome.error.code)) limiter.succeeded(ticket);
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
        // Die eigene Kopplung zuerst: Bei überkreuzten Annahmen ist die zweite Person inzwischen gekoppelt.
        if (await anyActivelyCoupled(tx, [actor.personId])) return fail('already_coupled');
        const found = await usableInvitation(tx, actor, codeHmac, true);
        if (found.type === 'error') return found;
        const pair = [found.value.inviterPersonId, actor.personId] as const;
        await tx
          .select({ id: person.id })
          .from(person)
          .where(inArray(person.id, [...pair]))
          .orderBy(asc(person.id))
          .for('update');
        // Unter der Sperre erneut: Eine gleichzeitige Annahme kann eine der beiden inzwischen gekoppelt haben.
        if (await anyActivelyCoupled(tx, [actor.personId])) return fail('already_coupled');
        if (await anyActivelyCoupled(tx, [found.value.inviterPersonId])) return fail('invite_invalid');
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
  const asPerson = async <T>(actor: Actor, run: (person: PersonActor) => Promise<Outcome<T>>): Promise<Outcome<T>> =>
    actor.personId === null ? forbidden : run({ ...actor, personId: actor.personId });

  // Je Route ein eigenes `c.json`, damit Hono RPC die Antworttypen ableitet.
  return new Hono()
    .post('/invitations', guard(policies.authenticated()), jsonBody(CreateInvitationRequest), async (c) => {
      const outcome = await asPerson(c.var.actor, (actor) => create(actor, c.req.valid('json')));
      return outcome.type === 'ok' ? c.json(outcome.value, 200) : c.json(outcome.error, statusOf(outcome.error));
    })
    .post('/invitations/check', guard(policies.authenticated()), jsonBody(CheckInvitationRequest), async (c) => {
      const outcome = await asPerson(c.var.actor, (actor) => check(actor, c.req.valid('json'), ipAddressOf(c.req.raw)));
      return outcome.type === 'ok' ? c.json(outcome.value, 200) : c.json(outcome.error, statusOf(outcome.error));
    })
    .post('/invitations/accept', guard(policies.authenticated()), jsonBody(AcceptInvitationRequest), async (c) => {
      const outcome = await asPerson(c.var.actor, (actor) => accept(actor, c.req.valid('json'), ipAddressOf(c.req.raw)));
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
