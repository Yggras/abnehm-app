import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { challenge } from '../src/db/schema/index.ts';
import { everyDay, testWeeklyPlans, threeSportDays } from './support/challenges.ts';
import { coupleByInvitation, worldStart } from './support/coupled-world.ts';
import { gamePhones, type GamePhone } from './support/game-phones.ts';

// Nachweis für #210 auf zwei Geräten: der Spieldienst der App (Vorschlag, Annahme, Ablehnung, Rückzug und
// Verfall) mit Engine, Outbox und Adaptern auf echtem SQLite (better-sqlite3) gegen die echte Hono-App mit
// Postgres. Server und Geräte lesen die Wochenpläne über denselben `PlanReader`-Fake. Challenge-Befehle
// sind offline nur vorgemerkt; „Wir“ folgt den lokalen Daten.

const hour = 60 * 60 * 1000;

/** Wartet, bis die asynchrone Vorschau des eigenen Anteils ihren Beitrag gemeldet hat. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Philipp und Anna mit je einem Gerät, gekoppelt und auf dem Stand des Servers. Philipp plant jeden Tag alle
 * gezählten Bausteine, Anna Sport an drei Tagen und nie „Ernährung erfasst“; Server und Geräte kennen
 * dieselben Pläne.
 */
async function couple() {
  const plans = testWeeklyPlans();
  const world = await gamePhones({ planReader: plans.planReader, phonePlanReader: plans.reader });
  plans.set(world.philipp.personId, everyDay);
  plans.set(world.anna.personId, threeSportDays);
  await coupleByInvitation(world.backend, world.philipp.device, world.anna.device);
  await world.philippsPhone.sync();
  await world.annasPhone.sync();
  return { ...world, plans };
}

function proposalOn(phone: GamePhone) {
  const stage = phone.challenges();
  if (stage.type !== 'vorschlag') throw new Error(`Kein offener Challenge-Vorschlag: ${JSON.stringify(stage)}`);
  return stage.proposal;
}

const challengeCards = (phone: GamePhone) => {
  const state = phone.wir();
  return state.type === 'ready' ? state.data.filter((contribution) => contribution.type === 'challenge') : [];
};

