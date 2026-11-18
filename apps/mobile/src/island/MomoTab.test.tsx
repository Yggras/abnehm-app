import { act, screen, userEvent } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';
import { contractFixtures } from '@abnehm/contracts/fixtures';
import { DecideSharedAction, RequestSharedAction } from '@abnehm/contracts/island';
import { MomoCharacterState } from '@abnehm/contracts/today';
import { WirContributionsState } from '@abnehm/contracts/wir';

import { ClockProvider } from '../clock/clock-context';
import { hitArea } from '../design/testing/hit-area';
import { routeScreen } from '../navigation';
import { MessageHostProvider } from '../shell/MessageHost';
import { placeholderRoute } from '../shell/Placeholder';
import { appGameService } from './app-game-service';
import { momoCharacterOf, wirContributionsOf } from './game-service';
import { MomoTab } from './MomoTab';
import { createLaichkugelWorld, islandId, type LaichkugelWorld } from './testing/laichkugel-world';

// Nachweis für #180: Tab „Momo“ mit Laichkugel und Ansicht `rollenwahl` über den Spieldienst des
// geöffneten Kontos (`appGameService`) auf echter SQLite, dazu `momo.character` und die Beiträge an „Wir“
// gegen die Vertrags-Fixtures.

const user = userEvent.setup();
const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function open(arrange: (world: LaichkugelWorld) => void = () => {}) {
  const world = await createLaichkugelWorld(clock);
  cleanups.push(() => world.close());
  arrange(world);
  cleanups.push(appGameService.opened(world.game));
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
      index: () => null,
      momo: routeScreen('momo', MomoTab),
      'partner/invite': placeholderRoute('partner.invite'),
      'partner/redeem': placeholderRoute('partner.redeem'),
    },
    { initialUrl: '/momo' },
  );
  return world;
}

const requests = (world: LaichkugelWorld) => world.operations().map((operation) => ('payload' in operation ? operation.payload : null));
const tooSmall = () => screen.getAllByRole('button').map(hitArea).filter((area) => area.width < 48 || area.height < 48);

