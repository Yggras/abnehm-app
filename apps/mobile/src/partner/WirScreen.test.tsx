/// <reference types="expo-router/build/ts-declarations/expect" />
import { randomUUID } from 'node:crypto';

import { act, render, screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import type * as React from 'react';
import { StyleSheet, type RefreshControlProps } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, ServerVersion, TimeZone, type SyncCursor } from '@abnehm/contracts/base';
import { seedClock, seedIds, seedManifests } from '@abnehm/contracts/seeds';
import type { CanonicalChange } from '@abnehm/contracts/sync';

import { ClockProvider } from '../clock/clock-context';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { withDeviceConfig } from '../design/testing/device-config';
import { MessageHostProvider } from '../shell/MessageHost';
import { screenScrollId } from '../shell/ScreenFrame';
import { createTodayRegistry } from '../shell/today-registry';
import { TodayContent } from '../shell/TodayScreen';
import { createSyncEngine, createSyncRegistry, foundationSyncEntities, type SyncTransport } from '../sync';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appPartner, createPartner } from '.';

// Nachweis für #121 am gerenderten Bildschirm: Tab „Wir“ mit dem echten Verzeichnis `src/app` und der
// Partner-Karte auf „Heute“ über die Heute-Registry. Darunter liegen der echte Partnerbereich, die echte
// Sync-Engine und eine mit `solo` bzw. `gekoppelt` (#117) geseedete SQLite-Datei. Der Test gibt Pull-Seiten,
// Netzstatus und Minutentakt vor. In `gekoppelt` hält Anna Ernährung privat und teilt Wasser (100 %),
// Sport (45 von 120 min) und Gewicht (noch ohne Trend); ihr grober Stand ist „fast geschafft“, berechnet zur
// Uhr des Seeds.

jest.setTimeout(30_000);
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));

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
async function openPhilipp(scenario: 'solo' | 'gekoppelt') {
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
  const engine = createSyncEngine({ database, registry: createSyncRegistry(foundationSyncEntities), transport, clock, installationId: EntityId.parse(randomUUID()) });
  const online = new Set<(online: boolean) => void>();
  const ticks = new Set<() => void>();
  const partner = createPartner({
    database, clock, sync: () => engine.sync(),
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
    expect(within(card).getByLabelText('Anna, Sport: 45 von 120 Minuten diese Woche, Stand gerade eben')).toBeOnTheScreen();
    expect(within(card).getByText('Trend ab drei Tagesgewichten')).toBeOnTheScreen();
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
