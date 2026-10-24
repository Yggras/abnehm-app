import { eq } from 'drizzle-orm';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { createMiddleware } from 'hono/factory';
import { matchedRoutes } from 'hono/route';

import type { Clock } from '@abnehm/clock';
import { EntityId } from '@abnehm/contracts/base';
import type { ContractError } from '@abnehm/contracts/errors';

import type { AuthenticatedSession, SessionAuthenticator } from '../auth/auth-module.ts';
import type { Database, DbExecutor } from '../database.ts';
import { person } from '../db/schema/index.ts';
import type { SecurityLog } from '../security-log/security-log.ts';
import {
  policyProblem,
  type AdminCommandPolicy,
  type AuthenticatedPolicy,
  type LogoutPolicy,
  type Policy,
  type PublicPolicy,
  type ResourcePolicy,
} from './policy.ts';
import {
  denied,
  resourceEntities,
  type Actor,
  type Decision,
  type PersonActor,
  type ResourceFacts,
  type ResourceTarget,
} from './resources.ts';

export { partnerResponse, PartnerResponseRejected, type PartnerResponseKind } from './partner-response.ts';
export { operationMatrix, policies, policyProblem, type Operation, type Policy, type ProtectionDimension, type ResourcePolicy } from './policy.ts';
export {
  resourceEntities,
  resourceParts,
  type Actor,
  type Decision,
  type PersonActor,
  type ResourceClass,
  type ResourceEntity,
  type SharedActionParticipation,
} from './resources.ts';
export type { ResourceFacts, ResourceTarget };

// Zentrale Autorisierung (Spezifikation 0, Abschnitt 11): deny by default, vor Datenzugriff und
// Fachlogik. Jede Route beginnt mit `guard(policy)`, jeder Fachbefehl meldet seine Policy an.
// Routen ohne Guard lehnt die App-weite Prüfung `enforce` ab, unbekannte Fachbefehle `authorizeCommand`.
// Die Sitzung bestimmt Konto und Person; IDs aus dem Client finden eine Ressource nur.

/** Antwort auf jeden verweigerten Zugriff; sie verrät nicht, ob es die Ressource gibt. */
export const forbiddenError = { code: 'forbidden', retryable: false } as const satisfies ContractError;

/** Findet die Ressource einer Anfrage, etwa über einen Pfadparameter. */
export type Locate = (c: Context) => ResourceTarget | Promise<ResourceTarget>;

export type CommandPolicy = ResourcePolicy | AdminCommandPolicy;

export type IncompletePolicy =
  | Readonly<{ type: 'route'; method: string; path: string; problem: string }>
  | Readonly<{ type: 'befehl'; name: string; problem: string }>;

export type Authorization = {
  /** App-weite Middleware: lehnt jede Route ab, die nicht mit einem Guard beginnt. */
  enforce: MiddlewareHandler;
  /** Wer zu den Request-Headern handelt, oder `null` ohne gültige Sitzung; Routen erhalten das vom Guard. */
  actorOf(headers: Headers): Promise<Actor | null>;
  /** Prüft eine Ressourcenoperation, auf Wunsch in der Transaktion des Aufrufers. */
  authorize(executor: DbExecutor, actor: Actor, policy: Policy, target: ResourceTarget): Promise<Decision>;
  /** Meldet die Policy eines Fachbefehls an; ohne Anmeldung lehnt `authorizeCommand` ihn ab. */
  registerCommand(name: string, policy: CommandPolicy): void;
  /** Prüft einen Fachbefehl mit seiner angemeldeten Policy. */
  authorizeCommand(executor: DbExecutor, actor: Actor, name: string, target: ResourceTarget): Promise<Decision>;
  /** Inventar aller angemeldeten Fachbefehle für das Negativtest-Gerüst. */
  registeredCommands(): ReadonlyMap<string, CommandPolicy>;
  /** Alle Routen der App und alle Fachbefehle mit fehlender oder unvollständiger Policy. */
  findIncompletePolicies(app: Hono): IncompletePolicy[];
  /** Policy einer Route laut ihrem Guard, oder `null`. */
  routePolicy(app: Hono, method: string, path: string): Policy | null;
};

