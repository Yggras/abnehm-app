import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { EntityId, Instant } from '@abnehm/contracts/base';
import { eventRewardId, islandEventId } from '@abnehm/contracts/island-records';
import { gameCatalog } from '@abnehm/game-rules/content';

import { blueprintUnlock, islandEvent, islandEventState, islandObject } from '../src/db/schema/index.ts';
import { generateIslandEvents } from '../src/island/island-events.ts';
import { authorizationCases } from './support/authorization.ts';
import { buildAs, buildOp, builtWorld, earnEnergy, fieldKeys, type BuildWorld } from './support/building.ts';
import { claimEventRewardScenario, claimOp, markEventsSeenScenario, seenOp, visitOf, visitsOf, visitedWorld, type Visit } from './support/island-events.ts';
import { pullAll, push } from './support/sync.ts';

// Nachweis für #202 am Server: Ereignisgenerator als Vor-Pull-Schritt, Besucher mit Wunsch, `markEventsSeen`
// und `claimEventReward` mit echter Hono-App, isoliertem Postgres und Testuhr (Spezifikation 4, Testnaht 2).
// Anna hat Natur, Philipp Bauen; die Insel liegt in Europe/Berlin.

const dayMs = 24 * 60 * 60 * 1000;
const nextDay = (world: BuildWorld) => world.clock.advanceBy(dayMs);
const byPerson = (visits: readonly Visit[], personId: string) => visits.filter((visit) => visit.responsiblePersonId === personId);
const visitorBlueprints = (role: 'bauen' | 'natur') => gameCatalog.blueprints.filter((b) => b.origin === 'besucher' && b.role === role).map((b) => b.key);
const rejection = (result: unknown) => result as { type: string; error?: { code: string }; canonical?: { type: string; entityType?: string; data?: Record<string, unknown> } };

