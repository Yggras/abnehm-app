/// <reference types="expo-router/build/ts-declarations/expect" />
import { randomUUID } from 'node:crypto';

import { act, screen, userEvent, within } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import * as ExpoHaptics from 'expo-haptics';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone, type SyncCursor } from '@abnehm/contracts/base';
import { seedClock, seedIds, seedManifests } from '@abnehm/contracts/seeds';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { encouragement } from '../local-db/schema';
import { sqliteOf } from '../local-db/sqlite';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { appWirContributions } from '../shell/app-wir';
import { createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncTransport } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appPartner, createPartner, encouragementEntity } from '.';

// Nachweis für #123 am gerenderten Sheet `partner.encourage` mit dem echten Verzeichnis `src/app`, dem
// echten Partnerbereich und einer mit `gekoppelt` geseedeten SQLite-Datei: Philipp hat Anna dort heute
// schon dreimal angefeuert. Der Test gibt Netzstatus und Minutentakt vor; gepusht wird nicht.

jest.setTimeout(30_000);
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(async () => undefined),
  notificationAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  performAndroidHapticsAsync: jest.fn(async () => undefined),
}));

const appDir = 'src/app';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const start = { instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) };

/** Öffnet Philipps iPhone wie die App-Sitzung, mit `gekoppelt`, echter Outbox und steuerbarem Netz. */
async function openPhilipp() {
  const clock = createTestClock(start);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database: LocalDatabase = await databases.open('konto_a');
  seedLocalDatabase(database, seedManifests.gekoppelt, 'philipp-iphone');
  const transport: SyncTransport = {
    push: async () => ({ type: 'unavailable' }),
    pull: async () => ({ type: 'ok', body: { changes: [], next: { type: 'complete', cursor: '1' as SyncCursor } } }),
  };
  const registry = createSyncRegistry([...foundationSyncEntities, encouragementEntity]);
  const newId = () => EntityId.parse(randomUUID());
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId() });
  const online = new Set<(online: boolean) => void>();
  const ticks = new Set<() => void>();
  const partner = createPartner({
    wirContributions: appWirContributions.source,
    database, clock, sync: () => engine.sync(), writer: createSyncWriter({ registry, clock, newId }), newId,
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
    database,
    /** Die eigenen Anfeuerungen von heute aus dem Seed, bis auf `keep`. */
    async forgetSent(keep: number) {
      const sent = seedIds.encouragement.philippHeute.slice(keep);
      await act(async () => database.transaction((tx) => {
        for (const id of sent) sqliteOf(tx).delete(encouragement).where(eq(encouragement.id, id)).run();
      }));
    },
    async setOnline(value: boolean) {
      await act(async () => { for (const listener of online) listener(value); });
    },
    async advanceMinutes(minutes: number) {
      clock.advanceBy(minutes * 60_000);
      await act(async () => { for (const tick of ticks) tick(); });
    },
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
  };
}

const messages = ['Du schaffst das! 💪', 'Ich denk an dich ❤️', 'Stark heute! 🎉', 'Gemeinsam für Momo 🐣', 'Bin stolz auf dich 🌟'];
const buttonNames = () => within(screen.getByTestId('anfeuern-botschaften')).getAllByRole('button').map((button) => button.props.accessibilityLabel as string);

describe('Sheet „Anna anfeuern“', () => {
  it('zeigt die fünf festen Botschaften und nach drei Anfeuerungen den Hinweis ohne Push', async () => {
    await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner/encourage' });

    expect(await screen.findByRole('header', { name: 'Anna anfeuern' })).toBeOnTheScreen();
    expect(buttonNames()).toEqual(messages);
    expect(screen.getByText('Weitere Anfeuerungen sieht Anna in der App, ohne Push.')).toBeOnTheScreen();
  });

  it('zählt die Anfeuerungen mit Push des lokalen Tags herunter', async () => {
    const philipp = await openPhilipp();
    await philipp.forgetSent(2);
    await renderRouter(appDir, { initialUrl: '/partner/encourage' });
    expect(await screen.findByText('Noch 1 Anfeuerung mit Push heute')).toBeOnTheScreen();

    // Das Sheet folgt der Kontodatenbank.
    await philipp.forgetSent(0);
    expect(screen.getByText('Noch 3 Anfeuerungen mit Push heute')).toBeOnTheScreen();
  });

  it('ein Tipp sendet sofort, ohne Rückfrage und ohne Haptik, schließt das Sheet und bestätigt', async () => {
    const philipp = await openPhilipp();
    await philipp.forgetSent(0);
    await renderRouter(appDir, { initialUrl: '/partner' });
    await userEvent.press(within(await screen.findByTestId('wir-anfeuern')).getByRole('button', { name: 'Anfeuern' }));
    await userEvent.press(await screen.findByRole('button', { name: 'Stark heute! 🎉' }));

    expect(screen).toHavePathname('/partner');
    expect(await screen.findByText('Anfeuerung an Anna gesendet')).toBeOnTheScreen();
    expect(philipp.operations()).toEqual([
      expect.objectContaining({ type: 'sendEncouragement', payload: expect.objectContaining({ messageKey: 'stark_heute' }) }),
    ]);
    expect(ExpoHaptics.impactAsync).not.toHaveBeenCalled();
    expect(ExpoHaptics.performAndroidHapticsAsync).not.toHaveBeenCalled();
    expect(ExpoHaptics.notificationAsync).not.toHaveBeenCalled();

    // Der Zähler zählt die neue Anfeuerung mit.
    await userEvent.press(within(screen.getByTestId('wir-anfeuern')).getByRole('button', { name: 'Anfeuern' }));
    expect(await screen.findByText('Noch 2 Anfeuerungen mit Push heute')).toBeOnTheScreen();
  });

  it('offline merkt sie die Anfeuerung vor und sagt das', async () => {
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner' });
    await userEvent.press(within(await screen.findByTestId('wir-anfeuern')).getByRole('button', { name: 'Anfeuern' }));
    const message = await screen.findByRole('button', { name: 'Ich denk an dich ❤️' });
    await philipp.setOnline(false);
    await userEvent.press(message);

    expect(await screen.findByText('Wird gesendet, sobald du online bist')).toBeOnTheScreen();
    expect(philipp.operations()).toHaveLength(1);
  });

  it('der Zähler beginnt am nächsten lokalen Tag neu', async () => {
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner/encourage' });
    expect(await screen.findByText('Weitere Anfeuerungen sieht Anna in der App, ohne Push.')).toBeOnTheScreen();

    // 14:00 in Berlin; zehn Stunden später ist der 15.10.
    await philipp.advanceMinutes(10 * 60);
    expect(screen.getByText('Noch 3 Anfeuerungen mit Push heute')).toBeOnTheScreen();
  });
});
