import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId } from '@abnehm/contracts/base';
import type { ContributionState } from '@abnehm/contracts/contribution';
import { MomoCharacterState } from '@abnehm/contracts/today';
import { WirContributionsState, type WirContribution } from '@abnehm/contracts/wir';

import { createIsland, type Island } from '../../mobile/src/island/island.ts';
import type { IslandStage } from '../../mobile/src/island/role-choice.ts';
import { sharedActionCommands } from '../../mobile/src/island/role-choice.ts';
import { createLocalDatabases } from '../../mobile/src/local-db/local-databases.ts';
import { sharedAction as localAction } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { createBetterSqliteFiles } from '../../mobile/src/local-db/testing/better-sqlite.ts';
import {
  createHttpSyncTransport,
  createLocalCommandRegistry,
  createSyncEngine,
  createSyncRegistry,
  createSyncWriter,
  foundationLocalCommands,
  foundationSyncEntities,
} from '../../mobile/src/sync/index.ts';
import { pendingOperations } from '../../mobile/src/sync/outbox.ts';
import type { TodayState } from '../../mobile/src/shell/today-registry.ts';
import { createTestBackend, testBaseUrl, type TestBackend } from './support/app.ts';
import type { Device } from './support/auth-client.ts';
import { personWithSession } from './support/authorization.ts';
import { coupleByInvitation, worldStart } from './support/coupled-world.ts';
import { uncoupleAs } from './support/shared-actions.ts';

// Nachweis für #180 auf zwei Geräten: der Spieldienst der App (Laichkugel und Rollenwahl) mit Engine,
// Outbox und Adaptern auf echtem SQLite (better-sqlite3) gegen die echte Hono-App mit Postgres.
// Gemeinsame Aktionen sind offline nur vorgemerkt; „Heute“ und „Wir“ folgen den lokalen Daten.

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type Phone = Awaited<ReturnType<typeof phone>>;

async function phone(backend: TestBackend, accountId: string, device: Device) {
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  cleanups.push(() => {
    databases.lock();
    files.remove();
  });
  const database = await databases.open(accountId);
  const clock = createTestClock(worldStart);
  const newId = () => EntityId.parse(randomUUID());
  const registry = createSyncRegistry(foundationSyncEntities);
  const writer = createSyncWriter({ registry, clock, newId });
  let online = true;
  const engine = createSyncEngine({
    database,
    registry,
    transport: createHttpSyncTransport({
      baseUrl: testBaseUrl,
      fetch: async (input, init) => {
        if (!online) throw new TypeError('Netzwerk nicht erreichbar');
        const headers = new Headers(init?.headers);
        headers.set('authorization', `Bearer ${device.token ?? ''}`);
        headers.set('x-forwarded-for', device.ip);
        return backend.app.request(String(input), { ...init, headers });
      },
    }),
    clock,
    installationId: newId(),
    commands: createLocalCommandRegistry({ database, writer, commands: [...foundationLocalCommands, ...sharedActionCommands] }),
  });
  const island: Island = createIsland({ database, writer, clock, newId });
  const latest = <T,>(subscribe: (listener: (value: T) => void) => () => void) => {
    let value: T | undefined;
    cleanups.push(subscribe((next) => (value = next)));
    return () => value as T;
  };
  return {
    island,
    stage: latest<IslandStage>((listener) => island.observeStage(listener)),
    character: latest<TodayState<'momo.character'>>((listener) => island.momoCharacter.subscribe((state) => listener(MomoCharacterState.parse(state)))),
    wir: latest<ContributionState<WirContribution[]>>((listener) => island.wirContributions.subscribe((state) => listener(WirContributionsState.parse(state)))),
    offline: () => (online = false),
    online: () => (online = true),
    async sync() {
      expect(await engine.sync()).toEqual({ push: expect.stringMatching(/^(done|nothing_to_do)$/), pull: 'done' });
    },
    outbox: () => database.read((tx) => pendingOperations(tx, 100)),
    openRoleChoices: () =>
      database.read((tx) => sqliteOf(tx).select().from(localAction).all().filter((row) => row.kind === 'rollenwahl' && row.status === 'offen')),
  };
}

const proposal = (phone: Phone) => {
  const stage = phone.stage();
  if (stage.type !== 'rollenwahl' || stage.proposal === null) throw new Error(`Kein offener Vorschlag: ${JSON.stringify(stage)}`);
  return stage.proposal;
};

