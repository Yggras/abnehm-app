/// <reference types="expo-router/build/ts-declarations/expect" />
import { randomUUID } from 'node:crypto';

import { act, render, screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type * as React from 'react';
import { StyleSheet, type RefreshControlProps } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, ServerVersion, TimeZone, type SyncCursor } from '@abnehm/contracts/base';
import { seedClock, seedIds, seedManifests } from '@abnehm/contracts/seeds';
import type { ContributionState } from '@abnehm/contracts/contribution';
import { contractFixtures } from '@abnehm/contracts/fixtures';
import type { CanonicalChange } from '@abnehm/contracts/sync';
import type { WirContribution } from '@abnehm/contracts/wir';

import { ClockProvider } from '../clock/clock-context';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { withDeviceConfig } from '../design/testing/device-config';
import { appWirContributions } from '../shell/app-wir';
import type { Source } from '../shell/followed-source';
import { MessageHostProvider } from '../shell/MessageHost';
import { screenScrollId } from '../shell/ScreenFrame';
import { createTodayRegistry } from '../shell/today-registry';
import { TodayContent } from '../shell/TodayScreen';
import { createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncTransport } from '../sync';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appPartner, createPartner } from '.';
import { withoutPartnerPhotos } from './testing/fake-partner-photos';

// Nachweis für #121 am gerenderten Bildschirm: Tab „Wir“ mit dem echten Verzeichnis `src/app` und der
// Partner-Karte auf „Heute“ über die Heute-Registry. Darunter liegen der echte Partnerbereich, die echte
// Sync-Engine und eine mit `solo` bzw. `gekoppelt` (#117) geseedete SQLite-Datei. Der Test gibt Pull-Seiten,
// Netzstatus und Minutentakt vor. In `gekoppelt` hält Anna Ernährung privat und teilt Wasser (100 %),
// Sport (125 von 120 min) und Gewicht (Trend −0,2 kg, seit #181); ihr grober Stand ist „fast geschafft“,
// berechnet zur Uhr des Seeds.

jest.setTimeout(30_000);
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const appDir = 'src/app';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const ANNA = seedIds.person.anna;
const PHILIPP = seedIds.person.philipp;
const COUPLING = seedIds.coupling.philippAnna;
const start = { instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) };

let version = 1_000_000;
const next = () => ServerVersion.parse(String(++version));

/** Öffnet Philipps iPhone wie die App-Sitzung, mit Seed, echter Sync-Engine und steuerbarem Netz und Takt. */
async function openPhilipp(
  scenario: 'solo' | 'gekoppelt',
  wirContributions: Source<ContributionState<WirContribution[]> | null> = appWirContributions.source,
) {
  const clock = createTestClock(start);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_a');
  seedLocalDatabase(database, seedManifests[scenario], 'philipp-iphone');
  const pages: CanonicalChange[][] = [];
  const pulls: unknown[] = [];
  const transport: SyncTransport = {
    push: async () => ({ type: 'unavailable' }),
    pull: async (request) => {
      pulls.push(request);
      return { type: 'ok', body: { changes: pages.shift() ?? [], next: { type: 'complete', cursor: String(version) as SyncCursor } } };
    },
  };
  const registry = createSyncRegistry(foundationSyncEntities);
  const newId = () => EntityId.parse(randomUUID());
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId() });
  const online = new Set<(online: boolean) => void>();
  const ticks = new Set<() => void>();
  const partner = createPartner({ ...withoutPartnerPhotos,
    database, clock, sync: () => engine.sync(), writer: createSyncWriter({ registry, clock, newId }), newId, wirContributions,
    observeOnline: (listener) => { online.add(listener); return () => online.delete(listener); },
    refresh: (update) => { ticks.add(update); return () => ticks.delete(update); },
  });
  const release = appPartner.opened(partner);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
  });
  return {
    partner,
    pulls,
    /** Ein Sync-Zyklus, dessen Pull genau diese Änderungen liefert. */
    async pull(changes: CanonicalChange[]) {
      pages.push(changes);
      await act(async () => { await engine.sync(); });
    },
    async setOnline(value: boolean) {
      await act(async () => { for (const listener of online) listener(value); });
    },
    /** Lässt Zeit vergehen und stößt den Minutentakt an. */
    async advanceMinutes(minutes: number) {
      clock.advanceBy(minutes * 60_000);
      await act(async () => { for (const tick of ticks) tick(); });
    },
  };
}

