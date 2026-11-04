import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';
import type { IslandRole } from '@abnehm/contracts/island';
import { NotificationIntent } from '@abnehm/contracts/notifications';
import { notificationTexts } from '@abnehm/contracts/notification-texts';

import { island, notificationIntent } from '../src/db/schema/index.ts';
import { createTestBackend, type TestBackend } from './support/app.ts';
import { authorizationCases, httpOutcome, personWithSession, resourceProbe } from './support/authorization.ts';
import { policies } from '../src/authorization/authorization.ts';
import { coupleByInvitation, coupledWorld, otherCouple, worldStart, type CoupledWorld } from './support/coupled-world.ts';
import { actionIdOf, decideOp, recordsOf, requestOp, uncoupleWorld } from './support/shared-actions.ts';
import { pullAll, push, pushOutcome } from './support/sync.ts';
import type { Device } from './support/auth-client.ts';

// Nachweis für #180: die Art `rollenwahl` (Spezifikation 4, Abschnitte 2.4 und 7) über Push und Pull der
// echten Hono-App mit isoliertem Postgres und Testuhr. Die Annahme ist das Schlüpfen; das liefert #184.

const proposal = (proposerRole: IslandRole, actionId = EntityId.parse(randomUUID())) =>
  requestOp({ type: 'rollenwahl', actionId, payload: { proposerRole } });

/** Philipp und Anna, gekoppelt über die echte Einladung; die Insel wartet auf die Rollen. */
async function couple() {
  const backend = await createTestBackend({ clock: createTestClock(worldStart) });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const { couplingId } = await coupleByInvitation(backend, philipp.device, anna.device);
  return { backend, philipp, anna, couplingId: EntityId.parse(couplingId) };
}

async function intentsOf(backend: TestBackend) {
  const rows = await backend.database.db.select().from(notificationIntent).orderBy(notificationIntent.createdAt, notificationIntent.intentId);
  return rows.map((row) =>
    NotificationIntent.parse({
      intentId: row.intentId,
      sourceEventId: row.sourceEventId,
      recipientPersonId: row.recipientPersonId,
      type: row.type,
      messageKey: row.messageKey,
      createdAt: row.createdAt.toISOString(),
      payload: row.payload,
    }),
  );
}

async function openRoleChoices(backend: TestBackend, device: Device) {
  return Object.values(recordsOf((await pullAll(backend, device)).changes, 'shared_action')).filter(
    (action) => action.type === 'rollenwahl' && action.status === 'offen',
  );
}