describe('Challenges App ↔ Backend', () => {
  it('Tracer Bullet: Philipp schlägt „Gut getrunken“ vor, Anna sieht einen antwortbedürftigen Beitrag und nimmt an', async () => {
    const { philippsPhone, annasPhone } = await couple();
    expect(philippsPhone.challenges()).toMatchObject({ type: 'frei', partnerDisplayName: 'Anna' });

    // Offline nur vorgemerkt: Philipp sieht seinen Vorschlag, Anna und „Wir“ noch nichts.
    philippsPhone.offline();
    expect(philippsPhone.game.proposeChallenge('gut_getrunken')).toBe('vorgemerkt');
    expect(proposalOn(philippsPhone)).toMatchObject({ by: 'self', templateKey: 'gut_getrunken', proposedAt: null });
    expect(philippsPhone.game.proposeChallenge('aktive_woche')).toBe('nicht_moeglich');
    expect(philippsPhone.outbox()).toHaveLength(1);
    await settled();
    expect(challengeCards(philippsPhone)).toEqual([]);

    philippsPhone.online();
    await philippsPhone.sync();
    await annasPhone.sync();
    await settled();
    const vorschlag = proposalOn(annasPhone);
    expect(vorschlag).toMatchObject({ by: 'partner', proposedAt: worldStart.instant, expiresAt: '2026-10-16T12:00:00.000Z', accepted: false });
    // Für Anna ein antwortbedürftiger Beitrag mit ihrem eigenen Anteil (jeden Tag Wasserziel: 6), für Philipp „Vorschlag gesendet“.
    expect(challengeCards(annasPhone)).toEqual([
      {
        type: 'challenge',
        id: vorschlag.challengeId,
        dataAsOf: worldStart.instant,
        action: { actionId: 'wir.answer_challenge', target: { type: 'challenge.detail', challengeId: vorschlag.challengeId } },
        challengeId: vorschlag.challengeId,
        templateKey: 'gut_getrunken',
        status: 'vorgeschlagen',
        proposedBySelf: false,
        ownCount: 0,
        ownRequired: 6,
        stage: 'gestartet',
        endsAt: '2026-10-16T12:00:00.000Z',
      },
    ]);
    expect(challengeCards(philippsPhone)).toEqual([expect.objectContaining({ proposedBySelf: true, ownRequired: 6, action: expect.objectContaining({ actionId: 'wir.open_challenge' }) })]);

    // Philipp kann seinen eigenen Vorschlag nicht annehmen, Anna ihn nicht zurückziehen.
    expect(philippsPhone.game.acceptChallenge(vorschlag.challengeId)).toBe('nicht_moeglich');
    expect(annasPhone.game.withdrawChallenge(vorschlag.challengeId)).toBe('nicht_moeglich');

    expect(annasPhone.game.acceptChallenge(vorschlag.challengeId)).toBe('vorgemerkt');
    await settled();
    expect(proposalOn(annasPhone)).toMatchObject({ accepted: true });
    expect(challengeCards(annasPhone)).toEqual([]);
    await annasPhone.sync();
    await philippsPhone.sync();

    expect(annasPhone.challenges()).toMatchObject({ type: 'aktiv', templateKey: 'gut_getrunken', startedAt: worldStart.instant, endsAt: '2026-10-21T12:00:00.000Z', ownRequired: 6 });
    expect(philippsPhone.challenges()).toMatchObject({ type: 'aktiv', challengeId: vorschlag.challengeId, ownRequired: 6 });
    expect(philippsPhone.game.proposeChallenge('aktive_woche')).toBe('nicht_moeglich');
  });

  it('ein zweiter Vorschlag verfällt mit der Testuhr nach 48 Stunden, neutral und ohne Spuren auf „Wir“', async () => {
    const { backend, clock, philippsPhone, annasPhone } = await couple();
    annasPhone.game.proposeChallenge('aktive_woche');
    await annasPhone.sync();
    await philippsPhone.sync();
    const { challengeId } = proposalOn(philippsPhone);

    for (const testClock of [clock, philippsPhone.clock, annasPhone.clock]) testClock.advanceBy(48 * hour);
    // Lokal ist der Vorschlag ab seiner Frist nicht mehr offen, schon vor dem Pull.
    expect(philippsPhone.game.acceptChallenge(challengeId)).toBe('nicht_moeglich');
    await philippsPhone.sync();
    await annasPhone.sync();
    await settled();

    expect(philippsPhone.challenges()).toMatchObject({ type: 'frei' });
    expect(annasPhone.challenges()).toMatchObject({ type: 'frei' });
    expect(challengeCards(philippsPhone)).toEqual([]);
    const [row] = await backend.database.db.select({ status: challenge.status }).from(challenge).where(eq(challenge.id, challengeId));
    expect(row).toEqual({ status: 'verfallen' });
    expect(philippsPhone.game.proposeChallenge('gut_getrunken')).toBe('vorgemerkt');
  });

  it('ablehnen und zurückziehen: der Vorschlag ist sofort weg, danach kann jede Person neu vorschlagen', async () => {
    const { philippsPhone, annasPhone } = await couple();
    philippsPhone.game.proposeChallenge('gut_getrunken');
    await philippsPhone.sync();
    await annasPhone.sync();

    expect(annasPhone.game.declineChallenge(proposalOn(annasPhone).challengeId)).toBe('vorgemerkt');
    expect(annasPhone.challenges()).toMatchObject({ type: 'frei' });
    await annasPhone.sync();
    await philippsPhone.sync();
    expect(philippsPhone.challenges()).toMatchObject({ type: 'frei' });

    expect(annasPhone.game.proposeChallenge('aktive_woche')).toBe('vorgemerkt');
    // Ein nur vorgemerkter Vorschlag lässt sich nicht zurückziehen; erst der bestätigte.
    expect(annasPhone.game.withdrawChallenge(proposalOn(annasPhone).challengeId)).toBe('nicht_moeglich');
    await annasPhone.sync();
    expect(annasPhone.game.withdrawChallenge(proposalOn(annasPhone).challengeId)).toBe('vorgemerkt');
    await annasPhone.sync();
    await philippsPhone.sync();
    expect(philippsPhone.challenges()).toMatchObject({ type: 'frei' });
  });

  it('passt die Vorlage nicht zu Annas Wochenplan, lehnt der Server Philipps Vorschlag ab, und er verschwindet samt Vormerkung', async () => {
    const { backend, philippsPhone, annasPhone } = await couple();

    // Anna sieht die Vorschau selbst: „Ernährung im Blick“ ist bei ihr an keinem Tag geplant.
    expect((await annasPhone.game.challengeShares()).ernaehrung_im_blick).toEqual({ type: 'passt_nicht' });
    expect((await annasPhone.game.challengeShares()).aktive_woche).toEqual({ type: 'passt', required: 3, planned: 3 });
    // Philipp kennt Annas Plan nicht; erst der Server lehnt ab.
    expect(philippsPhone.game.proposeChallenge('ernaehrung_im_blick')).toBe('vorgemerkt');
    await philippsPhone.sync();

    expect(philippsPhone.outbox()).toEqual([]);
    // Den Grund nennt der Server; das Gerät merkt sich die Vorlage für heute und zeigt den Hinweis.
    expect(philippsPhone.challenges()).toMatchObject({ type: 'frei', unfitToday: ['ernaehrung_im_blick'] });
    expect(await backend.database.db.select().from(challenge)).toEqual([]);
    await annasPhone.sync();
    expect(annasPhone.challenges()).toMatchObject({ type: 'frei' });
  });
});
