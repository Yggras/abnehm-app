import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';
import { sharedActionRequestKey } from '@abnehm/contracts/island';

import { authorizationCases } from './support/authorization.ts';
import { worldStart } from './support/coupled-world.ts';
import {
  actionIdOf,
  decideOp,
  invitedCouple as setup,
  recordsOf,
  requestOp,
  roleSwapRequest,
  sharedActionCommandScenarios,
  sharedActionWorld,
  testRoleKind,
  uncoupleWorld,
  unverschenkbar,
} from './support/shared-actions.ts';
import { pullAll, push, pushOutcome } from './support/sync.ts';

// Nachweis für #107: der Rahmen gemeinsamer Aktionen (Spezifikation 0, Abschnitt 9) über Push und Pull
// der echten Hono-App. Test-Arten stehen für Rollenwahl, Rollentausch und Deko schenken aus
// Spezifikation 4; der Rahmen selbst kennt keine Art.

describe('Gemeinsame Aktion beantragen und entscheiden', () => {
  it('Tracer Bullet: Anna beantragt eine Test-Aktion, Philipp nimmt an, und die Zustandsänderung kommt mit der Entscheidung', async () => {
    const { backend, anna, philipp, couplingId, cursors } = await setup();
    const request = roleSwapRequest();
    const actionId = actionIdOf(request);

    const [requested] = await push(backend, anna.device, [request]);
    expect(requested).toMatchObject({
      type: 'applied',
      changes: [{ type: 'record', entityType: 'shared_action', entityId: actionId, data: { status: 'offen', requesterPersonId: anna.personId } }],
    });
    expect(recordsOf((await pullAll(backend, philipp.device, cursors.philipp)).changes, 'shared_action')).toEqual({
      [actionId]: {
        id: actionId,
        couplingId,
        requesterPersonId: anna.personId,
        type: 'rollentausch',
        payload: {},
        status: 'offen',
        createdAt: worldStart.instant,
        decidedAt: null,
      },
    });

    const [decided] = await push(backend, philipp.device, [decideOp(actionId, 'annehmen', { timeZone: 'America/New_York' })]);
    expect(decided).toMatchObject({ type: 'applied', changes: [{ entityId: actionId, data: { status: 'angenommen', decidedAt: worldStart.instant } }] });

    const seenByAnna = (await pullAll(backend, anna.device, cursors.anna)).changes;
    expect(recordsOf(seenByAnna, 'shared_action')[actionId]).toMatchObject({ status: 'angenommen' });
    const roles = Object.values(recordsOf(seenByAnna, 'coupling_member')).map(({ personId, role }) => [personId, role]);
    expect(Object.fromEntries(roles)).toEqual({ [anna.personId]: 'bauen', [philipp.personId]: 'natur' });
    // Die Art erhält die Zone des annehmenden Geräts, nicht die der Person.
    expect(Object.values(recordsOf(seenByAnna, 'island'))).toEqual([expect.objectContaining({ state: 'aktiv', timeZone: 'America/New_York' })]);
  });

  it('geht genau einmal von offen in einen Endzustand; jede weitere Entscheidung ändert nichts', async () => {
    const { backend, anna, philipp } = await setup();
    const request = roleSwapRequest();
    const actionId = actionIdOf(request);
    await push(backend, anna.device, [request]);
    const declined = decideOp(actionId, 'ablehnen');
    const [first] = await push(backend, philipp.device, [declined]);
    expect(first).toMatchObject({ type: 'applied', changes: [{ data: { status: 'abgelehnt' } }] });

    const [withdrawn] = await push(backend, anna.device, [decideOp(actionId, 'zurueckziehen')]);
    const [acceptedAfterwards] = await push(backend, philipp.device, [decideOp(actionId, 'annehmen')]);
    const [retry] = await push(backend, philipp.device, [declined]);

    expect(withdrawn).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
    expect(acceptedAfterwards).toMatchObject({ type: 'permanently_rejected', error: { code: 'operation_conflict' } });
    expect(retry).toEqual({ ...first, type: 'already_applied' });
    const { changes } = await pullAll(backend, anna.device);
    expect(recordsOf(changes, 'shared_action')[actionId]).toMatchObject({ status: 'abgelehnt' });
    expect(Object.values(recordsOf(changes, 'coupling_member')).map((member) => member.role)).toEqual([null, null]);
  });

  it('lässt den Antragsteller zurückziehen; danach nimmt der Partner nichts mehr an', async () => {
    const { backend, anna, philipp } = await setup();
    const request = roleSwapRequest();
    await push(backend, anna.device, [request]);

    const [withdrawn] = await push(backend, anna.device, [decideOp(actionIdOf(request), 'zurueckziehen')]);
    const [accepted] = await push(backend, philipp.device, [decideOp(actionIdOf(request), 'annehmen')]);

    expect(withdrawn).toMatchObject({ type: 'applied', changes: [{ data: { status: 'zurueckgezogen' } }] });
    expect(accepted).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
  });
});