/** Was ein Guard braucht; `enforce` legt es in den Kontext der Anfrage. */
type GuardDependencies = Readonly<Pick<Authorization, 'actorOf' | 'authorize'> & { db: DbExecutor }>;

type GuardEnv = { Variables: { authorization: GuardDependencies } };
type ActorEnv = { Variables: { authorization: GuardDependencies; actor: Actor } };
type LogoutEnv = { Variables: { authorization: GuardDependencies; actor: Actor | null } };
type ResourceEnv = { Variables: { authorization: GuardDependencies; actor: PersonActor; resource: ResourceFacts } };

type Guarded = Readonly<{ policy: Policy; locates: boolean }>;

/** Guards samt Policy; `enforce` und die Vollständigkeitsprüfung erkennen Guards nur hierüber. */
const guards = new WeakMap<object, Guarded>();

function deny(c: Context) {
  return c.json(forbiddenError, 403);
}

/**
 * Erster Handler jeder Route. Ohne gültige Sitzung antwortet er mit `401` ohne Body, bei
 * verweigertem Zugriff mit `403` und `forbidden`; erst danach laufen Validierung und Fachlogik.
 * `c.var.actor` und bei Ressourcen `c.var.resource` stammen ausschließlich aus Sitzung und Postgres.
 */
export function guard(policy: PublicPolicy): MiddlewareHandler<GuardEnv>;
export function guard(policy: AuthenticatedPolicy): MiddlewareHandler<ActorEnv>;
export function guard(policy: LogoutPolicy): MiddlewareHandler<LogoutEnv>;
export function guard(policy: ResourcePolicy, locate: Locate): MiddlewareHandler<ResourceEnv>;
export function guard(policy: AdminCommandPolicy): MiddlewareHandler<GuardEnv>;
export function guard(policy: Policy, locate?: Locate): MiddlewareHandler {
  const middleware = createMiddleware<ResourceEnv>(async (c, next) => {
    const dependencies = c.get('authorization') as GuardDependencies | undefined;
    if (dependencies === undefined || policyProblem(policy) !== null) return deny(c);
    if (policy.kind === 'public') return next();
    if (policy.kind === 'adminCommand') return deny(c);
    const actor = await dependencies.actorOf(c.req.raw.headers);
    if (policy.kind === 'logout') {
      (c as unknown as Context<LogoutEnv>).set('actor', actor);
      return next();
    }
    if (actor === null) return c.body(null, 401);
    if (policy.kind === 'authenticated') {
      (c as unknown as Context<ActorEnv>).set('actor', actor);
      return next();
    }
    const target = locate === undefined ? {} : await locate(c);
    const decision = await dependencies.authorize(dependencies.db, actor, policy, target);
    // Erlaubt ist eine Ressourcenoperation nur einer Person; ohne Person verweigert schon `authorize`.
    if (decision.type === 'verweigert' || actor.personId === null) return deny(c);
    c.set('actor', { ...actor, personId: actor.personId });
    c.set('resource', decision.facts);
    return next();
  });
  guards.set(middleware, { policy, locates: locate !== undefined });
  return middleware as MiddlewareHandler;
}

export type AuthorizationDependencies = Readonly<{
  database: Database;
  sessions: SessionAuthenticator;
  clock: Clock;
  securityLog: SecurityLog;
}>;