describe('Ereignisgenerator', { timeout: 60_000 }, () => {
  it('Tracer: Nach dem Pull ist ein Besucher mit Wunsch da, für jede Person einer, mit Stand nur für die zuständige Person', async () => {
    const world = await builtWorld();

    const { changes } = await pullAll(world.backend, world.actor);

    const visits = await visitsOf(world);
    expect(visits.map((visit) => visit.occasionKey)).toEqual(['tag:2026-10-14:1', 'tag:2026-10-14:2']);
    expect(new Set(visits.map((visit) => visit.responsiblePersonId))).toEqual(new Set([world.philipp.personId, world.anna.personId]));
    const philipps = await visitOf(world, world.philipp);
    expect(philipps).toMatchObject({ eventId: islandEventId(world.islandId, philipps.occasionKey), status: 'offen' });
    // Wunsch: ein Start-Bauplan der eigenen Rolle bis 3 Energie; Belohnung: ein Besucher-Bauplan von Bauen.
    expect(['holzweg', 'sitzbank', 'laterne']).toContain(philipps.details.wish.blueprintKey);
    expect(philipps.details.reward).toMatchObject({ type: 'bauplan' });
    expect(visitorBlueprints('bauen')).toContain(philipps.details.reward.key);
    // Philipp bekommt beide Ereignisse der Insel, aber nur seinen eigenen Ereignisstand.
    const pulled = changes.filter((change) => change.entityType === 'island_event' || change.entityType === 'island_event_state');
    // Dazu kommt das Ereignis „Momo ist geschlüpft“.
    const pulledEvents = pulled.filter((change) => change.entityType === 'island_event').map((change) => change.entityId);
    expect(pulledEvents).toHaveLength(3);
    expect(pulledEvents).toEqual(expect.arrayContaining(visits.map((visit) => visit.eventId)));
    expect(pulled.filter((change) => change.entityType === 'island_event_state').map((change) => change.entityId)).toEqual([philipps.stateId]);
  });

  it('ist idempotent: weitere Pulls beider Personen am selben Inseltag erzeugen nichts Neues', async () => {
    const world = await builtWorld();
    await pullAll(world.backend, world.actor);
    const first = await visitsOf(world);

    await pullAll(world.backend, world.anna.device);
    await Promise.all([pullAll(world.backend, world.actor), pullAll(world.backend, world.anna.device)]);

    expect(await visitsOf(world)).toEqual(first);
  });

  it('wiederholt die Erzeugung deterministisch: derselbe Inseltag ergibt dieselben Besucher', async () => {
    const world = await builtWorld();
    const db = world.backend.database.db;
    const now = Instant.parse(world.clock.read().instant);
    // Erster Lauf in einer Transaktion, die zurückrollt; der zweite über den echten Pull.
    const rolledBack = await db
      .transaction(async (tx) => {
        await generateIslandEvents(tx, { personId: EntityId.parse(world.philipp.personId), now });
        const rows = await tx.select().from(islandEvent).where(eq(islandEvent.type, 'besuch'));
        throw Object.assign(new Error('zurückrollen'), { rows });
      })
      .catch((error: { rows: (typeof islandEvent.$inferSelect)[] }) => error.rows);
    await pullAll(world.backend, world.actor);
    const kept = await db.select().from(islandEvent).where(eq(islandEvent.type, 'besuch'));

    const comparable = (rows: (typeof islandEvent.$inferSelect)[]) =>
      rows.map(({ id, occasionKey, templateKey, responsiblePersonId, reward }) => ({ id, occasionKey, templateKey, responsiblePersonId, reward })).sort((a, b) => a.id.localeCompare(b.id));
    expect(rolledBack).toHaveLength(2);
    expect(comparable(kept)).toEqual(comparable(rolledBack));
  });

  it('über mehrere simulierte Tage: je Person ein Besucher am Tag, bis 4 offen sind; ohne Pull entsteht nichts nachträglich', async () => {
    const world = await builtWorld();
    const counts: [number, number][] = [];
    for (let day = 0; day < 6; day += 1) {
      await pullAll(world.backend, world.actor);
      const visits = await visitsOf(world);
      counts.push([byPerson(visits, world.philipp.personId).length, byPerson(visits, world.anna.personId).length]);
      nextDay(world);
    }
    // Tagesdeckel 2, je Person einer je Tag; ab 4 offenen kommt für die Person nichts mehr.
    expect(counts).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [4, 4], [4, 4]]);

    // Eine Pause von einer Woche ohne Pull holt keine Tage nach.
    world.clock.advanceBy(7 * dayMs);
    await pullAll(world.backend, world.actor);
    expect(await visitsOf(world)).toHaveLength(8);
  });

  it('ein abgeholter Wunsch macht Platz: Unter 4 offenen kommt am nächsten Tag wieder ein Besucher', async () => {
    const world = await builtWorld();
    await earnEnergy(world.backend, world.philipp, ['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10']);
    for (let day = 0; day < 4; day += 1) {
      await pullAll(world.backend, world.actor);
      nextDay(world);
    }
    const [first] = byPerson(await visitsOf(world), world.philipp.personId);
    await buildAs(world, world.actor, { fieldId: world.fieldId(fieldKeys.philippsEcke), blueprintKey: first!.details.wish.blueprintKey });
    await push(world.backend, world.actor, [claimOp(first!.stateId)]);

    await pullAll(world.backend, world.actor);

    const philipps = byPerson(await visitsOf(world), world.philipp.personId);
    expect(philipps).toHaveLength(5);
    expect(philipps.filter((visit) => visit.status !== 'abgeschlossen')).toHaveLength(4);
  });

  it('rechnet den Inseltag in der Zeitzone der Insel: kurz nach Mitternacht in Berlin ist ein neuer Tag', async () => {
    const world = await builtWorld();
    world.clock.set(Instant.parse('2026-10-14T21:30:00.000Z')); // 23:30 in Berlin
    await pullAll(world.backend, world.actor);
    world.clock.set(Instant.parse('2026-10-14T22:30:00.000Z')); // 00:30 am 15.10. in Berlin, in UTC noch der 14.
    await pullAll(world.backend, world.actor);

    expect((await visitsOf(world)).map((visit) => visit.occasionKey)).toEqual(['tag:2026-10-14:1', 'tag:2026-10-14:2', 'tag:2026-10-15:1', 'tag:2026-10-15:2']);
  });

  it('erzeugt für eine nicht aktive Insel nichts', async () => {
    const world = await builtWorld();
    await world.backend.database.db.execute(sql`update island set state = 'archiviert' where id = ${world.islandId}`);

    await pullAll(world.backend, world.actor);

    expect(await visitsOf(world)).toEqual([]);
  });
});

