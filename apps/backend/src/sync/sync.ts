import { createHash } from 'node:crypto';

import { and, asc, eq, gt, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { Hono } from 'hono';

import type { Clock } from '@abnehm/clock';
import { EntityId, Instant, ServerVersion, SyncCursor } from '@abnehm/contracts/base';
import type { ContractError, ContractErrorCode } from '@abnehm/contracts/errors';
import {
  currentSyncSchemaVersion,
  PullRequest,
  type CommandType,
  PushRequest,
  PushResult,
  type CanonicalChange,
  type CanonicalState,
  type OutboxOperation,
  type PullResponse,
  type PushResponse,
} from '@abnehm/contracts/sync';

import {
  forbiddenError,
  guard,
  policies,
  policyProblem,
  type Actor,
  type Authorization,
  type PersonActor,
  type ResourcePolicy,
} from '../authorization/authorization.ts';
import { jsonBody } from '../contract-validation.ts';
import type { Database, DbExecutor } from '../database.ts';
import { changeLog, couplingMember, processedOperation } from '../db/schema/index.ts';
import { errorCodeForLog } from '../log.ts';
import { currentServerVersion, lockSyncClock, nextServerVersion, recordChange } from './change-log.ts';
import { canonicalJson } from './canonical-json.ts';
import type { ServerSyncEntity, StoredEntity } from './registry.ts';
import { CommandRejection, type ServerCommand } from './commands.ts';

// Push/Pull-Sync (Spezifikation 0, Abschnitt 10; #99). Push verarbeitet die geordnete Liste in einer
// Transaktion und hält jedes terminale Ergebnis unter der Operations-ID fest. Pull liefert alle seit dem
// Cursor sichtbaren Änderungen bis zu einer festen Obergrenze in Seiten. Bereiche schließen ihre
// Entitäten, Fachbefehle und Vor-Pull-Schritte über die jeweilige Registry an.

/**
 * Serverseitiger Schritt vor jeder Pull-Antwort, etwa Partner-Projektionen oder Fristabläufe. Er läuft in
 * einer eigenen Transaktion, die committet, bevor der Pull Obergrenze und Lesesnapshot festlegt; seine
 * Änderungen kommen so im selben Pull an. Er muss idempotent sein.
 */
export type PrePullStep = (tx: DbExecutor, context: Readonly<{ personId: EntityId; now: Instant }>) => Promise<void>;

export type Sync = {
  /** Meldet eine Entität an; ihr Typ muss eindeutig und ihre Operationen in der Matrix erlaubt sein. */
  registerEntity(entity: ServerSyncEntity): void;
  registerCommand(command: ServerCommand): void;
  registerPrePullStep(name: string, step: PrePullStep): void;
  routes: ReturnType<typeof syncRoutes>;
};

export type SyncOptions = Readonly<{
  database: Database;
  clock: Clock;
  authorization: Authorization;
  /** Höchstzahl an Einträgen des Änderungsprotokolls je Pull-Seite. */
  pullPageSize?: number;
}>;

type RegisteredEntity = ServerSyncEntity & {
  policies: { lesen: ResourcePolicy; upsert: ResourcePolicy | null; loeschen: ResourcePolicy | null };
};

const schemaUpdateRequired = { code: 'schema_update_required', retryable: false } as const satisfies ContractError;
const invalidPayload = { code: 'invalid_payload', retryable: false } as const satisfies ContractError;
const fullResyncRequired = { code: 'full_resync_required', retryable: false } as const satisfies ContractError;

/** Eine dauerhafte Ablehnung innerhalb einer Operation; rollt nur deren Savepoint zurück. */
class Rejection extends Error {
  readonly code: ContractErrorCode;
  constructor(code: ContractErrorCode) {
    super(code);
    this.code = code;
  }
}

export function createSync({ database, clock, authorization, pullPageSize = 500 }: SyncOptions): Sync {
  const entities = new Map<string, RegisteredEntity>();
  const commands = new Map<CommandType, ServerCommand>();
  const prePullSteps = new Map<string, PrePullStep>();

  function policyFor(entity: ServerSyncEntity, operation: 'lesen' | 'upsert' | 'loeschen'): ResourcePolicy {
    const policy = policies.resource(entity.resource, operation);
    const problem = policyProblem(policy);
    if (problem !== null) throw new Error(`Sync-Entität ${entity.entityType}: ${problem}`);
    return policy;
  }

  function registerEntity(entity: ServerSyncEntity) {
    if (entities.has(entity.entityType)) throw new Error(`Sync-Entität ${entity.entityType} ist schon angemeldet`);
    entities.set(entity.entityType, {
      ...entity,
      policies: {
        lesen: policyFor(entity, 'lesen'),
        upsert: entity.upsert === null ? null : policyFor(entity, 'upsert'),
        loeschen: entity.deletable ? policyFor(entity, 'loeschen') : null,
      },
    });
  }

  function now(): Date {
    return new Date(clock.read().instant);
  }

  // Push ----------------------------------------------------------------------------------------

  async function push(actor: PersonActor, request: PushRequest): Promise<PushResponse> {
    const at = now();
    return database.db.transaction(async (tx) => {
      await lockSyncClock(tx);
      const results: PushResult[] = [];
      for (const operation of request.operations) results.push(await processOperation(tx, actor, operation, at));
      return { results };
    });
  }

  async function processOperation(tx: DbExecutor, actor: PersonActor, operation: OutboxOperation, at: Date): Promise<PushResult> {
    const command = 'businessKey' in operation;
    const registeredCommand = command ? commands.get(operation.type) : undefined;
    const hash = command && registeredCommand !== undefined && registeredCommand.payload.safeParse(operation.payload).success
      ? businessHash(operation, registeredCommand.canonicalRequest(operation)) : payloadHash(operation);
    const entityType = command ? null : operation.entityType;
    const entityId = command ? null : operation.entityId;
    const [stored] = await tx.select().from(processedOperation).where(eq(processedOperation.operationId, operation.operationId));
    if (stored !== undefined) {
      if (stored.personId !== actor.personId) return forbidden(operation);
      const identical =
        stored.operationType === operation.type &&
        stored.entityType === entityType &&
        stored.entityId === entityId &&
        (stored.businessKey === (command ? operation.businessKey : null) ||
          (command && stored.businessKey === null && stored.outcome === 'already_applied')) &&
        stored.payloadHash === hash;
      if (!identical) return rejected(operation, 'operation_conflict', await visibleState(tx, actor, operation));
      if (command && (registeredCommand === undefined ||
        (await authorization.authorizeCommand(tx, actor, operation.type, registeredCommand.target(operation))).type === 'verweigert')) return forbidden(operation);
      const result = PushResult.parse(stored.result);
      // Ein Retry darf weder widerrufene abgeleitete Datensätze noch deren IDs preisgeben.
      if (command && !(await canDeliverCommandResult(tx, actor, result))) return forbidden(operation);
      if (!command && result.canonical.type === 'record' && (await visibleState(tx, actor, operation)).type === 'absent') return forbidden(operation);
      return result.type === 'applied' ? { ...result, type: 'already_applied' } : result;
    }
    if (command) {
      if (registeredCommand === undefined ||
        (await authorization.authorizeCommand(tx, actor, operation.type, registeredCommand.target(operation))).type === 'verweigert') return forbidden(operation);
      const [existing] = await tx.select().from(processedOperation).where(and(
        eq(processedOperation.personId, actor.personId), eq(processedOperation.operationType, operation.type),
        eq(processedOperation.businessKey, operation.businessKey), ne(processedOperation.outcome, 'permanently_rejected'),
      ));
      if (existing !== undefined) {
        if (existing.payloadHash !== hash) return rejected(operation, 'operation_conflict', absent(operation));
        const result = PushResult.parse(existing.result);
        if (!(await canDeliverCommandResult(tx, actor, result))) return forbidden(operation);
        if (result.type === 'permanently_rejected') throw new Error('Erfolgreicher Fachschlüssel mit abgelehntem Ergebnis');
        const duplicate = { ...result, operationId: operation.operationId, type: 'already_applied',
          canonical: absent(operation), idMappings: commands.get(operation.type)!.duplicate(operation, result) } as const;
        await tx.insert(processedOperation).values({ operationId: operation.operationId, personId: actor.personId, operationType: operation.type,
          entityType: null, entityId: null, businessKey: null, payloadHash: hash, outcome: duplicate.type, result: duplicate, createdAt: at });
        return duplicate;
      }
    }
    const result = command ? await decideCommand(tx, actor, operation, at) : await decide(tx, actor, operation, at);
    await tx.insert(processedOperation).values({
      operationId: operation.operationId,
      personId: actor.personId,
      operationType: operation.type,
      entityType,
      entityId,
      businessKey: command ? operation.businessKey : null,
      payloadHash: hash,
      outcome: result.type,
      result,
      createdAt: at,
    });
    return result;
  }

  async function decideCommand(tx: DbExecutor, actor: PersonActor, operation: Extract<OutboxOperation, { businessKey: string }>, at: Date): Promise<PushResult> {
    const command = commands.get(operation.type);
    if (command === undefined) return forbidden(operation);
    const decision = await authorization.authorizeCommand(tx, actor, operation.type, command.target(operation));
    if (decision.type === 'verweigert') return forbidden(operation);
    const parsed = command.payload.safeParse(operation.payload);
    if (!parsed.success) return rejected(operation, 'invalid_payload', absent(operation));
    try {
      return await tx.transaction(async (savepoint) => {
        const result = await command.execute(savepoint, { actor, payload: parsed.data, businessKey: operation.businessKey, at });
        const applied = { type: 'applied', operationId: operation.operationId, canonical: absent(operation),
          changes: result.changes, idMappings: result.idMappings } as const;
        if (!(await canDeliverCommandResult(savepoint, actor, applied))) throw new CommandRejection('invalid_payload');
        // Der Handler schreibt Fachzeilen, Änderungslog und abgeleitete Zeilen in diesem Savepoint.
        return applied;
      });
    } catch (error) {
      const code = error instanceof Rejection || error instanceof CommandRejection ? error.code : integrityViolation(error);
      if (code === null) throw error;
      return rejected(operation, code, absent(operation));
    }
  }

  async function decide(tx: DbExecutor, actor: PersonActor, operation: Extract<OutboxOperation, { entityId: EntityId }>, at: Date): Promise<PushResult> {
    const entity = entities.get(operation.entityType);
    const policy = entity === undefined ? null : operation.type === 'upsert_entity' ? entity.policies.upsert : entity.policies.loeschen;
    if (entity === undefined || policy === null) return forbidden(operation);
    const payload = operation.type === 'upsert_entity' ? operation.payload : null;
    // Ein Eigentumsfeld gehört nie in die Nutzlast; nennt es eine fremde Person, ist die Operation manipuliert.
    const claimed = payload !== null && 'personId' in payload ? { claimedOwnerPersonId: payload.personId } : {};
    const decision = await authorization.authorize(tx, actor, policy, { id: operation.entityId, ...claimed });
    if (decision.type === 'verweigert') return forbidden(operation);

    // Ab hier ist die Entität für die Person autorisiert; Ablehnungen dürfen ihren kanonischen Zustand nennen.
    try {
      return await tx.transaction(async (savepoint) => {
        const current = (await entity.read(savepoint, [operation.entityId])).get(operation.entityId);
        if (current?.deletedAt != null) throw new Rejection('conflict');
        const serverVersion = await nextServerVersion(savepoint);
        if (operation.type === 'upsert_entity') {
          const parsed = entity.upsert!.safeParse(operation.payload);
          if (!parsed.success || ('id' in parsed.data && parsed.data.id !== operation.entityId)) throw new Rejection('invalid_payload');
          const write = { entityId: operation.entityId, payload: parsed.data, ownerPersonId: actor.personId, serverVersion, at };
          await entity.write(savepoint, { ...write, exists: current !== undefined });
        } else {
          await entity.remove(savepoint, { entityId: operation.entityId, ownerPersonId: actor.personId, serverVersion, at });
        }
        await recordChange(savepoint, {
          position: serverVersion,
          entityType: entity.entityType,
          entityId: operation.entityId,
          operation: operation.type === 'upsert_entity' ? 'upsert' : 'delete',
          ownerPersonId: actor.personId,
          createdAt: at,
        });
        const canonical = await stateOf(savepoint, entity, operation.entityId);
        if (canonical.type === 'absent') throw new Error(`Sync-Entität ${entity.entityType} nach dem Schreiben nicht lesbar`);
        return { type: 'applied', operationId: operation.operationId, canonical } as const;
      });
    } catch (error) {
      const code = error instanceof Rejection ? error.code : integrityViolation(error);
      if (code === null) throw error;
      return rejected(operation, code, await stateOf(tx, entity, operation.entityId));
    }
  }

  /** Kanonischer Zustand der Entität, sofern die Person sie lesen darf; sonst `absent`. */
  async function canDeliverCommandResult(tx: DbExecutor, actor: PersonActor, result: PushResult): Promise<boolean> {
    if (result.type === 'permanently_rejected') return true;
    const refs = [ ...(result.changes ?? []).map((change) => ({ entityType: change.entityType, entityId: change.entityId })),
      ...(result.idMappings ?? []).map((mapping) => ({ entityType: mapping.entityType, entityId: mapping.to })) ];
    for (const ref of refs) {
      const entity = entities.get(ref.entityType);
      if (entity === undefined ||
        (await authorization.authorize(tx, actor, entity.policies.lesen, { id: ref.entityId })).type === 'verweigert') return false;
    }
    return true;
  }

  async function visibleState(tx: DbExecutor, actor: PersonActor, operation: OutboxOperation): Promise<CanonicalState> {
    if ('businessKey' in operation) return absent(operation);
    const entity = entities.get(operation.entityType);
    if (entity === undefined) return absent(operation);
    const decision = await authorization.authorize(tx, actor, entity.policies.lesen, { id: operation.entityId });
    return decision.type === 'erlaubt' ? stateOf(tx, entity, operation.entityId) : absent(operation);
  }

  // Pull ----------------------------------------------------------------------------------------

  async function pull(actor: PersonActor, request: PullRequest): Promise<PullResponse | ContractError> {
    for (const step of prePullSteps.values()) {
      await database.db.transaction((tx) => step(tx, { personId: actor.personId, now: Instant.parse(clock.read().instant) }));
    }
    // Wiederholbares Lesen: ein Snapshot für Obergrenze, Änderungsprotokoll und Datensätze dieser Seite.
    return database.db.transaction(
      async (tx) => {
        const latest = await currentServerVersion(tx);
        const page = request.pageToken === null ? firstPage(request.cursor, latest) : continuedPage(actor, request.pageToken, latest);
        if ('code' in page) return page;
        const entries = await tx
          .select()
          .from(changeLog)
          .where(and(gt(changeLog.position, page.after), lte(changeLog.position, page.upper), visibleTo(tx, actor.personId)))
          .orderBy(asc(changeLog.position))
          // Ein Eintrag mehr zeigt, ob eine weitere Seite folgt.
          .limit(pullPageSize + 1);
        const pageEntries = entries.slice(0, pullPageSize);
        const changes = await deliverable(tx, actor, pageEntries);
        const last = pageEntries.at(-1);
        const next: PullResponse['next'] =
          entries.length <= pullPageSize || last === undefined
            ? { type: 'complete', cursor: SyncCursor.parse(page.upper.toString()) }
            : { type: 'page', pageToken: pageToken(actor.personId, page.upper, last.position) };
        return { changes, next };
      },
      { isolationLevel: 'repeatable read' },
    );
  }

  /**
   * Je Eintrag der aktuelle Zustand der Entität, aber nur, wenn ihre Serverversion genau diese Position
   * ist. Ältere Einträge derselben Entität überspringt der Pull, neuere liegen oberhalb der Obergrenze und
   * kommen im nächsten Pull. Datensätze gehen zusätzlich durch die Leseregel der Autorisierung;
   * Löschmarkierungen sind inhaltsfrei.
   */
  async function deliverable(tx: DbExecutor, actor: PersonActor, entries: (typeof changeLog.$inferSelect)[]): Promise<CanonicalChange[]> {
    const byType = new Map<string, EntityId[]>();
    for (const entry of entries) byType.set(entry.entityType, [...(byType.get(entry.entityType) ?? []), EntityId.parse(entry.entityId)]);
    const stored = new Map<string, ReadonlyMap<string, StoredEntity>>();
    for (const [entityType, ids] of byType) stored.set(entityType, await registered(entityType).read(tx, ids));

    const changes: CanonicalChange[] = [];
    for (const entry of entries) {
      const entity = registered(entry.entityType);
      const current = stored.get(entry.entityType)?.get(entry.entityId);
      if (current === undefined || current.serverVersion !== entry.position) continue;
      const change = canonicalOf(entity, EntityId.parse(entry.entityId), current);
      if (change.type === 'record') {
        const decision = await authorization.authorize(tx, actor, entity.policies.lesen, { id: entry.entityId });
        if (decision.type === 'verweigert') continue;
      }
      changes.push(change);
    }
    return changes;
  }

  function registered(entityType: string): RegisteredEntity {
    const entity = entities.get(entityType);
    // Eine Änderung ohne angemeldete Entität ist ein Integrationsfehler, kein stilles Auslassen.
    if (entity === undefined) throw new Error(`Sync-Entität ${entityType} ist nicht angemeldet`);
    return entity;
  }

  return {
    registerEntity,
    registerCommand(command) {
      if (commands.has(command.type)) throw new Error(`Fachbefehl ${command.type} ist schon angemeldet`);
      if (policyProblem(command.policy) !== null || command.policy.operation !== 'befehl') throw new Error(`Fachbefehl ${command.type} benötigt eine gültige Befehlsregel`);
      authorization.registerCommand(command.type, command.policy);
      commands.set(command.type, command);
    },
    registerPrePullStep(name, step) {
      if (prePullSteps.has(name)) throw new Error(`Vor-Pull-Schritt ${name} ist schon angemeldet`);
      prePullSteps.set(name, step);
    },
    routes: syncRoutes({ push, pull }),
  };
}

function syncRoutes({
  push,
  pull,
}: {
  push(actor: PersonActor, request: PushRequest): Promise<PushResponse>;
  pull(actor: PersonActor, request: PullRequest): Promise<PullResponse | ContractError>;
}) {
  /**
   * Gemeinsamer Rahmen beider Endpunkte: eine Person (vor dem Bootstrap generisch verweigert), die
   * aktuelle Vertragsversion in Hülle und Operationen und `503` ohne Body bei einem vorübergehenden
   * Fehler. Unbekannte Fehler gelten bewusst als vorübergehend: Die Outbox bleibt erhalten, statt dass
   * ein Fehler des Servers Änderungen als dauerhaft abgelehnt verwirft.
   */
  async function handle<T>(
    actor: Actor,
    versions: readonly number[],
    run: (actor: PersonActor) => Promise<T>,
  ): Promise<{ type: 'ok'; value: T } | { type: 'error'; error: ContractError; status: 400 | 403 } | { type: 'unavailable' }> {
    if (actor.personId === null) return { type: 'error', error: forbiddenError, status: 403 };
    if (versions.some((version) => version !== currentSyncSchemaVersion)) return { type: 'error', error: schemaUpdateRequired, status: 400 };
    try {
      return { type: 'ok', value: await run({ ...actor, personId: actor.personId }) };
    } catch (error) {
      // Die ganze Transaktion ist zurückgerollt; keine Operation ist bestätigt.
      console.error('[sync] abgebrochen:', errorCodeForLog(error));
      return { type: 'unavailable' };
    }
  }

  return new Hono()
    .post('/sync/push', guard(policies.authenticated()), jsonBody(PushRequest), async (c) => {
      const request = c.req.valid('json');
      const versions = [request.schemaVersion, ...request.operations.map((operation) => operation.schemaVersion)];
      const outcome = await handle(c.var.actor, versions, (actor) => push(actor, request));
      if (outcome.type === 'unavailable') return c.body(null, 503);
      if (outcome.type === 'error') return c.json(outcome.error, outcome.status);
      return c.json(outcome.value, 200);
    })
    .post('/sync/pull', guard(policies.authenticated()), jsonBody(PullRequest), async (c) => {
      const request = c.req.valid('json');
      const outcome = await handle(c.var.actor, [request.schemaVersion], (actor) => pull(actor, request));
      if (outcome.type === 'unavailable') return c.body(null, 503);
      if (outcome.type === 'error') return c.json(outcome.error, outcome.status);
      const response = outcome.value;
      if ('code' in response) return c.json(response, response.code === 'full_resync_required' ? 409 : 400);
      return c.json(response, 200);
    });
}

// Hilfen ------------------------------------------------------------------------------------------

type Page = { upper: bigint; after: bigint };

function firstPage(cursor: SyncCursor | null, latest: bigint): Page | ContractError {
  const after = cursor === null ? 0n : BigInt(cursor);
  // Ein Cursor jenseits der Clock stammt von einem anderen Datenstand; nur ein vollständiger Pull hilft.
  if (after > latest) return fullResyncRequired;
  return { upper: latest, after };
}

/** Seitentoken `v1.<Person>.<Obergrenze>.<letzte Position>`; es nennt die Person und begründet nichts. */
function pageToken(personId: EntityId, upper: bigint, after: bigint) {
  return `v1.${personId}.${upper}.${after}`;
}

function continuedPage(actor: PersonActor, token: string, latest: bigint): Page | ContractError {
  const match = /^v1\.([0-9a-f-]{36})\.(0|[1-9][0-9]{0,18})\.(0|[1-9][0-9]{0,18})$/.exec(token);
  if (match === null || match[1] !== actor.personId) return invalidPayload;
  const upper = BigInt(match[2]!);
  const after = BigInt(match[3]!);
  if (upper > latest || after > upper) return invalidPayload;
  return { upper, after };
}

/**
 * Sichtbar sind adressierte Einträge nur dem Empfänger, alle übrigen dem Eigentümer und den aktiven
 * Mitgliedern ihrer Kopplung. Die Grenze kommt aus der Sitzung, nie aus Cursor, Token oder Installation.
 */
function visibleTo(tx: DbExecutor, personId: EntityId) {
  const activeCouplings = tx
    .select({ couplingId: couplingMember.couplingId })
    .from(couplingMember)
    .where(and(eq(couplingMember.personId, personId), eq(couplingMember.couplingStatus, 'aktiv')));
  return or(
    eq(changeLog.recipientPersonId, personId),
    and(isNull(changeLog.recipientPersonId), or(eq(changeLog.ownerPersonId, personId), inArray(changeLog.couplingId, activeCouplings))),
  );
}

function canonicalOf(entity: ServerSyncEntity, entityId: EntityId, stored: StoredEntity): CanonicalChange {
  const serverVersion = ServerVersion.parse(stored.serverVersion.toString());
  if (stored.deletedAt !== null) {
    return { type: 'tombstone', entityType: entity.entityType, entityId, serverVersion, deletedAt: Instant.parse(stored.deletedAt.toISOString()) };
  }
  return { type: 'record', entityType: entity.entityType, entityId, serverVersion, data: stored.data };
}

async function stateOf(tx: DbExecutor, entity: ServerSyncEntity, entityId: EntityId): Promise<CanonicalState> {
  const stored = (await entity.read(tx, [entityId])).get(entityId);
  return stored === undefined ? { type: 'absent', entityType: entity.entityType, entityId } : canonicalOf(entity, entityId, stored);
}

function absent(operation: OutboxOperation): CanonicalState {
  return { type: 'absent', entityType: 'businessKey' in operation ? 'command_result' : operation.entityType,
    entityId: 'businessKey' in operation ? operation.operationId : operation.entityId };
}

function forbidden(operation: OutboxOperation): PushResult {
  return { type: 'permanently_rejected', operationId: operation.operationId, error: forbiddenError, canonical: absent(operation) };
}

function rejected(operation: OutboxOperation, code: ContractErrorCode, canonical: CanonicalState): PushResult {
  return { type: 'permanently_rejected', operationId: operation.operationId, error: { code, retryable: false }, canonical };
}

/**
 * Verletzt die Nutzlast eine Datenbankregel, ist die Operation dauerhaft ungültig: Klasse 23 (Integrität)
 * und 22 (Datenfehler) laut https://www.postgresql.org/docs/current/errcodes-appendix.html. Alles andere
 * ist ein vorübergehender Infrastrukturfehler.
 */
function integrityViolation(error: unknown): ContractErrorCode | null {
  const code = sqlState(error) ?? sqlState((error as { cause?: unknown } | null)?.cause);
  if (code === undefined) return null;
  if (code === '23505') return 'conflict';
  return code.startsWith('23') || code.startsWith('22') ? 'invalid_payload' : null;
}

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

/**
 * SHA-256 der kanonischen Operation (sortierte Schlüssel): Nur ein vollständig identischer Retry erhält
 * das gespeicherte Ergebnis, schon eine abweichende Version oder Erstellungszeit ist ein Konflikt.
 */
export function payloadHash(operation: OutboxOperation): string {
  return createHash('sha256').update(canonicalJson(operation)).digest('hex');
}

function businessHash(operation: Extract<OutboxOperation, { businessKey: string }>, canonicalRequest: Record<string, unknown>): string {
  // Weder Operations-ID noch Gerätezeit gehört zum fachlichen Request; Version und Inhalt schon.
  return createHash('sha256').update(canonicalJson({ type: operation.type, businessKey: operation.businessKey,
    payload: canonicalRequest, schemaVersion: operation.schemaVersion, knownServerVersion: operation.knownServerVersion })).digest('hex');
}