describe('Rollenwahl vorschlagen und beantworten', () => {
  it('Tracer Bullet: Philipp schlägt Bauen vor, Anna lehnt ab und schlägt selbst vor; Philipp sieht ihren Vorschlag', async () => {
    const { backend, philipp, anna, couplingId } = await couple();
    const philippsVorschlag = proposal('bauen');

    const [requested] = await push(backend, philipp.device, [philippsVorschlag]);
    expect(requested).toMatchObject({
      type: 'applied',
      changes: [{ entityType: 'shared_action', data: { type: 'rollenwahl', status: 'offen', payload: { proposerRole: 'bauen' } } }],
    });
    // Der Intent an Anna entsteht in der Transaktion des Antrags; sein Text kommt aus dem gemeinsamen Katalog.
    const [anAnna] = await intentsOf(backend);
    expect(anAnna).toEqual({
      intentId: `${actionIdOf(philippsVorschlag)}:${anna.personId}:rollen_anfrage`,
      sourceEventId: actionIdOf(philippsVorschlag),
      recipientPersonId: anna.personId,
      type: 'rollen_anfrage',
      messageKey: 'rollen_anfrage.rollenwahl',
      createdAt: worldStart.instant,
      payload: { actionId: actionIdOf(philippsVorschlag), kind: 'rollenwahl', senderDisplayName: 'Philipp' },
    });
    expect(notificationTexts.renderStored(anAnna!.messageKey, anAnna!.payload)).toEqual({
      type: 'rendered',
      text: { title: 'Philipp schlägt eure Rollen vor', body: 'Wenn du zustimmst, schlüpft Momo 🐣' },
    });
    expect(await openRoleChoices(backend, anna.device)).toEqual([
      expect.objectContaining({ id: actionIdOf(philippsVorschlag), couplingId, requesterPersonId: philipp.personId }),
    ]);

    const [declined] = await push(backend, anna.device, [decideOp(actionIdOf(philippsVorschlag), 'ablehnen')]);
    expect(declined).toMatchObject({ type: 'applied', changes: [{ data: { status: 'abgelehnt' } }] });

    const annasVorschlag = proposal('natur');
    expect(await push(backend, anna.device, [annasVorschlag])).toMatchObject([{ type: 'applied' }]);
    expect(await openRoleChoices(backend, philipp.device)).toEqual([
      expect.objectContaining({ id: actionIdOf(annasVorschlag), requesterPersonId: anna.personId, payload: { proposerRole: 'natur' } }),
    ]);
    // Beide Intents tragen denselben Zeitpunkt der Testuhr; die Reihenfolge ist deshalb offen.
    const intents = (await intentsOf(backend)).map(({ recipientPersonId, payload }) => [recipientPersonId, payload]);
    expect(intents).toHaveLength(2);
    expect(intents).toEqual(
      expect.arrayContaining([
        [anna.personId, expect.objectContaining({ senderDisplayName: 'Philipp' })],
        [philipp.personId, expect.objectContaining({ actionId: actionIdOf(annasVorschlag), senderDisplayName: 'Anna' })],
      ]),
    );
    // Bis zum Schlüpfen wartet die Insel auf die Rollen.
    const [wartend] = await backend.database.db.select({ state: island.state }).from(island).where(eq(island.couplingId, couplingId));
    expect(wartend).toEqual({ state: 'wartet_auf_rollen' });
  });

  it('zurückziehen: der Vorschlag endet, danach schlägt dieselbe Person neu vor', async () => {
    const { backend, philipp, anna } = await couple();
    const first = proposal('bauen');
    await push(backend, philipp.device, [first]);

    const [withdrawn] = await push(backend, philipp.device, [decideOp(actionIdOf(first), 'zurueckziehen')]);
    const [again] = await push(backend, philipp.device, [proposal('natur')]);

    expect(withdrawn).toMatchObject({ type: 'applied', changes: [{ data: { status: 'zurueckgezogen' } }] });
    expect(again).toMatchObject({ type: 'applied', changes: [{ data: { status: 'offen', payload: { proposerRole: 'natur' } } }] });
    expect(await openRoleChoices(backend, anna.device)).toHaveLength(1);
  });

  it('ein Retry desselben Antrags legt weder eine zweite Aktion noch einen zweiten Intent an', async () => {
    const { backend, philipp } = await couple();
    const operation = proposal('bauen');
    const [first] = await push(backend, philipp.device, [operation]);
    const [retry] = await push(backend, philipp.device, [operation]);

    expect(retry).toEqual({ ...first, type: 'already_applied' });
    expect(await intentsOf(backend)).toHaveLength(1);
  });

  it('gleichzeitige Vorschläge beider Personen: genau einer bleibt offen, der andere ist dauerhaft abgelehnt', async () => {
    const { backend, philipp, anna } = await couple();
    const [vonPhilipp, vonAnna] = [proposal('bauen'), proposal('bauen')];

    const [[philippsErgebnis], [annasErgebnis]] = await Promise.all([
      push(backend, philipp.device, [vonPhilipp]),
      push(backend, anna.device, [vonAnna]),
    ]);

    const outcomes = [philippsErgebnis!.type, annasErgebnis!.type].sort();
    expect(outcomes).toEqual(['applied', 'permanently_rejected']);
    const rejected = [philippsErgebnis, annasErgebnis].find((result) => result!.type === 'permanently_rejected');
    expect(rejected).toMatchObject({ error: { code: 'conflict' } });
    expect(await openRoleChoices(backend, philipp.device)).toHaveLength(1);
    // Nur der angenommene Antrag benachrichtigt den Partner.
    expect(await intentsOf(backend)).toHaveLength(1);
  });

  it('nacheinander: ein zweiter Vorschlag neben einem offenen scheitert mit conflict', async () => {
    const { backend, philipp, anna } = await couple();
    await push(backend, philipp.device, [proposal('bauen')]);

    expect(await push(backend, anna.device, [proposal('natur')])).toMatchObject([{ type: 'permanently_rejected', error: { code: 'conflict' } }]);
    expect(await push(backend, philipp.device, [proposal('natur')])).toMatchObject([{ type: 'permanently_rejected', error: { code: 'conflict' } }]);
  });

  it('beantragen geht nur, solange die Insel auf die Rollen wartet', async () => {
    const { backend, philipp, couplingId } = await couple();
    await backend.database.db
      .update(island)
      .set({ state: 'aktiv', hatchedAt: new Date(worldStart.instant), timeZone: worldStart.timeZone })
      .where(eq(island.couplingId, couplingId));

    expect(await push(backend, philipp.device, [proposal('bauen')])).toMatchObject([{ type: 'permanently_rejected', error: { code: 'conflict' } }]);
    expect(await intentsOf(backend)).toEqual([]);
  });

  it('annehmen schlüpft erst mit #184: bis dahin wird die Annahme abgelehnt, und der Vorschlag bleibt offen', async () => {
    const { backend, philipp, anna } = await couple();
    const operation = proposal('bauen');
    await push(backend, philipp.device, [operation]);

    expect(await push(backend, anna.device, [decideOp(actionIdOf(operation), 'annehmen')])).toMatchObject([
      { type: 'permanently_rejected', error: { code: 'conflict' } },
    ]);
    expect(await openRoleChoices(backend, anna.device)).toHaveLength(1);
  });
});

