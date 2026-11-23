import { describe, expect, it } from 'vitest';

import { EntityId } from '@abnehm/contracts/base';

import { projectContribution as localContribution } from '../../mobile/src/local-db/schema/index.ts';
import { sqliteOf } from '../../mobile/src/local-db/sqlite.ts';
import { defaultPassword, newDevice, signIn } from './support/auth-client.ts';
import { earnEnergy } from './support/building.ts';
import { worldToday } from './support/coupled-world.ts';
import { energize, gamePhone, hatchedPhones, islandOf, type GamePhone } from './support/game-phones.ts';
import { contributionsOf } from './support/projects.ts';

// Nachweis für #208 auf echten Geräten: Einzahlen im Spieldienst der App (Engine, Outbox und Adapter auf echtem
// SQLite) gegen die echte Hono-App mit Postgres (Spezifikation 4, Testnaht 3). Anna hat Natur, Philipp Bauen;
// Projekt 1 ist das Gartenhäuschen mit je 20 Bedarf.

const sixDays = [worldToday, '2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09'] as const;

const projectOf = (phone: GamePhone) => islandOf(phone).project;
const contributionsOn = (phone: GamePhone) => phone.database.read((tx) => sqliteOf(tx).select().from(localContribution).all());

/** Beide haben 24 Energie aus sechs Tagen; ihre Geräte kennen sie. */
async function fundedPhones() {
  const world = await hatchedPhones();
  // Philipps zweites Gerät; es muss seine Tagesziele kennen, bevor die Erfüllungen per Pull kommen.
  const second = (await signIn(world.backend, 'philipp@example.test', defaultPassword, newDevice())).device;
  const ipad = await gamePhone(world.backend, world.philipp.accountId, second);
  await ipad.sync();
  await energize(world, sixDays, [world.philippsPhone, ipad]);
  const goals = await earnEnergy(world.backend, world.anna, sixDays);
  world.annasPhone.materialize(goals);
  await world.annasPhone.sync();
  return { ...world, ipad };
}

