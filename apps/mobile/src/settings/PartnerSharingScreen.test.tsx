/// <reference types="expo-router/build/ts-declarations/expect" />
import { randomUUID } from 'node:crypto';

import { act, screen, userEvent, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone, type SyncCursor } from '@abnehm/contracts/base';
import { seedClock, seedManifests } from '@abnehm/contracts/seeds';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { fakeInvitationFlows } from '../online/testing/fake-invitation-flows';
import { appPartner, createPartner, encouragementEntity } from '../partner';
import type * as DeviceSession from '../session/device-session';
import { appWirContributions } from '../shell/app-wir';
import { createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncTransport } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { withoutPartnerPhotos } from '../partner/testing/fake-partner-photos';

// Nachweis für #129 an der gerenderten Seite „Partner & Freigaben“ (`settings` mit `section: "partner_sharing"`)
// mit dem echten Verzeichnis `src/app`, dem echten Partnerbereich und einer geseedeten SQLite-Datei. Der Test gibt
// den Netzstatus vor; gepusht wird nicht, die Outbox zeigt, was beim nächsten Push rausginge.

jest.setTimeout(30_000);
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
// Die Kopplungsabläufe laufen über den Online-Test-Adapter der Einladungsabläufe (#103).
jest.mock('../session/device-session', () => ({
  ...jest.requireActual<typeof DeviceSession>('../session/device-session'),
  deviceInvitationFlows: () => ({ invitations: mockFlows, newId: mockNewId }),
}));
const mockFlows = fakeInvitationFlows();
const mockNewId = () => EntityId.parse(randomUUID());

const appDir = 'src/app';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const start = { instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) };

/** Öffnet Philipps iPhone wie die App-Sitzung, mit dem Seed `scenario`, echter Outbox und steuerbarem Netz. */
async function openPhilipp(scenario: 'gekoppelt' | 'solo' = 'gekoppelt') {
  const clock = createTestClock(start);
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database: LocalDatabase = await databases.open('konto_a');
  seedLocalDatabase(database, seedManifests[scenario], 'philipp-iphone');
  const transport: SyncTransport = {
    push: async () => ({ type: 'unavailable' }),
    pull: async () => ({ type: 'ok', body: { changes: [], next: { type: 'complete', cursor: '1' as SyncCursor } } }),
  };
  const registry = createSyncRegistry([...foundationSyncEntities, encouragementEntity]);
  const newId = () => EntityId.parse(randomUUID());
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId() });
  const online = new Set<(online: boolean) => void>();
  const partner = createPartner({ ...withoutPartnerPhotos,
    wirContributions: appWirContributions.source,
    database, clock, sync: () => engine.sync(), writer: createSyncWriter({ registry, clock, newId }), newId,
    observeOnline: (listener) => { online.add(listener); return () => online.delete(listener); },
    refresh: () => () => {},
  });
  const release = appPartner.opened(partner);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
  });
  return {
    database,
    async setOnline(value: boolean) {
      await act(async () => { for (const listener of online) listener(value); });
    },
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
  };
}

async function openPage() {
  await renderRouter(appDir, { initialUrl: '/settings/partner_sharing' });
  await screen.findByRole('header', { name: 'Partner & Freigaben' });
}

