import { randomUUID } from 'node:crypto';

import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import {
  guard,
  policies,
  resourceEntities,
  resourceParts,
  type Actor,
  type Policy,
} from '../src/authorization/authorization.ts';
import * as schema from '../src/db/schema/index.ts';
import { createTestBackend } from './support/app.ts';
import { call } from './support/auth-client.ts';
import { httpOutcome, resourceProbe } from './support/authorization.ts';
import { coupledWorld, insert, type CoupledWorld } from './support/coupled-world.ts';

// Das Autorisierungsmodul an seinen Schnittstellen (#98): Ressourcenkatalog, Vollständigkeit der
// Policies an Routen und Fachbefehlen, Fachbefehle und reine Serverdaten.

const anyResource = () => ({ id: randomUUID() });

async function actorOf(world: CoupledWorld, person: CoupledWorld['anna']): Promise<Actor> {
  const actor = await world.backend.authorization.actorOf(new Headers({ authorization: `Bearer ${person.device.token}` }));
  if (actor === null) throw new Error('Keine Sitzung');
  return actor;
}

describe('Ressourcenkatalog', () => {
  it('ordnet jede Tabelle des Schemas genau einer Ressourcenklasse zu', () => {
    const schemaTables = Object.values(schema)
      .filter((value) => is(value, PgTable))
      .map((table) => getTableName(table))
      .sort();
    const classified = [
      ...Object.values(resourceEntities).flatMap((rule) => (rule.table === null ? [] : [getTableName(rule.table)])),
      ...Object.keys(resourceParts),
    ];

    expect([...new Set(classified)].sort()).toEqual(schemaTables);
  });

  it('kennt alle Ressourcenklassen der Operationsmatrix', () => {
    const classes = new Set(Object.values(resourceEntities).map((rule) => rule.resourceClass));

    expect([...classes].sort()).toEqual(
      [
        'anfeuern',
        'eigene_eintraege',
        'fachbuchungen',
        'fotofreigabe',
        'inselfortschritt',
        'kopplungsinhalte',
        'partner_tageszielstatus',
        'partner_zusammenfassung',
        'partnerfoto',
        'partnerfreigabe',
        'personenstand',
        'push_installation',
        'serverdaten',
        'widerrufshinweis',
        'zielversionen',
      ].sort(),
    );
  });
});

describe('Vollständigkeit der Policies', () => {
  it('findet an der echten App keine Route und keinen Fachbefehl mit unvollständiger Policy', async () => {
    const backend = await createTestBackend();

    expect(backend.authorization.findIncompletePolicies(backend.app)).toEqual([]);
  });

  it('findet Routen ohne Guard, mit fremder, unvollständiger oder für HTTP unzulässiger Policy', async () => {
    const backend = await createTestBackend();
    const handcrafted = { kind: 'public', dimensions: [] } as unknown as Policy;
    const app = new Hono()
      .use('*', backend.authorization.enforce)
      .get('/v1/ohne-guard', (c) => c.text('ok'))
      .get('/v1/fremde-policy', guard(handcrafted as ReturnType<typeof policies.public>), (c) => c.text('ok'))
      .post('/v1/projektion-schreiben', guard(policies.resource('partner_summary', 'upsert'), () => anyResource()), (c) => c.text('ok'))
      .post('/v1/serverdaten', guard(policies.resource('security_log', 'lesen'), () => anyResource()), (c) => c.text('ok'))
      .post('/v1/admin', guard(policies.adminCommand('passwort_reset')), (c) => c.text('ok'))
      .post('/v1/ohne-fundstelle', guard(policies.resource('water_entry', 'lesen'), undefined as never), (c) => c.text('ok'))
      .get('/v1/in-ordnung', guard(policies.public()), (c) => c.text('ok'));

    const problems = backend.authorization
      .findIncompletePolicies(app)
      .map((problem) => (problem.type === 'route' ? `${problem.method} ${problem.path}` : problem.name));

    expect(problems).toEqual([
      'GET /v1/ohne-guard',
      'GET /v1/fremde-policy',
      'POST /v1/projektion-schreiben',
      'POST /v1/serverdaten',
      'POST /v1/admin',
      'POST /v1/ohne-fundstelle',
    ]);
  });

  it('findet Fachbefehle mit unvollständiger Policy', async () => {
    const backend = await createTestBackend();
    backend.authorization.registerCommand('createGoalVersion', policies.resource('goal_version', 'befehl'));
    backend.authorization.registerCommand('updateDailyGoal', policies.resource('daily_goal', 'upsert'));
    backend.authorization.registerCommand('handgebaut', { kind: 'adminCommand', command: 'passwort_reset', dimensions: [] });

    const problems = backend.authorization.findIncompletePolicies(new Hono());

    expect(problems.map((problem) => problem.type === 'befehl' && problem.name)).toEqual(['updateDailyGoal', 'handgebaut']);
  });

  it('lehnt Anfragen an Routen mit unvollständiger Policy zur Laufzeit ab', async () => {
    const world = await coupledWorld();
    const summary = await insert.partnerSummary(world, world.anna, world.philipp);

    for (const policy of [policies.resource('partner_summary', 'upsert'), policies.resource('security_log', 'lesen')]) {
      expect(httpOutcome(await resourceProbe(world.backend, policy)(world.philipp.device, { id: summary })), policy.entity).toBe('verweigert');
    }
    const app = new Hono()
      .use('*', world.backend.authorization.enforce)
      .post('/v1/admin', guard(policies.adminCommand('passwort_reset')), (c) => c.text('ok'));
    expect(httpOutcome(await call({ app }, 'POST', '/v1/admin', world.anna.device))).toBe('verweigert');
  });
});

