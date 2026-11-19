import { act, screen, userEvent, within } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { contractFixtures } from '@abnehm/contracts/fixtures';
import { DecideChallengeProposal, ProposeChallenge, WithdrawChallengeProposal } from '@abnehm/contracts/island';
import { WirContributionsState } from '@abnehm/contracts/wir';

import { ClockProvider } from '../clock/clock-context';
import { hitArea } from '../design/testing/hit-area';
import { routeScreen } from '../navigation';
import { MessageHostProvider, MessageSlot } from '../shell/MessageHost';
import { appGameService } from './app-game-service';
import { removeOperation } from '../sync/outbox';
import { ChallengeDetailScreen } from './ChallengeDetailScreen';
import { challengeLocalCommands } from './challenges';
import { ChallengeProposeScreen } from './ChallengeProposeScreen';
import { threeSportDaysPlan, weeklyPlanReader } from './testing/challenge-plans';
import { createLaichkugelWorld, type LaichkugelWorld, type LaichkugelWorldOptions } from './testing/laichkugel-world';

// Nachweis für #210: Bildschirm `challenge.propose` mit vier Vorlagenkarten, eigenem Anteil als Vorschau und
// nicht passenden Vorlagen samt Grund, die Vorschlagsansicht von `challenge.detail` sowie
// `WirContribution.challenge` gegen die Vertrags-Fixtures. Echter Spieldienst auf echter SQLite; den
// Wochenplan liefert der `PlanReader`-Fake aus #104.

const user = userEvent.setup();
const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Wartet, bis die asynchrone Vorschau aus dem `PlanReader` angekommen ist; sie braucht einige Mikroaufgaben. */
async function settled() {
  for (let round = 0; round < 5; round++) await act(async () => {});
}

async function world(options: LaichkugelWorldOptions = {}, arrange: (world: LaichkugelWorld) => void = (opened) => opened.couple()) {
  const opened = await createLaichkugelWorld(clock, options);
  cleanups.push(() => opened.close());
  arrange(opened);
  return opened;
}

async function open(initialUrl: string, opened: LaichkugelWorld) {
  cleanups.push(appGameService.opened(opened.game));
  const Layout = () => (
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <Slot />
      </MessageHostProvider>
    </ClockProvider>
  );
  await renderRouter(
    {
      _layout: Layout,
      // Der Aufrufer zeigt die Meldung des Meldungs-Hosts, wie „Heute“ oder der Tab „Momo“.
      index: MessageSlot,
      'challenge/propose': routeScreen('challenge.propose', ChallengeProposeScreen),
      'challenge/detail': routeScreen('challenge.detail', ChallengeDetailScreen),
    },
    { initialUrl },
  );
  await settled();
}

const card = (key: string) => within(screen.getByTestId(`challenge-vorlage-${key}`));
const tooSmall = () => screen.getAllByRole('button').map(hitArea).filter((area) => area.width < 48 || area.height < 48);
const payloads = (opened: LaichkugelWorld) => opened.operations().map((operation) => ({ type: operation.type, payload: 'payload' in operation ? operation.payload : null }));