describe('Gemeinschaftsprojekte App ↔ Backend', { timeout: 60_000 }, () => {
  it('Tracer Bullet: beide zahlen ein, das Wahrzeichen steht, und Projekt 2 beginnt', async () => {
    const world = await fundedPhones();
    const { philippsPhone, annasPhone } = world;
    const first = projectOf(philippsPhone);
    expect(first).toMatchObject({ templateKey: 'gartenhaeuschen', kind: 'projekt', name: 'Gartenhäuschen', ownRole: 'bauen', own: { paid: 0, need: 20 }, contribution: { type: 'moeglich', max: 20 }, stage: 'gestartet' });

    // Offline: Der eigene Anteil und die eigene Hälfte wachsen sofort.
    philippsPhone.offline();
    expect(philippsPhone.game.contribute({ projectId: first.projectId, amount: 12 })).toEqual({ type: 'eingezahlt', amount: 12 });
    expect(islandOf(philippsPhone)).toMatchObject({ energy: 12, project: { own: { paid: 12, need: 20 } }, halves: { own: { halfPercent: 100 } } });
    expect(philippsPhone.outbox().map((operation) => operation.type)).toEqual(['contributeToProject']);
    // Mehr als der Restbedarf geht nicht: gekürzt auf 8.
    expect(philippsPhone.game.contribute({ projectId: first.projectId, amount: 12 })).toEqual({ type: 'eingezahlt', amount: 8 });
    expect(projectOf(philippsPhone).own).toEqual({ paid: 20, need: 20 });
    expect(philippsPhone.game.contribute({ projectId: first.projectId, amount: 1 })).toEqual({ type: 'verboten', reason: 'anteil_voll' });

    philippsPhone.online();
    await philippsPhone.sync();
    await annasPhone.sync();
    // Der gemeinsame Stand kommt nur als Stufe; Anna sieht ihren eigenen Anteil, nie Philipps.
    expect(projectOf(annasPhone)).toMatchObject({ ownRole: 'natur', own: { paid: 0, need: 20 }, stage: 'gut_unterwegs' });

    expect(annasPhone.game.contribute({ projectId: first.projectId, amount: 20 })).toEqual({ type: 'eingezahlt', amount: 20 });
    // Der Abschluss ist erst nach dem Sync sichtbar.
    expect(projectOf(annasPhone)).toMatchObject({ projectId: first.projectId, own: { paid: 20, need: 20 } });
    expect(islandOf(annasPhone).landmarks).toEqual([]);
    await annasPhone.sync();
    await philippsPhone.sync();

    for (const phone of [annasPhone, philippsPhone]) {
      const island = islandOf(phone);
      expect(island.project).toMatchObject({ templateKey: 'gartenhaeuschen_ausbau', kind: 'ausbau', name: 'Gartenhäuschen-Ausbau', own: { paid: 0, need: 30 }, stage: 'gestartet', site: 'grundinsel:7:2' });
      expect(island.landmarks).toEqual([{ projectKey: 'gartenhaeuschen', site: 'grundinsel:7:2', art: 'gartenhaeuschen', size: 1 }]);
      expect(island.sharedEvents.map((event) => event.type)).toContain('projektabschluss');
    }
    // „Wir“: das neue Projekt mit eigenem Stand und das gemeinsame Ereignis.
    const wir = philippsPhone.wir();
    if (wir.type !== 'ready') throw new Error(JSON.stringify(wir));
    expect(wir.data.find((contribution) => contribution.type === 'community_project')).toMatchObject({
      projectId: islandOf(philippsPhone).project.projectId, templateKey: 'gartenhaeuschen_ausbau', ownRole: 'bauen', ownCount: 0, ownRequired: 30, stage: 'gestartet',
      action: { target: { type: 'momo', view: 'projekt' } },
    });
    expect(wir.data.find((contribution) => contribution.type === 'shared_event' && contribution.eventType === 'projektabschluss')).toBeDefined();
  });

  it('das Gerät zahlt nur aus dem angezeigten Bestand ein', async () => {
    const world = await hatchedPhones();
    await energize(world, [worldToday]);
    const { projectId } = projectOf(world.philippsPhone);
    expect(world.philippsPhone.game.contribute({ projectId, amount: 5 })).toEqual({ type: 'verboten', reason: 'zu_wenig_energie', price: 5, missing: 1 });
    expect(world.philippsPhone.outbox()).toEqual([]);
  });

  it('zwei eigene Geräte zahlen offline denselben Rest ein: Der Server kürzt, beide Geräte übernehmen es', async () => {
    const world = await fundedPhones();
    const { ipad } = world;
    const iphone = world.philippsPhone;
    const { projectId } = projectOf(iphone);
    iphone.offline();
    ipad.offline();
    expect(iphone.game.contribute({ projectId, amount: 15 })).toEqual({ type: 'eingezahlt', amount: 15 });
    expect(ipad.game.contribute({ projectId, amount: 15 })).toEqual({ type: 'eingezahlt', amount: 15 });

    iphone.online();
    ipad.online();
    await iphone.sync();
    await ipad.sync();
    await iphone.sync();

    expect((await contributionsOf(world)).map((row) => row.amount)).toEqual([15, 5]);
    for (const phone of [iphone, ipad]) {
      expect(contributionsOn(phone).map((row) => row.amount).sort((a, b) => a - b)).toEqual([5, 15]);
      expect(islandOf(phone)).toMatchObject({ energy: 4, project: { own: { paid: 20, need: 20 } } });
    }
  });

  it('eine dauerhaft abgelehnte Einzahlung verschwindet samt Buchung', async () => {
    const world = await fundedPhones();
    const { ipad } = world;
    const iphone = world.philippsPhone;
    const { projectId } = projectOf(iphone);
    expect(ipad.game.contribute({ projectId, amount: 20 })).toEqual({ type: 'eingezahlt', amount: 20 });
    await ipad.sync();

    // Das iPhone weiß noch nichts davon und zahlt offline ein; der Server lehnt den vollen Anteil ab.
    iphone.offline();
    expect(iphone.game.contribute({ projectId, amount: 3 })).toEqual({ type: 'eingezahlt', amount: 3 });
    expect(islandOf(iphone).energy).toBe(21);
    iphone.online();
    await iphone.sync();

    expect(iphone.outbox()).toEqual([]);
    expect(contributionsOn(iphone).map((row) => [row.amount, row.serverVersion !== null])).toEqual([[20, true]]);
    expect(islandOf(iphone)).toMatchObject({ energy: 4, project: { own: { paid: 20, need: 20 } } });
    expect((await contributionsOf(world)).map((row) => EntityId.parse(row.id))).toHaveLength(1);
  });
});