const pendingCard = (actionId: string, requesterDisplayName: string) => ({
  type: 'ready',
  data: [
    {
      type: 'pending_shared_action',
      id: actionId,
      dataAsOf: worldStart.instant,
      action: { actionId: 'wir.answer_role_choice', target: { type: 'momo', view: 'rollenwahl' } },
      actionId,
      kind: 'rollenwahl',
      requesterDisplayName,
    },
  ],
});

const roleChoice = { actionId: 'momo.open_role_choice', target: { type: 'momo', view: 'rollenwahl' } };

/** Philipp und Anna mit je einem Gerät, noch ungekoppelt und auf dem Stand des Servers. */
async function couple() {
  const backend = await createTestBackend({ clock: createTestClock(worldStart) });
  const philipp = await personWithSession(backend, 'philipp@example.test', 'Philipp');
  const anna = await personWithSession(backend, 'anna@example.test', 'Anna');
  const philippsPhone = await phone(backend, philipp.accountId, philipp.device);
  const annasPhone = await phone(backend, anna.accountId, anna.device);
  await philippsPhone.sync();
  await annasPhone.sync();
  return { backend, philipp, anna, philippsPhone, annasPhone };
}

describe('Laichkugel und Rollenwahl App ↔ Backend', () => {
  it('Tracer Bullet: Laichkugel solo; nach der Kopplung schlägt Philipp vor, Anna lehnt ab und schlägt selbst vor', async () => {
    const { backend, philipp, anna, philippsPhone, annasPhone } = await couple();
    expect(philippsPhone.stage()).toEqual({ type: 'laichkugel', energy: 0 });
    expect(philippsPhone.character()).toEqual({ type: 'empty', reasonKey: 'momo_wartet_im_ei', action: { actionId: 'momo.invite_partner', target: { type: 'partner.invite' } } });
    expect(philippsPhone.wir()).toEqual({ type: 'ready', data: [] });

    await coupleByInvitation(backend, philipp.device, anna.device);
    await philippsPhone.sync();
    await annasPhone.sync();
    expect(philippsPhone.stage()).toMatchObject({ type: 'rollenwahl', partnerDisplayName: 'Anna', proposal: null });
    expect(philippsPhone.character()).toEqual({ type: 'empty', reasonKey: 'rollenwahl_offen', action: roleChoice });

    // Offline nur vorgemerkt: Philipp sieht „Vorschlag gesendet“, der Server noch nichts.
    philippsPhone.offline();
    expect(philippsPhone.island.proposeRoles('bauen')).toBe('vorgemerkt');
    expect(proposal(philippsPhone)).toMatchObject({ by: 'self', proposerRole: 'bauen', createdAt: null });
    expect(philippsPhone.character()).toEqual({ type: 'empty', reasonKey: 'rollenwahl_gesendet', action: roleChoice });
    expect(philippsPhone.island.proposeRoles('natur')).toBe('nicht_moeglich');
    expect(philippsPhone.outbox()).toHaveLength(1);
    await annasPhone.sync();
    expect(annasPhone.stage()).toMatchObject({ proposal: null });

    philippsPhone.online();
    await philippsPhone.sync();
    await annasPhone.sync();
    const philippsVorschlag = proposal(annasPhone);
    expect(philippsVorschlag).toMatchObject({ by: 'partner', proposerRole: 'bauen', createdAt: worldStart.instant });
    expect(annasPhone.character()).toEqual({ type: 'empty', reasonKey: 'rollenwahl_offen', action: roleChoice });
    // Nur die Person, die antworten muss, bekommt die Karte auf „Wir“.
    expect(annasPhone.wir()).toEqual(pendingCard(philippsVorschlag.actionId, 'Philipp'));
    expect(philippsPhone.wir()).toEqual({ type: 'ready', data: [] });
    expect(proposal(philippsPhone)).toMatchObject({ by: 'self', createdAt: worldStart.instant });

    expect(annasPhone.island.withdrawRoles(philippsVorschlag.actionId)).toBe('nicht_moeglich');
    expect(annasPhone.island.declineRoles(philippsVorschlag.actionId)).toBe('vorgemerkt');
    expect(annasPhone.stage()).toMatchObject({ proposal: null });
    expect(annasPhone.wir()).toEqual({ type: 'ready', data: [] });
    expect(annasPhone.island.proposeRoles('natur')).toBe('vorgemerkt');
    await annasPhone.sync();
    await philippsPhone.sync();

    const annasVorschlag = proposal(philippsPhone);
    expect(annasVorschlag).toMatchObject({ by: 'partner', proposerRole: 'natur' });
    expect(philippsPhone.wir()).toEqual(pendingCard(annasVorschlag.actionId, 'Anna'));
    expect(annasPhone.character()).toMatchObject({ reasonKey: 'rollenwahl_gesendet' });
    expect(philippsPhone.openRoleChoices()).toHaveLength(1);
  });

  it('zurückziehen: Philipp zieht seinen Vorschlag zurück, danach kann jede Person neu vorschlagen', async () => {
    const { backend, philipp, anna, philippsPhone, annasPhone } = await couple();
    await coupleByInvitation(backend, philipp.device, anna.device);
    await philippsPhone.sync();
    philippsPhone.island.proposeRoles('bauen');
    await philippsPhone.sync();

    expect(philippsPhone.island.withdrawRoles(proposal(philippsPhone).actionId)).toBe('vorgemerkt');
    expect(philippsPhone.stage()).toMatchObject({ proposal: null });
    await philippsPhone.sync();
    await annasPhone.sync();

    expect(annasPhone.stage()).toMatchObject({ proposal: null });
    expect(annasPhone.island.proposeRoles('bauen')).toBe('vorgemerkt');
  });

  it('gleichzeitige Vorschläge offline: der später eingehende wird abgelehnt und verschwindet samt Vormerkung', async () => {
    const { backend, philipp, anna, philippsPhone, annasPhone } = await couple();
    await coupleByInvitation(backend, philipp.device, anna.device);
    await philippsPhone.sync();
    await annasPhone.sync();
    philippsPhone.offline();
    annasPhone.offline();
    philippsPhone.island.proposeRoles('bauen');
    annasPhone.island.proposeRoles('bauen');

    annasPhone.online();
    await annasPhone.sync();
    philippsPhone.online();
    await philippsPhone.sync();
    await annasPhone.sync();

    expect(philippsPhone.outbox()).toEqual([]);
    expect(proposal(philippsPhone)).toMatchObject({ by: 'partner' });
    expect(proposal(annasPhone)).toMatchObject({ by: 'self' });
    expect(philippsPhone.openRoleChoices()).toHaveLength(1);
    expect(annasPhone.openRoleChoices()).toHaveLength(1);
  });

  it('ein eigener Vorschlag scheitert nicht an einer lokal veralteten Rollenwahl des Partners', async () => {
    const { backend, philipp, anna, philippsPhone, annasPhone } = await couple();
    await coupleByInvitation(backend, philipp.device, anna.device);
    await annasPhone.sync();
    annasPhone.island.proposeRoles('natur');
    await annasPhone.sync();
    await philippsPhone.sync();
    const annasVorschlag = proposal(philippsPhone).actionId;
    // Anna zieht zurück; Philipp weiß das noch nicht, lehnt ab und schlägt selbst vor.
    annasPhone.island.withdrawRoles(annasVorschlag);
    await annasPhone.sync();
    philippsPhone.island.declineRoles(annasVorschlag);
    philippsPhone.island.proposeRoles('bauen');

    await philippsPhone.sync();
    await annasPhone.sync();

    expect(proposal(philippsPhone)).toMatchObject({ by: 'self', proposerRole: 'bauen' });
    expect(proposal(annasPhone)).toMatchObject({ by: 'partner', proposerRole: 'bauen' });
    expect(philippsPhone.openRoleChoices()).toHaveLength(1);
  });

  it('nach dem Entkoppeln: wieder Laichkugel, und die lokal noch offene Rollenwahl erscheint nicht auf „Wir“', async () => {
    const { backend, philipp, anna, philippsPhone, annasPhone } = await couple();
    const { couplingId } = await coupleByInvitation(backend, philipp.device, anna.device);
    await annasPhone.sync();
    annasPhone.island.proposeRoles('natur');
    await annasPhone.sync();
    await philippsPhone.sync();
    expect(philippsPhone.wir()).toMatchObject({ data: [{ type: 'pending_shared_action' }] });

    await uncoupleAs(backend, { couplingId, requesterPersonId: anna.personId });
    await philippsPhone.sync();

    expect(philippsPhone.openRoleChoices()).toHaveLength(1);
    expect(philippsPhone.stage()).toEqual({ type: 'laichkugel', energy: 0 });
    expect(philippsPhone.character()).toMatchObject({ reasonKey: 'momo_wartet_im_ei' });
    expect(philippsPhone.wir()).toEqual({ type: 'ready', data: [] });
  });
});