describe('challenge.propose', () => {
  test('vier Vorlagenkarten mit Erklärung und eigenem Anteil; ein Tipp schlägt vor, schließt und bestätigt', async () => {
    const opened = await world();
    await open('/challenge/propose', opened);

    expect(screen.getByRole('header', { name: 'Challenge vorschlagen' })).toBeOnTheScreen();
    expect(screen.getByText('Sieben Tage, gemeinsam mit Anna. Jede Person erfüllt ihren eigenen Anteil.')).toBeOnTheScreen();
    expect(screen.getAllByRole('header').map((header) => header.props.children)).toEqual(
      expect.arrayContaining(['Gemeinsam dranbleiben', 'Ernährung im Blick', 'Gut getrunken', 'Aktive Woche']),
    );
    expect(card('gemeinsam_dranbleiben').getByText('Jedes erfüllte Tagesziel zählt, egal welches.')).toBeOnTheScreen();
    expect(card('gemeinsam_dranbleiben').getByText('Dein Anteil: 17 von 21 Tageszielen')).toBeOnTheScreen();
    expect(card('ernaehrung_im_blick').getByText('Dein Anteil: 6 von 7 Tagen mit „Ernährung erfasst“')).toBeOnTheScreen();
    expect(card('gut_getrunken').getByText('Dein Anteil: 6 von 7 Tagen mit „Wasserziel“')).toBeOnTheScreen();
    expect(card('aktive_woche').getByText('Dein Anteil: 6 von 7 geplanten Sporteinheiten')).toBeOnTheScreen();
    expect(tooSmall()).toEqual([]);

    await user.press(screen.getByRole('button', { name: 'Gut getrunken vorschlagen' }));

    expect(screen).toHavePathname('/');
    expect(await screen.findByText('Dein Vorschlag ist auf dem Weg zu Anna')).toBeOnTheScreen();
    expect(payloads(opened)).toEqual([{ type: 'proposeChallenge', payload: expect.objectContaining({ templateKey: 'gut_getrunken' }) }]);
    expect(ProposeChallenge.safeParse(payloads(opened)[0]!.payload).success).toBe(true);
  });

  test('eine Vorlage ohne geplanten Tag ist ohne „Vorschlagen“ und nennt den Grund', async () => {
    const opened = await world({ planReader: weeklyPlanReader(threeSportDaysPlan) });
    await open('/challenge/propose', opened);

    expect(card('ernaehrung_im_blick').getByText('Passt gerade nicht zu euren Wochenplänen')).toBeOnTheScreen();
    expect(card('ernaehrung_im_blick').queryByRole('button')).toBeNull();
    expect(card('aktive_woche').getByText('Dein Anteil: 3 von 3 geplanten Sporteinheiten')).toBeOnTheScreen();
    expect(card('aktive_woche').getByRole('button', { name: 'Aktive Woche vorschlagen' })).toBeOnTheScreen();
  });

  test('hat der Server einen Vorschlag heute als unpassend abgelehnt, nennt der Bildschirm den Grund und bietet die Vorlage nicht an', async () => {
    const opened = await world();
    // Wie die Sync-Engine nach der Ablehnung durch den Server (Plan des Partners, Kontext `passt_nicht`).
    opened.game.proposeChallenge('ernaehrung_im_blick');
    const [operation] = opened.operations();
    opened.database.transaction((tx) => {
      const command = challengeLocalCommands.find((candidate) => candidate.type === 'proposeChallenge')!;
      if (!operation || !('businessKey' in operation)) throw new Error('Vorschlag fehlt in der Outbox');
      command.reconcileRejected(tx, operation, {
        type: 'permanently_rejected', operationId: operation.operationId,
        error: { code: 'conflict', context: { grund: 'passt_nicht' }, retryable: false },
        canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId },
      });
      removeOperation(tx, operation.operationId);
    });
    await open('/challenge/propose', opened);

    expect(screen.getByText('„Ernährung im Blick“ passt gerade nicht zu euren Wochenplänen.')).toBeOnTheScreen();
    expect(card('ernaehrung_im_blick').getByText('Dein Anteil: 6 von 7 Tagen mit „Ernährung erfasst“')).toBeOnTheScreen();
    expect(card('ernaehrung_im_blick').getByText('Passt gerade nicht zu euren Wochenplänen')).toBeOnTheScreen();
    expect(card('ernaehrung_im_blick').queryByRole('button')).toBeNull();
    expect(card('gut_getrunken').getByRole('button', { name: 'Gut getrunken vorschlagen' })).toBeOnTheScreen();
  });

  test('ohne Kopplung gibt es nichts vorzuschlagen', async () => {
    const opened = await world({}, () => {});
    await open('/challenge/propose', opened);

    expect(screen.getByText('Challenges startet ihr zu zweit. Sobald ihr gekoppelt seid, kannst du eine vorschlagen.')).toBeOnTheScreen();
    expect(screen.queryByText('Vorschlagen')).toBeNull();
  });

  test('ist schon ein Vorschlag offen, führt der Bildschirm zu ihm', async () => {
    const opened = await world();
    const challengeId = opened.challengeOnServer('anna', 'aktive_woche');
    await open('/challenge/propose', opened);

    expect(screen.getByText('Gerade ist schon ein Vorschlag offen.')).toBeOnTheScreen();
    await user.press(screen.getByRole('button', { name: 'Ansehen' }));
    expect(screen).toHavePathname('/challenge/detail');
    expect(screen).toHaveSearchParams({ challengeId });
  });
});