function summary(type: 'wasser' | 'sport' | 'gewicht', content: object): CanonicalChange {
  const id = seedIds.partnerSummary.anna[type];
  const serverVersion = next();
  const period = type === 'gewicht'
    ? { type: 'vierzehn_tage', from: '2026-10-01', to: '2026-10-14' }
    : type === 'sport' ? { type: 'woche', from: '2026-10-12', to: '2026-10-18' } : { type: 'tag', localDate: '2026-10-14' };
  return { type: 'record', entityType: 'partner_summary', entityId: EntityId.parse(id), serverVersion,
    data: { type, id, generation: 2, ownerPersonId: ANNA, recipientPersonId: PHILIPP, couplingId: COUPLING, period, dataAsOf: start.instant, serverVersion, content } };
}

function notice(target: object, reason: 'freigabe_entzogen' | 'entkopplung'): CanonicalChange {
  const id = randomUUID();
  const serverVersion = next();
  return { type: 'record', entityType: 'revocation_notice', entityId: EntityId.parse(id), serverVersion,
    data: { id, recipientPersonId: PHILIPP, couplingId: COUPLING, target, reason, serverVersion } };
}

const archivedCoupling = (): CanonicalChange => ({
  type: 'record', entityType: 'coupling', entityId: EntityId.parse(COUPLING), serverVersion: next(),
  data: { personLowId: [ANNA, PHILIPP].sort()[0], personHighId: [ANNA, PHILIPP].sort()[1], status: 'archiviert',
    startedAt: '2026-10-01T18:20:00.000Z', endedAt: start.instant, reactivatedAt: null, createdAt: '2026-10-01T18:20:00.000Z', updatedAt: start.instant },
});

const overview = () => screen.getByTestId('wir-partneruebersicht');
const areaRows = () => within(overview()).queryAllByTestId(/^wir-bereich-/).map((row) => row.props.testID);

describe('„Wir“ solo', () => {
  it('zeigt Momo im Ei, dass die Tracker allein vollständig nutzbar sind, und die Wege zur Kopplung', async () => {
    await openPhilipp('solo');
    await renderRouter(appDir, { initialUrl: '/partner' });

    const solo = await screen.findByTestId('wir-solo');
    expect(within(solo).getByRole('image', { name: 'Momo wartet im Ei' })).toBeOnTheScreen();
    expect(within(solo).getByRole('header', { name: 'Momo wartet im Ei' })).toBeOnTheScreen();
    expect(within(solo).getByText(/Tracker kannst du auch allein vollständig nutzen/)).toBeOnTheScreen();
    expect(screen.queryByTestId('wir-partneruebersicht')).not.toBeOnTheScreen();

    await userEvent.press(within(solo).getByRole('button', { name: 'Code eingeben' }));
    expect(screen).toHavePathname('/partner/redeem');
  });

  it('„Partner einladen“ öffnet partner.invite', async () => {
    await openPhilipp('solo');
    await renderRouter(appDir, { initialUrl: '/partner' });
    await userEvent.press(await screen.findByRole('button', { name: 'Partner einladen' }));
    expect(screen).toHavePathname('/partner/invite');
  });
});