describe('Autorisierung', () => {
  for (const [command, scenario] of Object.entries(sharedActionCommandScenarios)) {
    describe(command, () => {
      for (const testCase of authorizationCases({ ...scenario, command })) it(testCase.name, testCase.run, 20_000);
    });
  }

  it('Antragsteller entscheidet selbst: verweigert, die Gegenprobe des Partners gelingt', async () => {
    const world = await sharedActionWorld();

    expect(await pushOutcome(world.backend, world.anna.device, decideOp(world.actionId, 'annehmen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.anna.device, decideOp(world.actionId, 'ablehnen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.philipp.device, decideOp(world.actionId, 'ablehnen'))).toBe('erlaubt');
  });

  it('Partner zieht zurück: verweigert, die Gegenprobe des Antragstellers gelingt', async () => {
    const world = await sharedActionWorld();

    expect(await pushOutcome(world.backend, world.philipp.device, decideOp(world.actionId, 'zurueckziehen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.anna.device, decideOp(world.actionId, 'zurueckziehen'))).toBe('erlaubt');
  });

  it('nach der Entkopplung: weder beantragen noch entscheiden, auch nicht über eine vorher offene Aktion', async () => {
    const world = await sharedActionWorld();
    await uncoupleWorld(world);

    for (const decision of ['annehmen', 'ablehnen'] as const) {
      expect(await pushOutcome(world.backend, world.philipp.device, decideOp(world.actionId, decision))).toBe('verweigert');
    }
    expect(await pushOutcome(world.backend, world.anna.device, decideOp(world.actionId, 'zurueckziehen'))).toBe('verweigert');
    expect(await pushOutcome(world.backend, world.anna.device, roleSwapRequest())).toBe('verweigert');
  });
});

describe('Atomarität', () => {
  const gift = (actionId: EntityId, decoKey = 'muschelkranz') =>
    requestOp({ actionId, type: 'deko_schenken', payload: { islandObjectId: EntityId.parse(randomUUID()), decoKey } });

  it('scheitert die Zustandsänderung der Annahme, bleibt die Aktion offen und nichts davon bestehen', async () => {
    const { backend, anna, philipp } = await setup();
    const actionId = EntityId.parse(randomUUID());
    await push(backend, anna.device, [gift(actionId)]);

    const [accepted] = await push(backend, philipp.device, [decideOp(actionId, 'annehmen')]);

    expect(accepted).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
    const { changes } = await pullAll(backend, anna.device);
    expect(recordsOf(changes, 'shared_action')[actionId]).toMatchObject({ status: 'offen', decidedAt: null });
    expect(Object.values(recordsOf(changes, 'coupling_member')).map((member) => member.role)).toEqual([null, null]);
    // Offen heißt: Philipp kann weiterhin ablehnen.
    expect((await push(backend, philipp.device, [decideOp(actionId, 'ablehnen')]))[0]?.type).toBe('applied');
  });

  it('lehnt die Art einen Antrag ab, entsteht keine Aktion', async () => {
    const { backend, anna } = await setup();

    const [requested] = await push(backend, anna.device, [gift(EntityId.parse(randomUUID()), unverschenkbar)]);

    expect(requested).toMatchObject({ type: 'permanently_rejected', error: { code: 'conflict' } });
    expect(recordsOf((await pullAll(backend, anna.device)).changes, 'shared_action')).toEqual({});
  });

  it('lehnt nicht angemeldete Arten, Entkoppeln, eine falsche Nutzlast der Art und einen fremden Schlüssel als ungültig ab', async () => {
    // Nur der Rollentausch ist angemeldet; Deko schenken steht für eine nicht angemeldete Art.
    const { backend, anna } = await setup({ kinds: [testRoleKind] });
    const id = () => EntityId.parse(randomUUID());
    const raw = (payload: object) => ({ ...roleSwapRequest(), payload: { actionId: id(), ...payload } }) as never;

    const results = await push(backend, anna.device, [
      requestOp({ actionId: id(), type: 'deko_schenken', payload: { islandObjectId: id(), decoKey: 'muschelkranz' } }),
      raw({ type: 'entkoppeln', payload: {} }),
      raw({ type: 'rollentausch', payload: { proposerRole: 'bauen' } }),
      requestOp({ actionId: id(), type: 'rollentausch', payload: {} }, { businessKey: sharedActionRequestKey(id()) }),
    ]);

    expect(results.map((result) => (result.type === 'permanently_rejected' ? result.error.code : result.type))).toEqual([
      'invalid_payload',
      'invalid_payload',
      'invalid_payload',
      'invalid_payload',
    ]);
    expect(recordsOf((await pullAll(backend, anna.device)).changes, 'shared_action')).toEqual({});
  });
});