export function createAuthorization({ database, sessions, clock, securityLog }: AuthorizationDependencies): Authorization {
  const commands = new Map<string, CommandPolicy>();

  async function actorOf(headers: Headers): Promise<Actor | null> {
    const current: AuthenticatedSession | null = await sessions.authenticate(headers);
    if (current === null) return null;
    const [own] = await database.db.select({ id: person.id }).from(person).where(eq(person.accountId, current.accountId));
    return { ...current, personId: own === undefined ? null : EntityId.parse(own.id) };
  }

  async function decide(executor: DbExecutor, actor: Actor, policy: ResourcePolicy, target: ResourceTarget): Promise<Decision> {
    const { personId } = actor;
    if (personId === null) return denied;
    // Ein Eigentumsfeld der Nutzlast begründet nichts; weicht es ab, ist die Operation manipuliert.
    if (target.claimedOwnerPersonId !== undefined && target.claimedOwnerPersonId !== personId) return denied;
    return resourceEntities[policy.entity].check({ db: executor, actor: { ...actor, personId }, operation: policy.operation, target, clock });
  }

  const authorize: Authorization['authorize'] = async (executor, actor, policy, target) => {
    if (policyProblem(policy) !== null || policy.kind !== 'resourceOperation') return denied;
    const decision = await decide(executor, actor, policy, target);
    // Jeder verweigerte Fotozugriff landet im Sicherheitslog, gleich aus welchem Grund.
    const { photoAccess } = resourceEntities[policy.entity] as { photoAccess?: 'fotoliste' | 'bildabruf' };
    if (decision.type === 'verweigert' && photoAccess !== undefined && policy.operation === 'lesen') {
      await securityLog.record({ type: 'fotozugriff_verweigert', accountId: actor.accountId, operation: photoAccess }, executor);
    }
    return decision;
  };

  const dependencies: GuardDependencies = { actorOf, authorize, db: database.db };

  const enforce = createMiddleware<GuardEnv>(async (c, next) => {
    const matched = matchedRoutes(c);
    const own = matched.findIndex((route) => route.handler === enforce);
    // Jede passende Route muss mit einem Guard beginnen; ohne passende Route folgt die 404.
    const seen = new Set<string>();
    for (const route of matched.slice(own + 1)) {
      const key = `${route.method} ${route.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!guards.has(route.handler)) return deny(c);
    }
    c.set('authorization', dependencies);
    await next();
  });

  return {
    enforce,
    actorOf,
    authorize,
    registerCommand(name, policy) {
      if (commands.has(name)) throw new Error(`Fachbefehl ${name} ist schon angemeldet`);
      commands.set(name, policy);
    },
    async authorizeCommand(executor, actor, name, target) {
      const policy = commands.get(name);
      return policy === undefined ? denied : authorize(executor, actor, policy, target);
    },
    registeredCommands() { return new Map(commands); },
    findIncompletePolicies(app) {
      const problems: IncompletePolicy[] = [];
      for (const { method, path, guarded } of routesOf(app)) {
        const problem = routeProblem(guarded);
        if (problem !== null) problems.push({ type: 'route', method, path, problem });
      }
      for (const [name, policy] of commands) {
        const problem = policyProblem(policy);
        if (problem !== null) problems.push({ type: 'befehl', name, problem });
      }
      return problems;
    },
    routePolicy(app, method, path) {
      return routesOf(app).find((route) => route.method === method && route.path === path)?.guarded?.policy ?? null;
    },
  };

  /** Je Route der erste Handler, also der Guard, sofern er einer ist; ohne `enforce` selbst. */
  function routesOf(app: Hono) {
    const routes = new Map<string, { method: string; path: string; guarded: Guarded | undefined }>();
    for (const { method, path, handler } of app.routes) {
      const key = `${method} ${path}`;
      if (handler === enforce || routes.has(key)) continue;
      routes.set(key, { method, path, guarded: guards.get(handler) });
    }
    return [...routes.values()];
  }
}

function routeProblem(registered: Guarded | undefined): string | null {
  if (registered === undefined) return 'beginnt nicht mit einem Guard';
  const { policy, locates } = registered;
  const problem = policyProblem(policy);
  if (problem !== null) return problem;
  if (policy.kind === 'adminCommand') return 'Admin-Kommandos laufen nie über HTTP';
  if (policy.kind === 'resourceOperation' && resourceEntities[policy.entity].locatedBy === 'id' && !locates) {
    return `findet die Ressource ${policy.entity} nicht`;
  }
  return null;
}