describe('„Wir“ gekoppelt', () => {
  it('zeigt Avatar, Namen und groben Tageszielstand ohne „X von 3“ und je freigegebenem Bereich eine Zeile', async () => {
    await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });

    const card = await screen.findByTestId('wir-partneruebersicht');
    expect(within(card).getByRole('header', { name: 'Anna, Tagesziele: fast geschafft, Stand gerade eben' })).toBeOnTheScreen();
    expect(within(card).getByText('A')).toBeOnTheScreen();
    // Die Stufe steht sichtbar mit ihrem Bezug (Impeccable-Kritik, P2).
    expect(within(card).getByText('Tagesziele: fast geschafft')).toBeOnTheScreen();
    expect(screen.queryByText(/von 3/)).not.toBeOnTheScreen();
    // Ernährung hält Anna privat: keine Zeile, kein Hinweis.
    expect(areaRows()).toEqual(['wir-bereich-wasser', 'wir-bereich-sport', 'wir-bereich-gewicht']);
    expect(screen.queryByText(/Ernährung|privat/)).not.toBeOnTheScreen();
    expect(within(card).getByLabelText('Anna, Wasser: 100 Prozent des Wasserziels, Stand gerade eben')).toBeOnTheScreen();
    expect(within(card).getByText('100 % des Wasserziels')).toBeOnTheScreen();
    expect(within(card).getByLabelText('Anna, Sport: 125 von 120 Minuten diese Woche, Stand gerade eben')).toBeOnTheScreen();
    expect(within(card).getByText('Trend −0,2 kg in 2 Wochen')).toBeOnTheScreen();
    expect(within(card).getByText('Stand gerade eben')).toBeOnTheScreen();
    // Partnerinhalte tragen die Partnerfarbe.
    expect(within(card).getAllByTestId('icon-drop', { includeHiddenElements: true })).toHaveLength(1);
  });

  it('zählt das Alter des Stands mit und zeigt den Stand nach einer Stunde mit Uhrzeit', async () => {
    const philipp = await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-partneruebersicht');
    // Jeder Pull hält den Stand frisch; der Datenstand selbst altert.
    for (let minute = 0; minute < 5; minute++) {
      await philipp.advanceMinutes(1);
      await philipp.pull([]);
    }
    expect(screen.getByLabelText('Anna, Wasser: 100 Prozent des Wasserziels, Stand vor 5 Minuten')).toBeOnTheScreen();
    expect(screen.getByText('Stand vor 5 Min.')).toBeOnTheScreen();

    await philipp.advanceMinutes(60);
    await philipp.pull([]);
    // 12:00 UTC ist 14:00 in Berlin.
    expect(screen.getByText('Stand heute 14:00')).toBeOnTheScreen();
  });

  it('zeigt offline oder 10 Minuten nach dem letzten Pull neutral „Offline · letzter Stand …“ und lässt den Inhalt stehen', async () => {
    const philipp = await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-partneruebersicht');
    expect(screen.queryByText(/Offline/)).not.toBeOnTheScreen();

    await philipp.setOnline(false);
    expect(screen.getByText('Offline · letzter Stand gerade eben')).toBeOnTheScreen();
    expect(screen.getByTestId('icon-offline', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByTestId('icon-alert', { includeHiddenElements: true })).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Anna, Wasser: 100 Prozent des Wasserziels, Offline, letzter Stand gerade eben')).toBeOnTheScreen();

    await philipp.setOnline(true);
    expect(screen.queryByText(/Offline/)).not.toBeOnTheScreen();
    // Der Seed ist zur Uhr gepullt; nach genau 10 Minuten ist der Stand noch frisch, danach veraltet.
    await philipp.advanceMinutes(10);
    expect(screen.queryByText(/Offline/)).not.toBeOnTheScreen();
    await philipp.advanceMinutes(1);
    expect(screen.getByText('Offline · letzter Stand vor 11 Min.')).toBeOnTheScreen();
    expect(areaRows()).toHaveLength(3);

    await philipp.pull([]);
    expect(screen.queryByText(/Offline/)).not.toBeOnTheScreen();
  });

  it('zeigt jede Gewichtsrichtung und den Nicht-verfügbar-Zustand', async () => {
    const philipp = await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    const weightRow = async () => within(await screen.findByTestId('wir-bereich-gewicht'));

    expect((await weightRow()).getByText('Trend −0,2 kg in 2 Wochen')).toBeOnTheScreen();
    await philipp.pull([summary('gewicht', { changeKg: null, direction: 'noch_nicht_verfuegbar' })]);
    expect((await weightRow()).getByText('Trend ab drei Tagesgewichten')).toBeOnTheScreen();
    await philipp.pull([summary('gewicht', { changeKg: -0.4, direction: 'sinkend' })]);
    expect((await weightRow()).getByText('Trend −0,4 kg in 2 Wochen')).toBeOnTheScreen();
    expect(screen.getByLabelText('Anna, Gewicht: Trend minus 0,4 Kilogramm in 2 Wochen, Stand gerade eben')).toBeOnTheScreen();
    await philipp.pull([summary('gewicht', { changeKg: 0, direction: 'stabil' })]);
    expect((await weightRow()).getByText('Trend stabil')).toBeOnTheScreen();
    await philipp.pull([summary('gewicht', { changeKg: 0.3, direction: 'steigend' })]);
    expect((await weightRow()).getByText('Trend +0,3 kg in 2 Wochen')).toBeOnTheScreen();
  });

  it('zeigt gekoppelt ohne jede Projektion nur den Namen und offline neutral „Offline“ (#121, Review)', async () => {
    const philipp = await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-bereich-wasser');
    // Zwischen zwei Pull-Seiten direkt nach dem Koppeln: Kopplung da, Projektionen noch nicht.
    await philipp.pull([
      ...(['wasser', 'sport', 'gewicht'] as const).map((area) =>
        notice({ type: 'partner_summary', projectionId: seedIds.partnerSummary.anna[area] }, 'freigabe_entzogen')),
      notice({ type: 'partner_daily_goal_status', projectionId: seedIds.partnerDailyGoalStatus.anna }, 'entkopplung'),
    ]);
    expect(within(overview()).getByRole('header', { name: 'Anna' })).toBeOnTheScreen();
    expect(screen.queryByText(/Stand|Tagesziele|Anfang|unterwegs|geschafft/)).not.toBeOnTheScreen();

    await philipp.setOnline(false);
    expect(screen.getByText('Offline')).toBeOnTheScreen();
  });

  it('lässt nach Revocation-Notices für alle Bereiche nur Namen und groben Stand stehen, ohne Hinweis', async () => {
    const philipp = await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-bereich-wasser');

    await philipp.pull((['wasser', 'sport', 'gewicht'] as const).map((area) =>
      notice({ type: 'partner_summary', projectionId: seedIds.partnerSummary.anna[area] }, 'freigabe_entzogen')));

    expect(areaRows()).toEqual([]);
    expect(within(overview()).getByText('Tagesziele: fast geschafft')).toBeOnTheScreen();
    expect(screen.queryByText(/privat|freigegeben|Wasser|Sport|Gewicht/)).not.toBeOnTheScreen();
  });

  it('entfernt nach einer Notice den Bereich sofort und zeigt nach der Entkopplung den Solo-Zustand', async () => {
    const philipp = await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-bereich-wasser');

    await philipp.pull([notice({ type: 'partner_summary', projectionId: seedIds.partnerSummary.anna.wasser }, 'freigabe_entzogen')]);
    expect(areaRows()).toEqual(['wir-bereich-sport', 'wir-bereich-gewicht']);

    await philipp.pull([notice({ type: 'kopplung' }, 'entkopplung'), archivedCoupling()]);
    expect(await screen.findByTestId('wir-solo')).toBeOnTheScreen();
    expect(screen.queryByText(/Anna/)).not.toBeOnTheScreen();
  });

  it('„Anfeuern“ öffnet partner.encourage', async () => {
    await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    const card = await screen.findByTestId('wir-anfeuern');
    expect(within(card).getByText('Schick Anna eine kurze Ermutigung.')).toBeOnTheScreen();
    await userEvent.press(within(card).getByRole('button', { name: 'Anfeuern' }));
    expect(screen).toHavePathname('/partner/encourage');
  });

  it('Pull-to-Refresh startet den Sync', async () => {
    const philipp = await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-partneruebersicht');
    expect(philipp.pulls).toHaveLength(0);

    // Die Geste ruft `onRefresh` der RefreshControl am scrollenden Inhalt von `ScreenFrame`.
    const control = screen.getByTestId(screenScrollId).props.refreshControl as React.ReactElement<RefreshControlProps>;
    await act(async () => { control.props.onRefresh!(); });

    expect(philipp.pulls).toHaveLength(1);
  });

  describe('ab Schriftfaktor 1,3', () => {
    withDeviceConfig('schriftfaktor-2');

    it('stehen Partner-Zusammenfassungen einspaltig', async () => {
      await openPhilipp('gekoppelt');
      await renderRouter(appDir, { initialUrl: '/partner' });
      const row = await screen.findByTestId('wir-bereich-wasser');
      expect(StyleSheet.flatten(row.props.style)).toMatchObject({ flexDirection: 'column' });
    });
  });
});