describe('Partner & Freigaben, gekoppelt', () => {
  it('zeigt im Kopf Avatar, „Mit Anna gekoppelt“ und seit wann Momo und Insel bestehen', async () => {
    await openPhilipp();
    await openPage();

    expect(await screen.findByText('Mit Anna gekoppelt')).toBeOnTheScreen();
    // Seed: gekoppelt am 1.10.2026 um 18:30 UTC, in Berlin 20:30 am selben Tag; nie reaktiviert.
    expect(screen.getByText('Momo und Insel seit 1. Oktober 2026')).toBeOnTheScreen();
    expect(screen.getByText('A')).toBeOnTheScreen();
  });

  it('zeigt vier Bereichsschalter und den Fotoschalter mit Untertiteln, Startwerten und dem Infotext', async () => {
    await openPhilipp();
    await openPage();

    expect(screen.getAllByRole('header').map((header) => header.props.children)).toEqual(['Partner & Freigaben', 'Gesundheitsbereiche', 'Fotos']);
    for (const [area, subtitle] of [
      ['Ernährung', 'Anzahl erfasster Mahlzeiten'],
      ['Wasser', 'Anteil am Wasserziel in Prozent'],
      ['Sport', 'Wochenminuten und Wochenziel'],
      ['Gewicht', 'Nur Trend und Veränderung, nie dein absolutes Gewicht'],
      ['Mahlzeitenfotos teilen', 'Unabhängig von der Ernährungs-Freigabe. Einzelne Fotos kannst du beim Erfassen ausnehmen.'],
    ]) {
      expect(screen.getByText(subtitle!)).toBeOnTheScreen();
      // Seed: Philipp teilt alle vier Zusammenfassungen und die Fotos.
      expect(screen.getByRole('switch', { name: area })).toBeChecked();
    }
    expect(screen.getByText('Abschalten beendet den Zugriff sofort. Bereits gemachte Screenshots kann die App nicht zurückholen.')).toBeOnTheScreen();
  });

  it.each([
    ['Ernährung', { entityType: 'partner_sharing', payload: { level: 'privat' } }],
    ['Wasser', { entityType: 'partner_sharing', payload: { level: 'privat' } }],
    ['Sport', { entityType: 'partner_sharing', payload: { level: 'privat' } }],
    ['Gewicht', { entityType: 'partner_sharing', payload: { level: 'privat' } }],
    ['Mahlzeitenfotos teilen', { entityType: 'photo_sharing', payload: { level: 'privat' } }],
  ])('„%s“ aus und wieder an: je ein sofortiger lokaler Upsert mit Outbox, ohne Meldung', async (name, upsert) => {
    const philipp = await openPhilipp();
    await openPage();

    await userEvent.press(screen.getByRole('switch', { name }));
    expect(await screen.findByRole('switch', { name })).not.toBeChecked();
    expect(philipp.operations()).toEqual([expect.objectContaining({ type: 'upsert_entity', ...upsert })]);

    await userEvent.press(screen.getByRole('switch', { name }));
    expect(await screen.findByRole('switch', { name })).toBeChecked();
    const on = upsert.entityType === 'photo_sharing' ? 'geteilt' : 'zusammengefasst';
    expect(philipp.operations().at(-1)).toEqual(expect.objectContaining({ type: 'upsert_entity', entityType: upsert.entityType, payload: { level: on } }));
    expect(screen.queryByText('Gilt, sobald du wieder online bist')).not.toBeOnTheScreen();
  });

  it('offline: Nach dem Abschalten sagt der Meldungs-Host, dass es erst mit der nächsten Verbindung gilt; Einschalten meldet nichts', async () => {
    const philipp = await openPhilipp();
    await openPage();
    await philipp.setOnline(false);

    await userEvent.press(screen.getByRole('switch', { name: 'Gewicht' }));
    expect(await screen.findByText('Gilt, sobald du wieder online bist')).toBeOnTheScreen();
    expect(screen.getByRole('switch', { name: 'Gewicht' })).not.toBeChecked();
    expect(philipp.operations()).toHaveLength(1);
  });
});

describe('Einstellungen-Übersicht', () => {
  it.each([
    ['gekoppelt', 'Mit Anna gekoppelt'],
    ['solo', 'Nicht gekoppelt'],
  ] as const)('%s: Die Zeile „Partner & Freigaben“ trägt den Untertitel „%s“', async (scenario, subtitle) => {
    await openPhilipp(scenario);
    await renderRouter(appDir, { initialUrl: '/settings' });

    const row = await screen.findByRole('button', { name: /^Partner & Freigaben/ });
    expect(within(row).getByText(subtitle)).toBeOnTheScreen();
  });
});

describe('Partner & Freigaben, solo', () => {
  it('zeigt „Nicht gekoppelt“ mit „Partner einladen“ und „Code eingeben“, ohne Schalter', async () => {
    await openPhilipp('solo');
    await openPage();

    expect(await screen.findByText('Nicht gekoppelt')).toBeOnTheScreen();
    expect(screen.queryAllByRole('switch')).toEqual([]);
    await userEvent.press(screen.getByRole('button', { name: 'Code eingeben' }));
    expect(screen).toHavePathname('/partner/redeem');
  });

  it('„Partner einladen“ öffnet den modalen Ablauf `partner.invite`', async () => {
    await openPhilipp('solo');
    await openPage();

    await userEvent.press(await screen.findByRole('button', { name: 'Partner einladen' }));
    expect(screen).toHavePathname('/partner/invite');
  });
});