describe('challenge.detail: offener Vorschlag', () => {
  test('Annas Vorschlag: Philipp sieht Vorlage, eigenen Anteil und Frist und nimmt an', async () => {
    const opened = await world();
    const challengeId = opened.challengeOnServer('anna', 'gut_getrunken');
    await open(`/challenge/detail?challengeId=${challengeId}`, opened);

    const vorschlag = within(screen.getByTestId('challenge-vorschlag'));
    expect(vorschlag.getByText('Anna schlägt vor')).toBeOnTheScreen();
    expect(vorschlag.getByRole('header', { name: 'Gut getrunken' })).toBeOnTheScreen();
    expect(vorschlag.getByText('Dein Anteil: 6 von 7 Tagen mit „Wasserziel“')).toBeOnTheScreen();
    // Verfall am 16.10. um 12:00 UTC, in Berlin Freitag 14:00 Uhr.
    expect(vorschlag.getByText('Gilt bis Freitag, 14:00 Uhr.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Zurückziehen' })).toBeNull();
    expect(tooSmall()).toEqual([]);

    await user.press(screen.getByRole('button', { name: 'Annehmen' }));

    expect(screen.getByText('Angenommen. Die Challenge startet, sobald du online bist.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Annehmen' })).toBeNull();
    expect(payloads(opened)).toEqual([{ type: 'decideChallengeProposal', payload: DecideChallengeProposal.parse({ challengeId, decision: 'annehmen' }) }]);
  });

  test('Ablehnen ist neutral: der Vorschlag ist sofort weg', async () => {
    const opened = await world();
    const challengeId = opened.challengeOnServer('anna', 'gut_getrunken');
    await open(`/challenge/detail?challengeId=${challengeId}`, opened);

    await user.press(screen.getByRole('button', { name: 'Ablehnen' }));

    expect(screen.getByText('Dieser Vorschlag ist nicht mehr offen.')).toBeOnTheScreen();
    expect(payloads(opened)).toEqual([{ type: 'decideChallengeProposal', payload: { challengeId, decision: 'ablehnen' } }]);
  });

  test('eigener Vorschlag: neutral „Vorschlag gesendet“, Anna entscheidet; Zurückziehen', async () => {
    const opened = await world();
    const challengeId = opened.challengeOnServer('philipp', 'aktive_woche');
    await open(`/challenge/detail?challengeId=${challengeId}`, opened);

    const vorschlag = within(screen.getByTestId('challenge-vorschlag'));
    expect(vorschlag.getByText('Vorschlag gesendet')).toBeOnTheScreen();
    expect(vorschlag.getByText('Anna entscheidet. Gilt bis Freitag, 14:00 Uhr.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Annehmen' })).toBeNull();

    await user.press(screen.getByRole('button', { name: 'Zurückziehen' }));

    expect(payloads(opened)).toEqual([{ type: 'withdrawChallengeProposal', payload: WithdrawChallengeProposal.parse({ challengeId }) }]);
    expect(screen.getByText('Dieser Vorschlag ist nicht mehr offen.')).toBeOnTheScreen();
  });

  test('lehnt der Server die Annahme ab, weil der Plan des Partners nicht passt, nennt die Seite den Grund und bietet nur „Ablehnen“', async () => {
    const opened = await world();
    const challengeId = opened.challengeOnServer('anna', 'gut_getrunken');
    opened.game.acceptChallenge(challengeId);
    const [operation] = opened.operations();
    opened.database.transaction((tx) => {
      const command = challengeLocalCommands.find((candidate) => candidate.type === 'decideChallengeProposal')!;
      if (!operation || !('businessKey' in operation)) throw new Error('Annahme fehlt in der Outbox');
      command.reconcileRejected(tx, operation, {
        type: 'permanently_rejected', operationId: operation.operationId,
        error: { code: 'conflict', context: { grund: 'passt_nicht' }, retryable: false },
        canonical: { type: 'absent', entityType: 'command_result', entityId: operation.operationId },
      });
      removeOperation(tx, operation.operationId);
    });
    await open(`/challenge/detail?challengeId=${challengeId}`, opened);

    expect(screen.getByText('Passt gerade nicht zu euren Wochenplänen')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Annehmen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeOnTheScreen();
  });

  test('passt die Vorlage nicht mehr zum eigenen Plan, bleibt nur „Ablehnen“', async () => {
    const opened = await world({ planReader: weeklyPlanReader(threeSportDaysPlan) });
    const challengeId = opened.challengeOnServer('anna', 'ernaehrung_im_blick');
    await open(`/challenge/detail?challengeId=${challengeId}`, opened);

    expect(screen.getByText('Passt gerade nicht zu euren Wochenplänen')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Annehmen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ablehnen' })).toBeOnTheScreen();
  });
});