type RoleChoiceWorld = CoupledWorld & { actor: Device; actionId: EntityId };

/** Gekoppelte Welt, in der Anna die Rollenwahl vorgeschlagen hat. */
async function roleChoiceWorld(): Promise<RoleChoiceWorld> {
  const world = await coupledWorld();
  const operation = proposal('natur');
  if ((await pushOutcome(world.backend, world.anna.device, operation)) !== 'erlaubt') throw new Error('Vorschlag fehlgeschlagen');
  return { ...world, actor: world.anna.device, actionId: actionIdOf(operation) };
}

describe('Autorisierung der Rollenwahl', () => {
  const probe = (world: RoleChoiceWorld, entity: 'shared_action_request' | 'shared_action_decision') =>
    resourceProbe(world.backend, policies.resource(entity, 'lesen'))(world.actor, { id: world.actionId }).then(httpOutcome);

  describe('vorschlagen', () => {
    const cases = authorizationCases({
      policy: policies.resource('shared_action_request', 'befehl'),
      command: 'requestSharedAction',
      // Annas Vorschlag ist offen; die Gegenprobe ist Annas Rückzug und ein neuer Vorschlag.
      arrange: async () => {
        const world = await roleChoiceWorld();
        await push(world.backend, world.anna.device, [decideOp(world.actionId, 'zurueckziehen')]);
        return world;
      },
      attempt: (world, device) => pushOutcome(world.backend, device, proposal('bauen')),
      manipulierte_id: async (world) => {
        const other = await otherCouple(world);
        const theirs = proposal('bauen');
        await pushOutcome(world.backend, other.anna.device, theirs);
        return pushOutcome(world.backend, world.actor, proposal('bauen', actionIdOf(theirs)));
      },
      entkopplung: async (world) => void (await uncoupleWorld(world)),
      verbotene_operation: (world) => probe(world, 'shared_action_request'),
    });
    for (const { name, run } of cases) it(name, run, 20_000);
  });

  describe('ablehnen', () => {
    const cases = authorizationCases({
      policy: policies.resource('shared_action_decision', 'befehl'),
      command: 'decideSharedAction',
      arrange: async () => {
        const world = await roleChoiceWorld();
        return { ...world, actor: world.philipp.device };
      },
      attempt: (world, device) => pushOutcome(world.backend, device, decideOp(world.actionId, 'ablehnen')),
      manipulierte_id: async (world) => {
        const other = await otherCouple(world);
        const theirs = proposal('bauen');
        await pushOutcome(world.backend, other.anna.device, theirs);
        return pushOutcome(world.backend, world.actor, decideOp(actionIdOf(theirs), 'ablehnen'));
      },
      entkopplung: async (world) => void (await uncoupleWorld(world)),
      verbotene_operation: (world) => probe(world, 'shared_action_decision'),
    });
    for (const { name, run } of cases) it(name, run, 20_000);
  });

  it('fremde Person: weder ablehnen noch zurückziehen', async () => {
    const world = await roleChoiceWorld();
    const stranger = (await personWithSession(world.backend, 'fremd@example.test')).device;

    expect(await pushOutcome(world.backend, stranger, decideOp(world.actionId, 'ablehnen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, stranger, decideOp(world.actionId, 'zurueckziehen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.philipp.device, decideOp(world.actionId, 'ablehnen'))).toBe('erlaubt');
  });

  it('Antragsteller lehnt ab: verweigert, die Gegenprobe des Partners gelingt', async () => {
    const world = await roleChoiceWorld();

    expect(await pushOutcome(world.backend, world.anna.device, decideOp(world.actionId, 'ablehnen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.philipp.device, decideOp(world.actionId, 'ablehnen'))).toBe('erlaubt');
  });

  it('Partner zieht zurück: verweigert, die Gegenprobe des Antragstellers gelingt', async () => {
    const world = await roleChoiceWorld();

    expect(await pushOutcome(world.backend, world.philipp.device, decideOp(world.actionId, 'zurueckziehen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.anna.device, decideOp(world.actionId, 'zurueckziehen'))).toBe('erlaubt');
  });

  it('archivierte Kopplung: weder vorschlagen noch über den vorher offenen Vorschlag entscheiden', async () => {
    const world = await roleChoiceWorld();
    await uncoupleWorld(world);

    expect(await pushOutcome(world.backend, world.philipp.device, proposal('bauen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.philipp.device, decideOp(world.actionId, 'ablehnen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.anna.device, decideOp(world.actionId, 'zurueckziehen'))).toBe('verweigert');
  });
});
