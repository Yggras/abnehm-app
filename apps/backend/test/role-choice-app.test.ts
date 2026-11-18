import { describe, expect, it } from 'vitest';

import { coupleByInvitation, worldStart } from './support/coupled-world.ts';
import { gamePhones, proposalOn } from './support/game-phones.ts';
import { uncoupleAs } from './support/shared-actions.ts';

// Nachweis für #180 auf zwei Geräten: der Spieldienst der App (Laichkugel und Rollenwahl) mit Engine,
// Outbox und Adaptern auf echtem SQLite (better-sqlite3) gegen die echte Hono-App mit Postgres.
// Gemeinsame Aktionen sind offline nur vorgemerkt; „Heute“ und „Wir“ folgen den lokalen Daten.

const proposal = proposalOn;
const couple = gamePhones;

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
    expect(philippsPhone.game.proposeRoles('bauen')).toBe('vorgemerkt');
    expect(proposal(philippsPhone)).toMatchObject({ by: 'self', proposerRole: 'bauen', createdAt: null });
    expect(philippsPhone.character()).toEqual({ type: 'empty', reasonKey: 'rollenwahl_gesendet', action: roleChoice });
    expect(philippsPhone.game.proposeRoles('natur')).toBe('nicht_moeglich');
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

    expect(annasPhone.game.withdrawRoles(philippsVorschlag.actionId)).toBe('nicht_moeglich');
    expect(annasPhone.game.declineRoles(philippsVorschlag.actionId)).toBe('vorgemerkt');
    expect(annasPhone.stage()).toMatchObject({ proposal: null });
    expect(annasPhone.wir()).toEqual({ type: 'ready', data: [] });
    expect(annasPhone.game.proposeRoles('natur')).toBe('vorgemerkt');
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
    philippsPhone.game.proposeRoles('bauen');
    await philippsPhone.sync();

    expect(philippsPhone.game.withdrawRoles(proposal(philippsPhone).actionId)).toBe('vorgemerkt');
    expect(philippsPhone.stage()).toMatchObject({ proposal: null });
    await philippsPhone.sync();
    await annasPhone.sync();

    expect(annasPhone.stage()).toMatchObject({ proposal: null });
    expect(annasPhone.game.proposeRoles('bauen')).toBe('vorgemerkt');
  });

  it('gleichzeitige Vorschläge offline: der später eingehende wird abgelehnt und verschwindet samt Vormerkung', async () => {
    const { backend, philipp, anna, philippsPhone, annasPhone } = await couple();
    await coupleByInvitation(backend, philipp.device, anna.device);
    await philippsPhone.sync();
    await annasPhone.sync();
    philippsPhone.offline();
    annasPhone.offline();
    philippsPhone.game.proposeRoles('bauen');
    annasPhone.game.proposeRoles('bauen');

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
    annasPhone.game.proposeRoles('natur');
    await annasPhone.sync();
    await philippsPhone.sync();
    const annasVorschlag = proposal(philippsPhone).actionId;
    // Anna zieht zurück; Philipp weiß das noch nicht, lehnt ab und schlägt selbst vor.
    annasPhone.game.withdrawRoles(annasVorschlag);
    await annasPhone.sync();
    philippsPhone.game.declineRoles(annasVorschlag);
    philippsPhone.game.proposeRoles('bauen');

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
    annasPhone.game.proposeRoles('natur');
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
