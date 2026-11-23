/// <reference types="expo-router/build/ts-declarations/expect" />
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, screen, userEvent, waitFor, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import type * as React from 'react';
import type { RefreshControlProps } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone, type MealKey, type SyncCursor } from '@abnehm/contracts/base';
import type { PartnerPhotoList } from '@abnehm/contracts/partner';
import { seedClock, seedManifests } from '@abnehm/contracts/seeds';

import { hitArea } from '../design/testing/hit-area';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { appWirContributions } from '../shell/app-wir';
import { screenScrollId } from '../shell/ScreenFrame';
import { createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncTransport } from '../sync';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appPartner, createPartner } from '.';
import type { OnlineResult } from '../online';
import { fakePartnerPhotos } from './testing/fake-partner-photos';

// Nachweis für #122 am gerenderten Bildschirm: „Fotos von heute“ in der Partnerübersicht von „Wir“ mit dem echten
// Verzeichnis `src/app`, dem echten Partnerbereich und einer mit `gekoppelt` geseedeten SQLite-Datei. Fotoliste
// und Bildabruf ersetzt der Online-Test-Adapter (`fakePartnerPhotos`). In `gekoppelt` hält Anna Ernährung privat:
// Die Fotos erscheinen trotzdem, denn sie hängen nur an der Fotofreigabe.

jest.setTimeout(30_000);
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const appDir = 'src/app';
const user = userEvent.setup();
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const start = { instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) };

/** Öffnet Philipps iPhone im Szenario `gekoppelt` mit Fotos aus dem Test-Adapter und steuerbarem Netz. */
async function openPhilipp(meals: readonly MealKey[] = ['fruehstueck', 'mittagessen']) {
  const clock = createTestClock(start);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database = await databases.open('konto_a');
  seedLocalDatabase(database, seedManifests.gekoppelt, 'philipp-iphone');
  const pulls: unknown[] = [];
  const transport: SyncTransport = {
    push: async () => ({ type: 'unavailable' }),
    pull: async (request) => {
      pulls.push(request);
      return { type: 'ok', body: { changes: [], next: { type: 'complete', cursor: '1' as SyncCursor } } };
    },
  };
  const registry = createSyncRegistry(foundationSyncEntities);
  const newId = () => EntityId.parse(randomUUID());
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId() });
  const online = new Set<(online: boolean) => void>();
  const fake = fakePartnerPhotos(meals);
  const partner = createPartner({
    database, clock, sync: () => engine.sync(), writer: createSyncWriter({ registry, clock, newId }), newId,
    wirContributions: appWirContributions.source, photos: fake.photos,
    observeOnline: (listener) => {
      listener(fake.state.online);
      online.add(listener);
      return () => online.delete(listener);
    },
    refresh: () => () => {},
  });
  const release = appPartner.opened(partner);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
  });
  return {
    ...fake,
    pulls,
    listCalls: () => fake.calls.filter(([type]) => type === 'liste').length,
    imageCalls: () => fake.calls.filter((call) => call[0] === 'bild'),
    async setOnline(value: boolean) {
      fake.state.online = value;
      await act(async () => { for (const listener of online) listener(value); });
    },
  };
}

const photosRow = () => screen.findByTestId('wir-fotos');
const thumbs = (row: Parameters<typeof within>[0]) => within(row).getAllByRole('button', { name: /^Mahlzeitenfoto von Anna/ });

/**
 * Wartet, bis alle laufenden Abrufe des Test-Adapters angekommen und gerendert sind. `renderRouter` schaltet
 * Fake-Timer ein, und TanStack Query meldet Ergebnisse über einen Timer (`notifyManager`); deshalb laufen
 * neben den Microtasks auch die fälligen Timer.
 */
async function settle() {
  for (let round = 0; round < 10; round++) {
    await act(async () => {
      await Promise.resolve();
      jest.runOnlyPendingTimers();
    });
  }
}

