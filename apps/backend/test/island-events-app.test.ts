import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { eventRewardId } from '@abnehm/contracts/island-records';
import { gameCatalog } from '@abnehm/game-rules/content';

import { blueprintUnlock as localUnlock, islandObject as localObject } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { blueprintUnlock } from '../src/db/schema/index.ts';
import { worldToday } from './support/coupled-world.ts';
import { energize, fieldOn, hatchedPhones, islandOf, type GamePhone } from './support/game-phones.ts';
import { uncoupleAs } from './support/shared-actions.ts';

// Nachweis für #202 auf echten Geräten: Besucher ansehen, Wunsch erfüllen und die Belohnung offline vorläufig
// abholen, im Spieldienst der App (Engine, Outbox und Adapter auf echtem SQLite) gegen die echte Hono-App mit
// Postgres (Spezifikation 4, Testnaht 3). Anna hat Natur, Philipp Bauen; Philipps Ecke beginnt bei
// `grundinsel:0:0`.

type World = Awaited<ReturnType<typeof hatchedPhones>>;

/** Server und Geräte eine Minute weiter: Für einen Wunsch zählen nur Handlungen nach seinem Erzeugen. */
function minuteLater(world: World) {
  for (const clock of [world.clock, world.philippsPhone.clock, world.annasPhone.clock]) clock.advanceBy(60_000);
}

const openOf = (phone: GamePhone) => islandOf(phone).events.open;

function onlyVisit(phone: GamePhone) {
  const [visit, ...rest] = openOf(phone);
  if (visit === undefined || rest.length > 0) throw new Error(`Genau ein offener Besuch erwartet: ${JSON.stringify(openOf(phone))}`);
  return visit;
}

function buildWish(phone: GamePhone, fieldKey: string) {
  const outcome = phone.game.build({ fieldId: fieldOn(phone, fieldKey), blueprintKey: onlyVisit(phone).wish.blueprintKey });
  if (outcome.type !== 'gebaut') throw new Error(`Bau fehlgeschlagen: ${JSON.stringify(outcome)}`);
}

/** Geschlüpfte Insel mit Energie für Philipp; beide Geräte haben ihren ersten Besucher gepullt. */
async function visitedPhones() {
  const world = await hatchedPhones();
  await energize(world, [worldToday]);
  await world.annasPhone.sync();
  minuteLater(world);
  return world;
}

const localRows = (phone: GamePhone, id: string) =>
  phone.database.read((tx) => ({
    unlock: sqliteOf(tx).select().from(localUnlock).where(eq(localUnlock.id, id)).get(),
    object: sqliteOf(tx).select().from(localObject).where(eq(localObject.id, id)).get(),
  }));

