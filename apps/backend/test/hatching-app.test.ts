import { describe, expect, it } from 'vitest';

import { gameCatalog } from '@abnehm/game-rules/content';

import { coupleByInvitation, worldStart } from './support/coupled-world.ts';
import { gamePhones, proposalOn } from './support/game-phones.ts';

// Nachweis für #184 auf zwei Geräten: Philipp nimmt Annas Rollenwahl an, Momo schlüpft. Der Spieldienst der
// App (Engine, Outbox und Adapter auf echtem SQLite) läuft gegen die echte Hono-App mit Postgres. Die
// Annahme ist offline nur vorgemerkt; Insel, Felder, Freischaltungen, Ereignis und Inselfortschritt kommen
// erst mit dem Sync (Spezifikation 4, Abschnitt 11).

const kaulquappe = { stage: 'geschluepft', formKey: 'kaulquappe', moodKey: 'zufrieden', accessories: { kopf: null, hals: null } };

/** Anna hat Natur vorgeschlagen; beide Geräte kennen den Vorschlag. */
async function roleChoiceOpen() {
  const world = await gamePhones();
  await coupleByInvitation(world.backend, world.philipp.device, world.anna.device);
  await world.annasPhone.sync();
  expect(world.annasPhone.game.proposeRoles('natur')).toBe('vorgemerkt');
  await world.annasPhone.sync();
  await world.philippsPhone.sync();
  return { ...world, actionId: proposalOn(world.philippsPhone).actionId };
}

describe('Schlüpfen App ↔ Backend', () => {
  it('Tracer Bullet: annehmen ist vorgemerkt bis zum Sync, danach zeigen beide Geräte die geschlüpfte Insel, Momo auf „Heute“ und das Ereignis auf „Wir“', async () => {
    const { philipp, anna, philippsPhone, annasPhone, actionId } = await roleChoiceOpen();

    philippsPhone.offline();
    expect(philippsPhone.game.acceptRoles(actionId)).toBe('vorgemerkt');
    // Nur vorgemerkt: Momo wartet noch im Ei, aber der Vorschlag ist angenommen, und „Wir“ fragt nicht mehr.
    expect(philippsPhone.stage()).toMatchObject({ type: 'rollenwahl', proposal: { actionId, by: 'partner', accepted: true } });
    expect(philippsPhone.wir()).toEqual({ type: 'ready', data: [] });
    expect(philippsPhone.game.declineRoles(actionId)).toBe('nicht_moeglich');
    expect(philippsPhone.game.proposeRoles('bauen')).toBe('nicht_moeglich');

    philippsPhone.online();
    await philippsPhone.sync();
    await annasPhone.sync();

    for (const [phone, self, partner, partnerName, ownRole] of [
      [philippsPhone, philipp, anna, 'Anna', 'bauen'],
      [annasPhone, anna, philipp, 'Philipp', 'natur'],
    ] as const) {
      const stage = phone.stage();
      if (stage.type !== 'geschluepft' || stage.island === null) throw new Error(`Nicht geschlüpft: ${JSON.stringify(stage)}`);
      const { island } = stage;
      expect(island).toMatchObject({ viewerPersonId: self.personId, partnerPersonId: partner.personId, partnerDisplayName: partnerName, ownRole, energy: 0 });
      expect(island.progress).toMatchObject({ level: 1, levelNeed: 11, activeProject: { templateKey: gameCatalog.projects[0]!.key, sequenceNumber: 1, stage: 'gestartet' } });
      expect(island.fields).toHaveLength(16 * 12);
      // Seite a gehört Philipp (Bauen), Seite b Anna (Natur).
      expect(island.fields.find((field) => field.key === 'grundinsel:0:0')?.ownerPersonId).toBe(philipp.personId);
      expect(island.fields.find((field) => field.key === 'grundinsel:15:0')?.ownerPersonId).toBe(anna.personId);
      expect(island.unlockedAreas).toEqual([]);
      expect(island.appearance).toEqual(kaulquappe);

      expect(phone.character()).toEqual({
        type: 'ready',
        data: { appearance: kaulquappe, energy: 0, level: 1, ownHalfPercent: 0, partnerHalfPercent: 0, waitingForPartner: false },
      });
      expect(phone.wir()).toEqual({
        type: 'ready',
        data: [
          {
            type: 'shared_event',
            id: expect.any(String),
            dataAsOf: worldStart.instant,
            action: { actionId: 'wir.open_island', target: { type: 'momo' } },
            eventId: expect.any(String),
            eventType: 'momo_geschluepft',
            occurredAt: worldStart.instant,
            messageKey: 'neu_bei_euch.momo_geschluepft',
            objectId: island.islandId,
          },
        ],
      });
    }
    expect(philippsPhone.outbox()).toEqual([]);
  });

  it('eine Person entscheidet nur einmal: nach vorgemerktem Ablehnen ist Annehmen nicht möglich', async () => {
    const { philippsPhone, actionId } = await roleChoiceOpen();

    philippsPhone.offline();
    expect(philippsPhone.game.declineRoles(actionId)).toBe('vorgemerkt');
    expect(philippsPhone.game.acceptRoles(actionId)).toBe('nicht_moeglich');
  });

  it('ohne Netz bleibt die Annahme vorgemerkt; Anna sieht weiter „Vorschlag gesendet“', async () => {
    const { philippsPhone, annasPhone, actionId } = await roleChoiceOpen();

    philippsPhone.offline();
    philippsPhone.game.acceptRoles(actionId);
    await annasPhone.sync();

    expect(annasPhone.stage()).toMatchObject({ type: 'rollenwahl', proposal: { by: 'self', accepted: false } });
    expect(annasPhone.character()).toMatchObject({ reasonKey: 'rollenwahl_gesendet' });
  });
});