describe('Besucher mit Wunsch: Bedingung und Belohnung', { timeout: 60_000 }, () => {
  it('Tracer: Philipp baut den gewünschten Bauplan, der Wunsch wird im selben Befehl erfüllbar, und er holt einen Besucher-Bauplan ab', async () => {
    const world = await visitedWorld();
    const { visit } = world;

    const [built] = await push(world.backend, world.actor, [
      buildOp({ fieldId: world.fieldId(fieldKeys.philippsEcke), blueprintKey: visit.details.wish.blueprintKey }),
    ]);
    expect(built).toMatchObject({ type: 'applied' });
    const events = built?.type === 'applied' ? built.changes!.filter((change) => change.entityType === 'island_event') : [];
    expect(events).toMatchObject([{ entityId: visit.eventId, data: { status: 'erfuellbar' } }]);

    const operation = claimOp(visit.stateId);
    const [claimed] = await push(world.backend, world.actor, [operation]);

    expect(claimed).toMatchObject({ type: 'applied' });
    if (claimed?.type !== 'applied') return;
    expect(claimed.changes!.map((change) => change.entityType)).toEqual(['island_event', 'island_event_state', 'blueprint_unlock']);
    const rewardId = eventRewardId(visit.stateId);
    const [unlock] = await world.backend.database.db.select().from(blueprintUnlock).where(eq(blueprintUnlock.id, rewardId));
    expect(unlock).toMatchObject({ catalogKey: visit.details.reward.key, reason: 'besucher', islandId: world.islandId });
    expect((await visitOf(world, world.anna)).status).toBe('offen');
    const [event] = await world.backend.database.db.select().from(islandEvent).where(eq(islandEvent.id, visit.eventId));
    expect(event).toMatchObject({ status: 'abgeschlossen', reward: visit.details });
    const [state] = await world.backend.database.db.select().from(islandEventState).where(eq(islandEventState.id, visit.stateId));
    expect(state?.claimedAt).not.toBeNull();
    expect(state?.seenAt).not.toBeNull();

    // Retry nach verlorener Antwort und ein zweites Gerät mit demselben fachlichen Schlüssel: dieselbe Antwort.
    const [retry] = await push(world.backend, world.actor, [{ ...operation }]);
    const [second] = await push(world.backend, world.actor, [claimOp(visit.stateId)]);
    expect(retry).toMatchObject({ type: 'already_applied', changes: claimed.changes });
    expect(second).toMatchObject({ type: 'already_applied', changes: claimed.changes });
    expect(await world.backend.database.db.select().from(blueprintUnlock).where(eq(blueprintUnlock.reason, 'besucher'))).toHaveLength(1);
  });

  it('lehnt das Abholen ab, solange der Wunsch nicht erfüllt ist, und nennt den kanonischen Ereignisstand', async () => {
    const world = await visitedWorld();

    const [result] = await push(world.backend, world.actor, [claimOp(world.visit.stateId)]);

    expect(rejection(result)).toMatchObject({
      type: 'permanently_rejected',
      error: { code: 'conflict' },
      canonical: { type: 'record', entityType: 'island_event_state', data: { claimedAt: null } },
    });
    expect(await world.backend.database.db.select().from(blueprintUnlock).where(eq(blueprintUnlock.reason, 'besucher'))).toEqual([]);
  });

  it('zählt nur Bauten nach dem Erzeugen des Ereignisses', async () => {
    const world = await builtWorld();
    await earnEnergy(world.backend, world.philipp, ['2026-10-13']);
    // Vor dem Besuch baut Philipp alle drei Start-Baupläne seiner Rolle: 1 + 2 + 3 von 8 Energie.
    for (const [key, blueprintKey] of [[fieldKeys.philippsEcke, 'holzweg'], [fieldKeys.philippsEcke2, 'sitzbank'], [fieldKeys.philippsRollenbereich, 'laterne']] as const) {
      await buildAs(world, world.actor, { fieldId: world.fieldId(key), blueprintKey });
    }
    world.clock.advanceBy(60_000);
    await pullAll(world.backend, world.actor);
    const visit = await visitOf(world, world.philipp);

    const [result] = await push(world.backend, world.actor, [claimOp(visit.stateId)]);

    expect(rejection(result)).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
    expect(visit.status).toBe('offen');
  });

  it('bringt Deko ins Lager, wenn kein Besucher-Bauplan der Rolle mehr übrig ist', async () => {
    const world = await visitedWorld();
    const db = world.backend.database.db;
    const at = new Date(Date.parse(world.clock.read().instant));
    for (const catalogKey of visitorBlueprints('bauen')) {
      await db.insert(blueprintUnlock).values({
        id: randomUUID(), islandId: world.islandId, couplingId: world.couplingId, catalogKey, reason: 'besucher', unlockedAt: at, createdAt: at, serverVersion: 1n,
      });
    }
    await buildAs(world, world.actor, { fieldId: world.fieldId(fieldKeys.philippsEcke), blueprintKey: world.visit.details.wish.blueprintKey });

    const [claimed] = await push(world.backend, world.actor, [claimOp(world.visit.stateId)]);

    expect(claimed).toMatchObject({ type: 'applied' });
    const template = gameCatalog.visitorTemplates.find((entry) => entry.key === world.visit.templateKey)!;
    const [deko] = await db.select().from(islandObject).where(eq(islandObject.id, eventRewardId(world.visit.stateId)));
    expect(deko).toMatchObject({ ownerPersonId: world.philipp.personId, origin: 'besucher', fieldId: null, level: 1 });
    expect(template.rewards.deko).toContain(deko!.catalogKey);
    const [event] = await db.select().from(islandEvent).where(eq(islandEvent.id, world.visit.eventId));
    expect(event!.reward).toEqual({ ...world.visit.details, reward: { type: 'deko', key: deko!.catalogKey } });
  });

  it('Ereignisse verfallen nie: ein Wunsch lässt sich auch Wochen später erfüllen und abholen', async () => {
    const world = await visitedWorld();
    world.clock.advanceBy(30 * dayMs);
    await earnEnergy(world.backend, world.philipp, ['2026-11-13']);
    await buildAs(world, world.actor, { fieldId: world.fieldId(fieldKeys.philippsEcke), blueprintKey: world.visit.details.wish.blueprintKey });

    const [claimed] = await push(world.backend, world.actor, [claimOp(world.visit.stateId)]);

    expect(claimed).toMatchObject({ type: 'applied' });
  });
});