describe('Insel-Ereignisse App ↔ Backend', { timeout: 60_000 }, () => {
  it('Tracer Bullet: Nach dem Pull ist ein Besucher da; Philipp baut offline den Wunsch, holt die Belohnung vorläufig ab, und der Server bestätigt sie', async () => {
    const world = await visitedPhones();
    const { philippsPhone, annasPhone } = world;

    const visit = onlyVisit(philippsPhone);
    expect(visit).toMatchObject({ kind: 'besuch', seen: false, claimable: false, reward: { type: 'bauplan' } });
    expect(gameCatalog.visitorTemplates.map((template) => template.name)).toContain(visit.visitor.name);
    expect(onlyVisit(annasPhone).stateId).not.toBe(visit.stateId);

    philippsPhone.game.markEventsSeen([visit.stateId]);
    expect(onlyVisit(philippsPhone)).toMatchObject({ seen: true, claimable: false });
    expect(philippsPhone.game.claimEventReward(visit.stateId)).toEqual({ type: 'verboten', reason: 'nicht_erfuellt' });

    philippsPhone.offline();
    buildWish(philippsPhone, 'grundinsel:0:0');
    expect(onlyVisit(philippsPhone).claimable).toBe(true);
    const claimed = philippsPhone.game.claimEventReward(visit.stateId);

    expect(claimed).toEqual({ type: 'abgeholt', reward: expect.objectContaining({ type: 'bauplan', key: visit.reward.key, name: visit.reward.name }) });
    // Vorläufig: Der Wunsch ist weg, der Bauplan sofort freigeschaltet, alles offline.
    expect(openOf(philippsPhone)).toEqual([]);
    expect(islandOf(philippsPhone).unlockedBlueprints).toContain(visit.reward.key);
    expect(philippsPhone.outbox().map((operation) => operation.type)).toEqual(['markEventsSeen', 'buildObject', 'claimEventReward']);

    philippsPhone.online();
    await philippsPhone.sync();
    await annasPhone.sync();

    expect(philippsPhone.outbox()).toEqual([]);
    expect(localRows(philippsPhone, eventRewardId(visit.stateId)).unlock).toMatchObject({ catalogKey: visit.reward.key, reason: 'besucher', serverVersion: expect.any(String) });
    expect(islandOf(annasPhone).unlockedBlueprints).toContain(visit.reward.key);
    // Annas eigener Besuch bleibt offen, Philipps Stand sieht sie nicht.
    expect(onlyVisit(annasPhone).seen).toBe(false);
  });

  it('Bestimmt der Server eine andere Belohnung, ersetzt die kanonische die vorläufige', async () => {
    const world = await visitedPhones();
    const { philippsPhone, backend } = world;
    const visit = onlyVisit(philippsPhone);
    // Auf dem Server sind inzwischen alle Besucher-Baupläne von Bauen freigeschaltet; das Gerät weiß es noch nicht.
    const [island] = await backend.database.db.select().from(blueprintUnlock).limit(1);
    const at = new Date(Date.parse(world.clock.read().instant));
    for (const catalogKey of gameCatalog.blueprints.filter((b) => b.origin === 'besucher' && b.role === 'bauen').map((b) => b.key)) {
      await backend.database.db.insert(blueprintUnlock).values({
        id: randomUUID(), islandId: island!.islandId, couplingId: island!.couplingId, catalogKey, reason: 'besucher', unlockedAt: at, createdAt: at, serverVersion: 1n,
      });
    }
    philippsPhone.offline();
    buildWish(philippsPhone, 'grundinsel:0:0');
    expect(philippsPhone.game.claimEventReward(visit.stateId)).toMatchObject({ type: 'abgeholt', reward: { type: 'bauplan' } });

    philippsPhone.online();
    await philippsPhone.sync();

    const rewardId = eventRewardId(visit.stateId);
    expect(localRows(philippsPhone, rewardId)).toEqual({ unlock: undefined, object: expect.objectContaining({ origin: 'besucher', fieldId: null }) });
    expect(islandOf(philippsPhone).storage).toEqual([expect.objectContaining({ id: rewardId, origin: 'besucher' })]);
  });

  it('Lehnt der Server ab, etwa nach dem Entkoppeln, verschwindet die vorläufige Belohnung', async () => {
    const world = await visitedPhones();
    const { philippsPhone, backend, anna } = world;
    const visit = onlyVisit(philippsPhone);
    philippsPhone.offline();
    buildWish(philippsPhone, 'grundinsel:0:0');
    expect(philippsPhone.game.claimEventReward(visit.stateId)).toMatchObject({ type: 'abgeholt' });
    expect(localRows(philippsPhone, eventRewardId(visit.stateId)).unlock).toBeDefined();

    const couplingId = islandOf(philippsPhone).progress.couplingId;
    await uncoupleAs(backend, { couplingId, requesterPersonId: anna.personId });
    philippsPhone.online();
    await philippsPhone.sync();

    expect(philippsPhone.outbox()).toEqual([]);
    expect(localRows(philippsPhone, eventRewardId(visit.stateId))).toEqual({ unlock: undefined, object: undefined });
  });
});