describe('Partner-Karte auf „Heute“ über die Heute-Registry', () => {
  async function renderToday(partner: Awaited<ReturnType<typeof openPhilipp>>['partner']) {
    const registry = createTodayRegistry();
    registry.register('partner', 'partner', partner.todayCard);
    const clock = { read: (zone?: TimeZone) => partnerClock.read(zone) };
    await render(<ClockProvider clock={clock}><MessageHostProvider><TodayContent registry={registry} /></MessageHostProvider></ClockProvider>);
    return within(screen.getByTestId('today-slot-partner'));
  }
  // „Heute“ liest das Alter des Stands mit derselben Uhr wie der Partnerbereich.
  const partnerClock = createTestClock(start);

  it('solo mit „Partner einladen“ und „Code eingeben“', async () => {
    const { partner } = await openPhilipp('solo');
    const slot = await renderToday(partner);
    expect(slot.getByRole('button', { name: 'Partner einladen' })).toBeOnTheScreen();
    expect(slot.getByRole('button', { name: 'Code eingeben' })).toBeOnTheScreen();
  });

  it('gekoppelt mit Name, grobem Stand, Datenstand und „Anfeuern“, ohne Zusammenfassungen; offline neutral veraltet', async () => {
    const philipp = await openPhilipp('gekoppelt');
    const slot = await renderToday(philipp.partner);
    expect(slot.getByLabelText('Anna, Tagesziele: fast geschafft, Stand gerade eben')).toBeOnTheScreen();
    expect(slot.getByText('A')).toBeOnTheScreen();
    expect(slot.getByText('Tagesziele: fast geschafft')).toBeOnTheScreen();
    expect(slot.getByText('Stand gerade eben')).toBeOnTheScreen();
    expect(slot.getByRole('button', { name: 'Anfeuern' })).toBeOnTheScreen();
    expect(slot.queryByText(/Wasser|Sport|Trend|%/)).not.toBeOnTheScreen();

    await philipp.setOnline(false);
    expect(slot.getByText('Offline · letzter Stand gerade eben')).toBeOnTheScreen();
    expect(slot.queryByText(/UTC/)).not.toBeOnTheScreen();
    expect(slot.getByRole('button', { name: 'Anfeuern' })).toBeOnTheScreen();
  });
});