describe('markEventsSeen', { timeout: 60_000 }, () => {
  it('setzt den eigenen Stand auf gesehen; ein zweites Gerät ist ein Retry', async () => {
    const world = await visitedWorld();

    const [seen] = await push(world.backend, world.actor, [seenOp(world.visit.stateId)]);
    const [again] = await push(world.backend, world.actor, [seenOp(world.visit.stateId)]);

    expect(seen).toMatchObject({ type: 'applied', changes: [{ entityType: 'island_event_state', data: { seenAt: world.clock.read().instant, claimedAt: null } }] });
    expect(again).toMatchObject({ type: 'already_applied' });
    const [annas] = await world.backend.database.db
      .select()
      .from(islandEventState)
      .where(and(eq(islandEventState.id, world.annasVisit.stateId)));
    expect(annas?.seenAt).toBeNull();
  });
});

describe('Autorisierung', () => {
  describe('markEventsSeen', () => {
    for (const testCase of authorizationCases({ ...markEventsSeenScenario, command: 'markEventsSeen' })) it(testCase.name, testCase.run, 60_000);
  });
  describe('claimEventReward', () => {
    for (const testCase of authorizationCases({ ...claimEventRewardScenario, command: 'claimEventReward' })) it(testCase.name, testCase.run, 60_000);
  });
});