describe('WirContribution.challenge gegen die Vertrags-Fixtures', () => {
  const fixture = contractFixtures.wir!.WirContribution!.valid['fremder Challenge-Vorschlag'] as Record<string, unknown>;

  async function contributionsOf(opened: LaichkugelWorld) {
    const states: unknown[] = [];
    cleanups.push(opened.game.wirContributions.subscribe((state) => states.push(state)));
    await settled();
    return states;
  }

  test('Annas Vorschlag ist für Philipp antwortbedürftig, mit eigenem Stand und Bedarf und Aktion `challenge.detail`', async () => {
    const opened = await world();
    const challengeId = opened.challengeOnServer('anna', 'gut_getrunken');
    const states = await contributionsOf(opened);

    expect(WirContributionsState.parse(states.at(-1))).toEqual({
      type: 'ready',
      data: [
        {
          ...fixture,
          id: challengeId,
          challengeId,
          dataAsOf: '2026-10-14T12:00:00.000Z',
          action: { actionId: 'wir.answer_challenge', target: { type: 'challenge.detail', challengeId } },
        },
      ],
    });
  });

  test('der eigene Vorschlag erscheint neutral mit `proposedBySelf`; nach der eigenen Annahme verschwindet ein fremder', async () => {
    const opened = await world();
    const own = opened.challengeOnServer('philipp', 'gut_getrunken');
    const states = await contributionsOf(opened);
    expect(WirContributionsState.parse(states.at(-1))).toMatchObject({ type: 'ready', data: [{ challengeId: own, proposedBySelf: true, ownRequired: 6 }] });

    const other = await world();
    const annas = other.challengeOnServer('anna', 'gut_getrunken');
    const otherStates = await contributionsOf(other);
    other.game.acceptChallenge(annas);
    await settled();
    expect(otherStates.at(-1)).toEqual({ type: 'ready', data: [] });
  });

  test('ein nur vorgemerkter eigener Vorschlag zeigt nichts', async () => {
    const pending = await world();
    pending.game.proposeChallenge('gut_getrunken');
    expect((await contributionsOf(pending)).at(-1)).toEqual({ type: 'ready', data: [] });
  });

  test('passt der Vorschlag nicht mehr zum eigenen Plan, bleibt er antwortbedürftig, mit dem Anteil bei vollem Plan als Richtwert', async () => {
    const unfit = await world({ planReader: weeklyPlanReader(threeSportDaysPlan) });
    const challengeId = unfit.challengeOnServer('anna', 'ernaehrung_im_blick');
    expect(WirContributionsState.parse((await contributionsOf(unfit)).at(-1))).toMatchObject({
      type: 'ready',
      data: [{ challengeId, templateKey: 'ernaehrung_im_blick', proposedBySelf: false, ownRequired: 6 }],
    });
  });
});