describe('„Wir“: Vorgänge, Challenge, Gemeinschaftsprojekt und „Neu bei euch“ (#124)', () => {
  // Die Beiträge von Spezifikation 4 kommen als Vertrags-Fixtures (#94) über eine steuerbare
  // `WirContributionSource`; der Partner stammt aus dem Seed `gekoppelt`. Die Uhr steht auf Mittwoch,
  // 14.10.2026, 12:00 UTC (14:00 in Berlin).
  type State = ContributionState<WirContribution[]>;
  const valid = contractFixtures.wir!.WirContribution!.valid as Record<string, WirContribution>;
  const proposal = valid['fremder Challenge-Vorschlag'] as Extract<WirContribution, { type: 'challenge' }>;
  const activeFixture = valid['aktive Challenge ohne Enddatum'] as Extract<WirContribution, { type: 'challenge' }>;
  const projectFixture = valid['Gemeinschaftsprojekt'] as Extract<WirContribution, { type: 'community_project' }>;
  const roleChoice = valid['Rollenwahl von Anna'] as Extract<WirContribution, { type: 'pending_shared_action' }>;
  const gift = valid['Deko-Geschenk'] as Extract<WirContribution, { type: 'pending_shared_action' }>;
  const levelUp = valid['Levelaufstieg'] as Extract<WirContribution, { type: 'shared_event' }>;

  const id = (n: number) => EntityId.parse(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
  const ago = (minutes: number) => Instant.parse(new Date(Date.parse(start.instant) - minutes * 60_000).toISOString());

  const swap = { ...roleChoice, id: id(1), actionId: id(1), kind: 'rollentausch', dataAsOf: ago(5) } as const;
  const giftEarlier = { ...gift, id: id(2), actionId: id(2), dataAsOf: ago(90) } as const;
  const partnerProposal = { ...proposal, dataAsOf: ago(30) } as const;
  const active = {
    ...activeFixture, id: id(3), challengeId: id(3), ownCount: 4, ownRequired: 6, stage: 'gut_unterwegs',
    endsAt: Instant.parse('2026-10-17T09:00:00.000Z'), action: { actionId: 'wir.open_challenge', target: { type: 'challenge.detail', challengeId: id(3) } },
  } as const;
  const project = { ...projectFixture, templateKey: 'gartenhaeuschen' } as const;
  const event = (n: number, eventType: Extract<WirContribution, { type: 'shared_event' }>['eventType'], occurredAt: string) =>
    ({ ...levelUp, id: id(100 + n), eventId: id(100 + n), eventType, messageKey: `neu_bei_euch.${eventType}`, occurredAt: Instant.parse(occurredAt) }) as const;

  /** Eine steuerbare Quelle der Spiel-Beiträge. */
  function contributions(initial: State) {
    let state = initial;
    const listeners = new Set<(next: State) => void>();
    return {
      source: { subscribe(listener: (next: State) => void) { listeners.add(listener); listener(state); return () => { listeners.delete(listener); }; } },
      async set(next: State) {
        state = next;
        await act(async () => { for (const listener of listeners) listener(next); });
      },
    };
  }

  async function openWith(data: WirContribution[]) {
    await openPhilipp('gekoppelt', contributions({ type: 'ready', data }).source);
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-partneruebersicht');
  }

  const sections = () => screen
    .queryAllByTestId(/^wir-(vorgang|partneruebersicht|anfeuern|challenge|projekt|neu-bei-euch)/)
    .map((node) => String(node.props.testID).replace(/-[0-9a-f]{8}-[0-9a-f-]{27}$/, ''));

  it('zeigt antwortbedürftige Vorgänge oben, neueste zuerst, mit den Aktionen der liefernden Spezifikation', async () => {
    await openWith([giftEarlier, active, partnerProposal, swap]);

    expect(screen.getAllByTestId(/^wir-vorgang-/).map((card) => card.props.testID)).toEqual([
      `wir-vorgang-${swap.id}`, `wir-vorgang-${partnerProposal.id}`, `wir-vorgang-${giftEarlier.id}`,
    ]);
    const swapCard = within(screen.getByTestId(`wir-vorgang-${swap.id}`));
    expect(swapCard.getByRole('header', { name: 'Anna möchte die Rollen tauschen' })).toBeOnTheScreen();
    const proposalCard = within(screen.getByTestId(`wir-vorgang-${partnerProposal.id}`));
    expect(proposalCard.getByRole('header', { name: 'Anna schlägt eine Challenge vor' })).toBeOnTheScreen();
    // Der Vorschlag verfällt am Freitag, 16.10., 12:00 UTC, also 14:00 in Berlin.
    expect(proposalCard.getByText('„Gut getrunken“ · Gilt bis Freitag, 14:00 Uhr')).toBeOnTheScreen();
    // Das Deko-Geschenk liefert noch keine Aktion: Die Karte steht ohne Knopf.
    const giftCard = within(screen.getByTestId(`wir-vorgang-${giftEarlier.id}`));
    expect(giftCard.getByRole('header', { name: 'Anna schenkt dir Deko' })).toBeOnTheScreen();
    expect(giftCard.queryByRole('button')).not.toBeOnTheScreen();
    // Die aktive Challenge ist kein Vorgang.
    expect(screen.queryByTestId(`wir-vorgang-${active.id}`)).not.toBeOnTheScreen();

    await userEvent.press(proposalCard.getByRole('button', { name: 'Ansehen' }));
    expect(screen).toHavePathname('/challenge/detail');
  });

  it('öffnet die Rollenfrage über die Aktion des Vorgangs im Tab „Momo“', async () => {
    await openWith([swap]);
    await userEvent.press(within(screen.getByTestId(`wir-vorgang-${swap.id}`)).getByRole('button', { name: 'Ansehen' }));
    expect(screen).toHavePathname('/momo');
  });

  it('ordnet Vorgänge, Partnerübersicht, Anfeuern, Challenge, Gemeinschaftsprojekt und „Neu bei euch“ fest', async () => {
    await openWith([event(1, 'levelaufstieg', ago(60)), project, active, swap]);
    expect(sections()).toEqual(['wir-vorgang', 'wir-partneruebersicht', 'wir-anfeuern', 'wir-challenge', 'wir-projekt', 'wir-neu-bei-euch']);
  });

  it('zeigt die aktive Challenge mit eigenem genauen Stand, gemeinsamer Stufe und Restlaufzeit', async () => {
    await openWith([active]);
    const card = within(screen.getByTestId(`wir-challenge-${active.id}`));
    expect(card.getByRole('header', { name: 'Gut getrunken' })).toBeOnTheScreen();
    expect(card.getByText('Du: 4 von 6')).toBeOnTheScreen();
    expect(card.getByText('Gemeinsam: gut unterwegs')).toBeOnTheScreen();
    // Bis Samstag, 17.10., 9:00 UTC sind es 69 Stunden.
    expect(card.getByText('noch 3 Tage')).toBeOnTheScreen();
    expect(screen.queryByText(/Anna.*von/)).not.toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: /^Challenge Gut getrunken/ }));
    expect(screen).toHavePathname('/challenge/detail');
  });

  it('zeigt den eigenen Challenge-Vorschlag neutral als „Vorschlag gesendet“ unter der Challenge', async () => {
    const own = { ...partnerProposal, proposedBySelf: true } as const;
    await openWith([own]);
    expect(screen.queryByTestId(/^wir-vorgang-/)).not.toBeOnTheScreen();
    const card = within(screen.getByTestId(`wir-challenge-${own.id}`));
    expect(card.getByText('Vorschlag gesendet')).toBeOnTheScreen();
    expect(card.getByText('Gilt bis Freitag, 14:00 Uhr')).toBeOnTheScreen();
  });

  it('zeigt das Gemeinschaftsprojekt mit eigenem Anteil und Weg zur Insel', async () => {
    await openWith([project]);
    const card = within(screen.getByTestId(`wir-projekt-${project.id}`));
    expect(card.getByRole('header', { name: 'Gartenhäuschen' })).toBeOnTheScreen();
    expect(card.getByText('Dein Bau-Anteil: 12 von 30 Energie')).toBeOnTheScreen();
    expect(card.getByText('Gemeinsam: gut unterwegs')).toBeOnTheScreen();

    await userEvent.press(screen.getByRole('button', { name: /^Gemeinschaftsprojekt Gartenhäuschen/ }));
    expect(screen).toHavePathname('/momo');
  });

  it('lässt Bereiche ohne Inhalt still weg', async () => {
    await openWith([]);
    expect(sections()).toEqual(['wir-partneruebersicht', 'wir-anfeuern']);
    expect(screen.queryByText(/in Arbeit|Neu bei euch|Challenge/)).not.toBeOnTheScreen();
  });

  it('zeigt unter „Neu bei euch“ genau drei Ereignisse mit Zeitpunkt', async () => {
    await openWith([event(1, 'momo_geschluepft', ago(60 * 24 * 3)), event(2, 'levelaufstieg', ago(120)), event(3, 'gebiet', ago(5))]);
    const news = within(screen.getByTestId('wir-neu-bei-euch'));
    expect(news.getByRole('header', { name: 'Neu bei euch' })).toBeOnTheScreen();
    expect(news.getAllByTestId('wir-ereignis').map((row) => row.props.accessibilityLabel)).toEqual([
      'Neues Gebiet auf eurer Insel, vor 5 Minuten',
      'Momo ist ein Level aufgestiegen, heute 12:00 Uhr',
      'Momo ist geschlüpft, 11.10. 14:00 Uhr',
    ]);
    // Der Verlauf zeigte nichts darüber hinaus (Impeccable-Kritik, P2).
    expect(news.queryByRole('button', { name: 'Alle anzeigen' })).not.toBeOnTheScreen();
  });

  it('zeigt bei vielen Ereignissen die drei neuesten und unter „Alle anzeigen“ den Verlauf nach Kalenderwochen', async () => {
    // Kalenderwochen nach ISO (Python `date.isocalendar()`): 04.10.2026 → KW 40, 02.01.2026 und 30.12.2025 →
    // KW 1 des Jahres 2026, 22.12.2025 → KW 52. Mittwoch, 14.10.2026, liegt in KW 42.
    await openWith([
      event(7, 'momo_geschluepft', '2025-12-22T09:00:00.000Z'),
      event(6, 'projektabschluss', '2025-12-30T09:00:00.000Z'),
      event(5, 'accessoire', '2026-01-02T09:00:00.000Z'),
      event(4, 'challenge_gestartet', '2026-10-04T20:00:00.000Z'),
      event(3, 'gebiet', '2026-10-09T08:00:00.000Z'),
      event(2, 'levelaufstieg', '2026-10-12T08:00:00.000Z'),
      event(1, 'challenge_geschafft', '2026-10-14T10:00:00.000Z'),
    ]);
    const firstWords = (row: { props: { accessibilityLabel?: string } }) => row.props.accessibilityLabel!.split(',')[0];
    const news = within(screen.getByTestId('wir-neu-bei-euch'));
    expect(news.getAllByTestId('wir-ereignis').map(firstWords)).toEqual([
      'Challenge gemeinsam geschafft', 'Momo ist ein Level aufgestiegen', 'Neues Gebiet auf eurer Insel',
    ]);

    await userEvent.press(news.getByRole('button', { name: 'Alle anzeigen' }));
    const sheet = within(screen.getByTestId('sheet'));
    expect(sheet.getByRole('header', { name: 'Neu bei euch' })).toBeOnTheScreen();
    const expected = [
      ['Diese Woche', ['Challenge gemeinsam geschafft', 'Momo ist ein Level aufgestiegen']],
      ['Letzte Woche', ['Neues Gebiet auf eurer Insel']],
      ['KW 40', ['Eure Challenge hat begonnen']],
      ['KW 1', ['Neues Accessoire im Schrank', 'Euer Gemeinschaftsprojekt ist fertig']],
      ['KW 52', ['Momo ist geschlüpft']],
    ] as const;
    const weeks = sheet.getAllByTestId('wir-verlauf-woche');
    expect(weeks).toHaveLength(expected.length);
    expected.forEach(([label, texts], index) => {
      expect(within(weeks[index]!).getByRole('header', { name: label })).toBeOnTheScreen();
      expect(within(weeks[index]!).getAllByTestId('wir-ereignis').map(firstWords)).toEqual(texts);
    });

    await userEvent.press(sheet.getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByTestId('sheet')).not.toBeOnTheScreen();
  });

  it('folgt dem Zustand der Beiträge: veraltet mit Inhalt, Fehler neutral mit „Erneut versuchen“', async () => {
    const source = contributions({ type: 'loading' });
    await openPhilipp('gekoppelt', source.source);
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-partneruebersicht');
    expect(sections()).toEqual(['wir-partneruebersicht', 'wir-anfeuern']);

    await source.set({ type: 'stale', data: [active], dataAsOf: ago(30) });
    expect(screen.getByTestId(`wir-challenge-${active.id}`)).toBeOnTheScreen();

    await source.set({ type: 'error', code: 'full_resync_required', retryAction: { actionId: 'wir.retry', target: { type: 'momo' } } });
    expect(screen.queryByTestId(`wir-challenge-${active.id}`)).not.toBeOnTheScreen();
    expect(screen.getByText('Gemeinsames ist gerade nicht verfügbar.')).toBeOnTheScreen();
    expect(screen.queryByTestId('icon-alert', { includeHiddenElements: true })).not.toBeOnTheScreen();
    await userEvent.press(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(screen).toHavePathname('/momo');
  });

  it('zeigt fehlende Spiel-Beiträge in Development Builds als Platzhalter', async () => {
    // Ohne angemeldete `WirContributionSource` bleibt der Steckplatz der App leer.
    await openPhilipp('gekoppelt');
    await renderRouter(appDir, { initialUrl: '/partner' });
    const placeholder = within(await screen.findByTestId('wir-spiel-platzhalter'));
    expect(placeholder.getByText('Dieser Bereich ist noch in Arbeit.')).toBeOnTheScreen();
    expect(placeholder.getByText('Kommt mit: Momo, Insel & Challenges')).toBeOnTheScreen();
  });
});