describe('Laichkugel', () => {
  test('ohne Kopplung: Momo wartet im Ei, die gesammelte Energie bleibt; Einladen und Code eingeben öffnen Spezifikation 5', async () => {
    await open((world) => world.credit(3));

    expect(screen.getByRole('image', { name: 'Momo wartet im Ei' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Momo wartet im Ei' })).toBeOnTheScreen();
    expect(screen.getByLabelText('3 Energie gesammelt')).toBeOnTheScreen();
    expect(tooSmall()).toEqual([]);

    await user.press(screen.getByRole('button', { name: 'Partner einladen' }));
    expect(screen).toHavePathname('/partner/invite');
    expect(screen.getByRole('header', { name: 'Partner einladen' })).toBeOnTheScreen();
    await act(() => router.back());
    await user.press(screen.getByRole('button', { name: 'Code eingeben' }));
    expect(screen).toHavePathname('/partner/redeem');
  });

  test('ohne gesammelte Energie steht keine Energiezeile da', async () => {
    await open();
    expect(screen.queryByText(/Energie gesammelt/)).toBeNull();
  });
});

describe('Ansicht rollenwahl', () => {
  test('Tracer Bullet: eigene Rolle wählen und vorschlagen; danach „Vorschlag gesendet“ mit Zurückziehen', async () => {
    const world = await open((w) => w.couple());

    expect(screen.getByRole('header', { name: 'Momo schlüpft, sobald ihr die Rollen verteilt habt' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Vorschlag an Anna senden' })).toBeDisabled();
    // Was die Rollen bedeuten, steht schon vor der Wahl da (Impeccable-Prüfung von #180).
    expect(screen.getByText('Bauen: Häuser, Wege und Brücken')).toBeOnTheScreen();
    expect(screen.getByText('Natur: Pflanzen, Bäume und Tiere')).toBeOnTheScreen();
    await user.press(screen.getByRole('radio', { name: 'Bauen: Häuser, Wege und Brücken' }));
    expect(screen.getByRole('radio', { name: 'Bauen: Häuser, Wege und Brücken' })).toBeChecked();
    expect(screen.getByText('Du: Bauen · Anna: Natur')).toBeOnTheScreen();
    expect(tooSmall()).toEqual([]);
    await user.press(screen.getByRole('button', { name: 'Vorschlag an Anna senden' }));

    expect(screen.getByRole('header', { name: 'Vorschlag gesendet' })).toBeOnTheScreen();
    expect(screen.getByText('Du: Bauen · Anna: Natur')).toBeOnTheScreen();
    const [request] = requests(world).map((payload) => RequestSharedAction.parse(payload));
    expect(request).toMatchObject({ type: 'rollenwahl', payload: { proposerRole: 'bauen' } });

    await user.press(screen.getByRole('button', { name: 'Vorschlag zurückziehen' }));
    expect(DecideSharedAction.parse(requests(world)[1])).toMatchObject({ actionId: request!.actionId, decision: 'zurueckziehen', timeZone: 'Europe/Berlin' });
    expect(screen.getByRole('header', { name: 'Welche Rolle übernimmst du?' })).toBeOnTheScreen();
  });

  test('Vorschlag des Partners sehen und ablehnen; danach selbst vorschlagen', async () => {
    let actionId = '';
    const world = await open((w) => {
      w.couple();
      actionId = w.proposeOnServer('anna', 'natur');
    });

    expect(screen.getByRole('header', { name: 'Anna schlägt eure Rollen vor' })).toBeOnTheScreen();
    expect(screen.getByText('Du: Bauen · Anna: Natur')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Vorschlag zurückziehen' })).toBeNull();
    await user.press(screen.getByRole('button', { name: 'Ablehnen' }));

    expect(DecideSharedAction.parse(requests(world)[0])).toMatchObject({ actionId, decision: 'ablehnen' });
    await user.press(screen.getByRole('radio', { name: 'Natur: Pflanzen, Bäume und Tiere' }));
    await user.press(screen.getByRole('button', { name: 'Vorschlag an Anna senden' }));
    expect(screen.getByRole('header', { name: 'Vorschlag gesendet' })).toBeOnTheScreen();
    expect(screen.getByText('Du: Natur · Anna: Bauen')).toBeOnTheScreen();
  });

  test('Vorschlag des Partners annehmen: vorgemerkt, bis der Sync Momo schlüpfen lässt (#184)', async () => {
    let actionId = '';
    const world = await open((w) => {
      w.couple();
      actionId = w.proposeOnServer('anna', 'natur');
    });
    expect(tooSmall()).toEqual([]);

    await user.press(screen.getByRole('button', { name: 'Annehmen' }));

    expect(DecideSharedAction.parse(requests(world)[0])).toMatchObject({ actionId, decision: 'annehmen', timeZone: 'Europe/Berlin' });
    expect(screen.getByRole('header', { name: 'Angenommen' })).toBeOnTheScreen();
    expect(screen.getByText('Momo schlüpft, sobald deine Antwort gesichert ist.')).toBeOnTheScreen();
    expect(screen.getByText('Du: Bauen · Anna: Natur')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Ablehnen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Annehmen' })).toBeNull();
  });

  test('jede Ansicht des Tabs zeigt vor dem Schlüpfen die Rollenwahl', async () => {
    await open((w) => w.couple());
    await act(() => router.replace({ pathname: '/momo', params: { view: 'bauen' } }));
    expect(screen.getByRole('header', { name: 'Welche Rolle übernimmst du?' })).toBeOnTheScreen();
  });
});

describe('Beiträge gegen die Vertrags-Fixtures', () => {
  const characterFixtures = contractFixtures.today!.MomoCharacterState!.valid;
  const wirFixtures = contractFixtures.wir!.WirContributionsState!.valid;

  test('momo.character: Laichkugel, Rollenwahl offen und „Vorschlag gesendet“', async () => {
    const world = await createLaichkugelWorld(clock);
    cleanups.push(() => world.close());
    const states: unknown[] = [];
    cleanups.push(world.game.momoCharacter.subscribe((state) => states.push(state)));

    world.couple();
    world.game.proposeRoles('bauen');

    expect(states).toEqual([characterFixtures['wartet im Ei'], characterFixtures['Rollenwahl offen'], characterFixtures['eigener Vorschlag gesendet']]);
  });

  test('Wir: die offene Rollenwahl nur an die Person, die antworten muss', async () => {
    const world = await createLaichkugelWorld(clock);
    cleanups.push(() => world.close());
    world.couple();
    const states: unknown[] = [];
    cleanups.push(world.game.wirContributions.subscribe((state) => states.push(state)));

    const annas = world.proposeOnServer('anna', 'natur');
    world.game.declineRoles(annas);

    const [, offen, beantwortet] = states;
    expect(offen).toEqual({
      type: 'ready',
      data: [{ ...(wirFixtures['nur die offene Rollenwahl'] as { data: [object] }).data[0], id: annas, actionId: annas }],
    });
    expect(beantwortet).toEqual(wirFixtures['nichts zu zeigen']);
    expect(states[0]).toEqual(wirFixtures['nichts zu zeigen']);
  });

  test('ohne eigene Person und solange die geschlüpfte Insel noch nicht vollständig angekommen ist, laden die Beiträge', () => {
    expect(momoCharacterOf({ type: 'ohne_person' })).toEqual({ type: 'loading' });
    expect(momoCharacterOf({ type: 'geschluepft', island: null })).toEqual({ type: 'loading' });
    expect(wirContributionsOf({ type: 'ohne_person' })).toEqual(wirFixtures['lädt']);
    expect(wirContributionsOf({ type: 'geschluepft', island: null })).toEqual(wirFixtures['lädt']);
  });

  test('nach dem Schlüpfen: momo.character ready und das gemeinsame Ereignis „Momo geschlüpft“ auf „Wir“ (#184)', async () => {
    const world = await createLaichkugelWorld(clock);
    cleanups.push(() => world.close());
    world.couple();
    world.credit(2);
    world.hatch();
    const characters: unknown[] = [];
    const contributions: unknown[] = [];
    cleanups.push(world.game.momoCharacter.subscribe((state) => characters.push(state)));
    cleanups.push(world.game.wirContributions.subscribe((state) => contributions.push(state)));

    // Die Gutschriften stammen vom 01. und 02.10.; am 14.10. döst Momo deshalb (#188).
    expect(MomoCharacterState.parse(characters.at(-1))).toEqual({
      type: 'ready',
      data: {
        appearance: { stage: 'geschluepft', formKey: 'kaulquappe', moodKey: 'doest', accessories: { kopf: null, hals: null } },
        energy: 2,
        level: 1,
        ownHalfPercent: 0,
        partnerHalfPercent: 0,
        waitingForPartner: false,
        partnerDisplayName: 'Anna',
      },
    });
    expect(WirContributionsState.parse(contributions.at(-1))).toEqual({
      type: 'ready',
      data: [expect.objectContaining({ type: 'shared_event', eventType: 'momo_geschluepft', messageKey: 'neu_bei_euch.momo_geschluepft', objectId: islandId })],
    });
  });
});