describe('Fachbefehle', () => {
  it('lehnt einen Fachbefehl ohne angemeldete Policy ab', async () => {
    const world = await coupledWorld();
    const actor = await actorOf(world, world.anna);

    const decision = await world.backend.authorization.authorizeCommand(world.backend.database.db, actor, 'createGoalVersion', anyResource());

    expect(decision).toEqual({ type: 'verweigert' });
  });

  it('prüft einen angemeldeten Fachbefehl mit seiner Regel, auch in der Transaktion des Aufrufers', async () => {
    const world = await coupledWorld();
    const { authorization, database } = world.backend;
    authorization.registerCommand('sendEncouragement', policies.resource('encouragement_send', 'befehl'));
    const anna = await actorOf(world, world.anna);

    const decision = await database.db.transaction((tx) => authorization.authorizeCommand(tx, anna, 'sendEncouragement', anyResource()));

    expect(decision).toEqual({
      type: 'erlaubt',
      facts: { exists: false, ownerPersonId: world.anna.personId, couplingId: world.couplingId, partnerPersonId: world.philipp.personId },
    });
  });

  it('lässt kein Admin-Kommando über einen Client laufen; der Admin-Reset ist als solches angemeldet', async () => {
    const world = await coupledWorld();
    const anna = await actorOf(world, world.anna);

    const decision = await world.backend.authorization.authorizeCommand(world.backend.database.db, anna, 'passwort_reset', {});

    expect(decision).toEqual({ type: 'verweigert' });
    expect(() => world.backend.authorization.registerCommand('passwort_reset', policies.adminCommand('passwort_reset'))).toThrow();
  });

  it('verweigert ohne Person und bei abweichendem Eigentumsfeld', async () => {
    const world = await coupledWorld();
    const { authorization, database } = world.backend;
    // Das Backend meldet `updatePersonTimeZone` mit dieser Regel an; ein zweites Mal wäre ein Fehler.
    expect(authorization.registeredCommands().get('updatePersonTimeZone')).toEqual(policies.resource('person', 'befehl'));
    const anna = await actorOf(world, world.anna);

    const own = await authorization.authorizeCommand(database.db, anna, 'updatePersonTimeZone', { id: world.anna.personId });
    const withoutPerson = await authorization.authorizeCommand(database.db, { ...anna, personId: null }, 'updatePersonTimeZone', {
      id: world.anna.personId,
    });
    const claimed = await authorization.authorizeCommand(database.db, anna, 'updatePersonTimeZone', {
      id: world.anna.personId,
      claimedOwnerPersonId: world.philipp.personId,
    });

    expect([own.type, withoutPerson.type, claimed.type]).toEqual(['erlaubt', 'verweigert', 'verweigert']);
  });
});

describe('Serverdaten', () => {
  it('gibt keiner Person Zugriff auf Kataloge, Sync-Log, verarbeitete Operationen oder Sicherheitslog', async () => {
    const world = await coupledWorld();
    const anna = await actorOf(world, world.anna);

    for (const [entity, rule] of Object.entries(resourceEntities)) {
      if (rule.resourceClass !== 'serverdaten') continue;
      for (const operation of ['lesen', 'upsert', 'loeschen', 'befehl'] as const) {
        const policy = policies.resource(entity as keyof typeof resourceEntities, operation);
        const decision = await world.backend.authorization.authorize(world.backend.database.db, anna, policy, anyResource());
        expect(decision.type, `${operation} ${entity}`).toBe('verweigert');
      }
    }
  });
});