describe('„Fotos von heute“ online', () => {
  it('zeigt Annas Fotos beim Bereich Ernährung, auch wenn sie Ernährung privat hält', async () => {
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner' });

    const row = await photosRow();

    expect(within(row).getByText('Fotos von heute')).toBeOnTheScreen();
    expect(thumbs(row).map((thumb) => thumb.props.accessibilityLabel)).toEqual([
      'Mahlzeitenfoto von Anna, Frühstück, 1 von 2',
      'Mahlzeitenfoto von Anna, Mittagessen, 2 von 2',
    ]);
    // Bereiche in kanonischer Reihenfolge: Die Fotos stehen an der Stelle der Ernährung, vor Wasser.
    const overview = screen.getByTestId('wir-partneruebersicht');
    const order = within(overview).queryAllByTestId(/^wir-(fotos|bereich-)/).map((element) => element.props.testID);
    expect(order).toEqual(['wir-fotos', 'wir-bereich-wasser', 'wir-bereich-sport', 'wir-bereich-gewicht']);
    // Die Liste kommt ohne Parameter; die Vorschauen über ihre Handles.
    await settle();
    expect(philipp.calls).toEqual([
      ['liste'],
      ['bild', 'handle_0001_00000000', 'vorschau'],
      ['bild', 'handle_0001_00000001', 'vorschau'],
    ]);
    for (const thumb of thumbs(row)) expect(Math.min(hitArea(thumb).width, hitArea(thumb).height)).toBeGreaterThanOrEqual(48);
  });

  it('zeigt höchstens vier Vorschauen plus „+N“; „+N“ öffnet das fünfte Foto', async () => {
    await openPhilipp(['fruehstueck', 'mittagessen', 'mittagessen', 'snacks', 'abendessen', 'snacks']);
    await renderRouter(appDir, { initialUrl: '/partner' });
    const row = await photosRow();

    expect(thumbs(row)).toHaveLength(4);
    const more = within(row).getByRole('button', { name: '2 weitere Mahlzeitenfotos von Anna' });
    expect(within(more).getByText('+2')).toBeOnTheScreen();

    await user.press(more);

    const viewer = await screen.findByTestId('partnerfoto-vollbild');
    expect(within(viewer).getByText('5 von 6')).toBeOnTheScreen();
    expect(within(viewer).getByText('Abendessen')).toBeOnTheScreen();
  });

  it('ein Tipp öffnet die Vollbildansicht; Wischen blättert, „Schließen“ schließt', async () => {
    const philipp = await openPhilipp(['fruehstueck', 'mittagessen', 'abendessen']);
    await renderRouter(appDir, { initialUrl: '/partner' });
    const row = await photosRow();

    await user.press(thumbs(row)[1]!);

    const viewer = await screen.findByTestId('partnerfoto-vollbild');
    expect(within(viewer).getByText('2 von 3')).toBeOnTheScreen();
    expect(within(viewer).getByText('Mittagessen')).toBeOnTheScreen();
    await waitFor(() => expect(philipp.imageCalls()).toContainEqual(['bild', 'handle_0001_00000001', 'gross']));
    const large = await within(viewer).findByLabelText('Mahlzeitenfoto von Anna, Mittagessen, 2 von 3');
    expect(large.props.source).toEqual({ uri: 'data:image/jpeg;base64,handle_0001_00000001_gross' });

    // Eine Wischgeste endet mit `onMomentumScrollEnd` an der Seite, auf der die Liste stehen bleibt.
    const pager = within(viewer).getByTestId('partnerfoto-seiten');
    const width = pager.props.getItemLayout(undefined, 0).length as number;
    await act(async () => { pager.props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: width * 2, y: 0 } } }); });

    expect(within(viewer).getByText('3 von 3')).toBeOnTheScreen();
    expect(within(viewer).getByText('Abendessen')).toBeOnTheScreen();

    await user.press(within(viewer).getByRole('button', { name: 'Schließen' }));
    await waitFor(() => expect(screen.queryByTestId('partnerfoto-vollbild')).not.toBeOnTheScreen());
  });

  it('ein Fehler beim Bildabruf zeigt ein neutrales Platzhalterbild', async () => {
    const philipp = await openPhilipp(['fruehstueck', 'mittagessen']);
    philipp.state.image = (handle) => (handle.endsWith('1') ? { type: 'rejected', code: 'forbidden' } : null);
    await renderRouter(appDir, { initialUrl: '/partner' });
    const row = await photosRow();

    const placeholder = await within(row).findByTestId('partnerfoto-platzhalter');

    expect(placeholder).toHaveAccessibleName('Mahlzeitenfoto von Anna, Mittagessen, nicht geladen');
    expect(within(row).getAllByTestId('partnerfoto-vorschau', { includeHiddenElements: true })).toHaveLength(1);
    // Kein Fehlerton: kein Warnsymbol, kein Problemtext.
    expect(within(row).queryByTestId('icon-alert', { includeHiddenElements: true })).not.toBeOnTheScreen();
    expect(within(placeholder).getByTestId('icon-camera', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('Pull-to-Refresh startet den Sync und lädt die Fotoliste neu', async () => {
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner' });
    await photosRow();
    expect(philipp.listCalls()).toBe(1);

    const control = screen.getByTestId(screenScrollId).props.refreshControl as React.ReactElement<RefreshControlProps>;
    await act(async () => { control.props.onRefresh!(); });

    expect(philipp.pulls).toHaveLength(1);
    expect(philipp.listCalls()).toBe(2);
    // Die neuen Handles laden die Vorschauen neu.
    await settle();
    expect(philipp.imageCalls()).toContainEqual(['bild', 'handle_0002_00000000', 'vorschau']);
  });
});

describe('„Fotos von heute“ ohne Zeile', () => {
  it('offline: keine Abfrage und keine Zeile, ohne Fehlermeldung', async () => {
    const philipp = await openPhilipp();
    await philipp.setOnline(false);
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-partneruebersicht');
    await settle();

    expect(screen.queryByTestId('wir-fotos')).not.toBeOnTheScreen();
    expect(philipp.listCalls()).toBe(0);
  });

  it('geht das Gerät offline, verschwindet die Zeile; wieder online kommt sie mit frischer Liste zurück', async () => {
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner' });
    await photosRow();

    await philipp.setOnline(false);
    expect(screen.queryByTestId('wir-fotos')).not.toBeOnTheScreen();

    await philipp.setOnline(true);
    expect(await photosRow()).toBeOnTheScreen();
    expect(philipp.listCalls()).toBe(2);
  });

  const answers: [string, OnlineResult<PartnerPhotoList, 'forbidden'>][] = [
    ['leerer Liste', { type: 'ok', value: { photos: [], dataAsOf: start.instant } }],
    ['forbidden', { type: 'rejected', code: 'forbidden' }],
    ['Server nicht erreichbar', { type: 'offline' }],
  ];
  it.each(answers)('bei %s erscheint keine Zeile', async (_name, answer) => {
    const philipp = await openPhilipp();
    philipp.state.list = answer;
    await renderRouter(appDir, { initialUrl: '/partner' });
    await screen.findByTestId('wir-partneruebersicht');
    await settle();

    expect(philipp.listCalls()).toBe(1);
    expect(screen.queryByTestId('wir-fotos')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('icon-alert', { includeHiddenElements: true })).not.toBeOnTheScreen();
  });
});

describe('„Fotos von heute“ nur bei sichtbarem „Wir“', () => {
  it('fragt erst ab, wenn „Wir“ sichtbar wird, und bei jedem erneuten Öffnen frisch', async () => {
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/' });
    await settle();
    expect(philipp.listCalls()).toBe(0);

    await act(() => router.navigate('/partner'));
    await photosRow();
    expect(philipp.listCalls()).toBe(1);

    await act(() => router.navigate('/'));
    await settle();
    expect(philipp.listCalls()).toBe(1);

    await act(() => router.navigate('/partner'));
    await photosRow();
    expect(philipp.listCalls()).toBe(2);
  });
});

describe('„Fotos von heute“ nur im Arbeitsspeicher', () => {
  it('Bilder kommen nur als data:-URI an, und nach dem Schließen der App lädt alles neu: nichts ist zwischengespeichert', async () => {
    const philipp = await openPhilipp(['fruehstueck']);
    const first = await renderRouter(appDir, { initialUrl: '/partner' });
    const row = await photosRow();
    await settle();
    const sources = within(row).getAllByTestId('partnerfoto-vorschau', { includeHiddenElements: true }).map((image) => image.props.source);
    expect(sources).toEqual([{ uri: 'data:image/jpeg;base64,handle_0001_00000000_vorschau' }]);

    first.unmount();
    await renderRouter(appDir, { initialUrl: '/partner' });
    await photosRow();
    await settle();

    expect(philipp.calls).toEqual([
      ['liste'], ['bild', 'handle_0001_00000000', 'vorschau'],
      ['liste'], ['bild', 'handle_0002_00000000', 'vorschau'],
    ]);
  });

  it('die App hat weder einen Persister für TanStack Query noch eine Bildbibliothek mit Datei-Cache', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const dependencies = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });

    expect(dependencies.filter((name) => /persist|async-storage|expo-image$|fast-image|expo-file-system/.test(name))).toEqual([]);
  });
});
