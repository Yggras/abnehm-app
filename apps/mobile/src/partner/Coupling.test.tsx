/// <reference types="expo-router/build/ts-declarations/expect" />
import { randomUUID } from 'node:crypto';

import { notifyManager } from '@tanstack/react-query';
import { act, screen, userEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Share } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone, type SyncCursor } from '@abnehm/contracts/base';
import type { InvitationErrorCode } from '@abnehm/contracts/coupling';
import { seedClock, seedManifests } from '@abnehm/contracts/seeds';

import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { fakeInvitationFlows, type FakeInvitationFlows } from '../online/testing/fake-invitation-flows';
import type * as DeviceSession from '../session/device-session';
import { setTestGate } from '../session/testing/test-gate';
import { appWirContributions } from '../shell/app-wir';
import { createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncTransport } from '../sync';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appPartner, createPartner, encouragementEntity } from '.';
import { couplingPullIntervalMs } from './CouplingParts';

// Nachweis für #120 an den gerenderten modalen Abläufen `partner.invite` und `partner.redeem` mit dem echten
// Verzeichnis `src/app`, dem Online-Test-Adapter der Einladungsabläufe (#103) und dem echten Partnerbereich
// über einer mit `solo` geseedeten SQLite-Datei. Ein Pull des Tests bringt auf Wunsch die Kopplung aus
// `gekoppelt` in die Datei, wie ein echter Pull nach Annas Annahme.

jest.setTimeout(30_000);
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));
jest.mock('../session/device-session', () => ({
  ...jest.requireActual<typeof DeviceSession>('../session/device-session'),
  deviceInvitationFlows: () => ({ invitations: mockFlows, newId: mockNewId }),
  refreshDeviceSync: () => mockPull(),
  appClock: mockClock,
}));

const start = { instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) };
const mockClock = createTestClock(start);
const mockNewId = () => EntityId.parse(randomUUID());
let mockFlows: FakeInvitationFlows;
let mockPull: jest.Mock<Promise<unknown>, []>;

// TanStack bündelt Benachrichtigungen standardmäßig per `setTimeout(0)`, also außerhalb von `act`
// (https://tanstack.com/query/v5/docs/reference/notifyManager); im Test geht jede sofort an React.
beforeAll(() => notifyManager.setScheduler((callback) => callback()));
afterAll(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)));

const appDir = 'src/app';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  setTestGate('today');
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Was ein Pull des Tests auf das Gerät bringt: eine neue Kopplung vor dem Schlüpfen oder eine reaktivierte mit Rollen. */
type PulledCoupling = 'rollenwahl-offen' | 'gekoppelt';

/**
 * Philipps iPhone ohne Kopplung (`solo`) mit echtem Partnerbereich. Ein Pull des Tests zieht nichts, bis
 * `coupleOnNextPull` eine Kopplung bereitlegt: aus `rollenwahl-offen` (neu, Momo im Ei) oder aus `gekoppelt` (Rollen
 * vorhanden, wie nach einer Reaktivierung). Wie das echte Modul (`invitation-flows.ts`) stößt eine gelungene Annahme
 * danach einen Sync an.
 */
async function openPhilipp() {
  mockFlows = fakeInvitationFlows();
  const acceptCode = mockFlows.acceptCode;
  mockFlows.acceptCode = async (requestId, code) => {
    const result = await acceptCode(requestId, code);
    if (result.type === 'ok') await mockPull();
    return result;
  };
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database: LocalDatabase = await databases.open('konto_a');
  seedLocalDatabase(database, seedManifests.solo, 'philipp-iphone');
  let pulled: PulledCoupling | null = null;
  mockPull = jest.fn(async () => {
    if (pulled !== null) seedLocalDatabase(database, seedManifests[pulled], 'philipp-iphone');
  });
  const transport: SyncTransport = {
    push: async () => ({ type: 'unavailable' }),
    pull: async () => ({ type: 'ok', body: { changes: [], next: { type: 'complete', cursor: '1' as SyncCursor } } }),
  };
  const registry = createSyncRegistry([...foundationSyncEntities, encouragementEntity]);
  const engine = createSyncEngine({ database, registry, transport, clock: mockClock, installationId: mockNewId() });
  const partner = createPartner({
    wirContributions: appWirContributions.source,
    database, clock: mockClock, sync: () => engine.sync(), writer: createSyncWriter({ registry, clock: mockClock, newId: mockNewId }), newId: mockNewId,
    observeOnline: () => () => {},
    refresh: () => () => {},
  });
  const release = appPartner.opened(partner);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
  });
  return {
    flows: mockFlows,
    coupleOnNextPull(coupling: PulledCoupling = 'rollenwahl-offen') {
      pulled = coupling;
    },
  };
}

const user = () => userEvent.setup();
const problemCodes = ['invite_invalid', 'invite_expired', 'invite_consumed', 'invite_self'] as const satisfies readonly InvitationErrorCode[];

describe('partner.invite', () => {
  it('erzeugt beim Öffnen einen Code und zeigt ihn in zwei Dreiergruppen samt „gültig bis …“', async () => {
    const { flows } = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner/invite' });

    expect(await screen.findByLabelText('Einladungscode 4 8 2 9 1 5')).toHaveTextContent('482 915');
    // Der Code des Adapters läuft am 15.10. um 12:00 UTC ab, in Berlin 14:00 am Tag nach der Seed-Uhr.
    expect(screen.getByText('gültig bis morgen, 14:00')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Partner einladen' })).toBeOnTheScreen();
    expect(flows.calls.map((call) => call.method)).toEqual(['createCode']);
  });

  it('„Code teilen“ öffnet das System-Teilen-Menü mit einem deutschen Einladungstext samt Code', async () => {
    await openPhilipp();
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction, activityType: undefined });
    await renderRouter(appDir, { initialUrl: '/partner/invite' });

    await user().press(await screen.findByRole('button', { name: 'Code teilen' }));

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0]![0]).toEqual({
      message: 'Lass uns gemeinsam mit Momo starten! Gib in der App unter „Code eingeben“ diesen Code ein: 482915',
    });
    // Abgebrochen oder geteilt: Der Code bleibt stehen.
    expect(screen.getByLabelText('Einladungscode 4 8 2 9 1 5')).toBeOnTheScreen();
  });

  it('zieht alle 10 Sekunden; entsteht die Kopplung, zeigt es „Ihr seid gekoppelt“ und den Weg zum Schlüpfen', async () => {
    jest.useFakeTimers();
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner/invite' });
    await screen.findByLabelText('Einladungscode 4 8 2 9 1 5');

    await act(async () => jest.advanceTimersByTime(couplingPullIntervalMs - 1));
    expect(mockPull).not.toHaveBeenCalled();
    await act(async () => jest.advanceTimersByTime(1));
    expect(mockPull).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(couplingPullIntervalMs));
    expect(mockPull).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Ihr seid gekoppelt')).toBeNull();

    philipp.coupleOnNextPull();
    await act(async () => jest.advanceTimersByTime(couplingPullIntervalMs));

    expect(await screen.findByRole('header', { name: 'Ihr seid gekoppelt' })).toBeOnTheScreen();
    expect(screen.getByText('Du und Anna kümmert euch ab jetzt gemeinsam um Momo.')).toBeOnTheScreen();
    // Gekoppelt endet der Takt.
    await act(async () => jest.advanceTimersByTime(3 * couplingPullIntervalMs));
    expect(mockPull).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
    await user().press(screen.getByRole('button', { name: 'Zum Schlüpfen' }));
    expect(screen).toHavePathname('/momo');
    expect(screen).toHaveSearchParams({ view: 'rollenwahl' });
    expect(screen.queryByRole('header', { name: 'Partner einladen' })).toBeNull();
  });

  it('nach einer Reaktivierung (Rollen kommen per Pull zurück): „Ihr seid wieder gekoppelt“ und der Weg zur Insel', async () => {
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner/invite' });
    await screen.findByLabelText('Einladungscode 4 8 2 9 1 5');

    philipp.coupleOnNextPull('gekoppelt');
    await act(async () => mockPull());

    expect(await screen.findByRole('header', { name: 'Ihr seid wieder gekoppelt' })).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Zu eurer Insel' }));
    expect(screen).toHavePathname('/momo');
    expect(screen).toHaveSearchParams({});
  });

  it('offline: „Braucht Internet“ mit „Erneut versuchen“, das dieselbe Absicht wiederholt', async () => {
    const { flows } = await openPhilipp();
    flows.respond('createCode', { type: 'offline' });
    await renderRouter(appDir, { initialUrl: '/partner/invite' });

    expect(await screen.findByText('Braucht Internet')).toBeOnTheScreen();
    expect(mockPull).not.toHaveBeenCalled();
    await user().press(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByLabelText('Einladungscode 4 8 2 9 1 5')).toBeOnTheScreen();
    expect(flows.calls).toHaveLength(2);
    expect(flows.calls[1]!.requestId).toBe(flows.calls[0]!.requestId);
  });

  it.each([
    ['already_coupled', 'Du bist bereits gekoppelt.'],
    ['invite_rate_limited', 'Zu viele Versuche. Bitte später erneut.'],
  ] as const)('eigener Text für %s, ohne „Erneut versuchen“', async (code, text) => {
    const { flows } = await openPhilipp();
    flows.respond('createCode', { type: 'rejected', code });
    await renderRouter(appDir, { initialUrl: '/partner/invite' });

    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
  });

  it('eine abgelehnte Sitzung zeigt bis zum Wechsel der Weiche den allgemeinen Text', async () => {
    const { flows } = await openPhilipp();
    flows.respond('createCode', { type: 'unauthorized' });
    await renderRouter(appDir, { initialUrl: '/partner/invite' });

    expect(await screen.findByText('Das hat gerade nicht geklappt. Versuch es erneut.')).toBeOnTheScreen();
  });

  it('ein unerwarteter Ausgang zeigt den allgemeinen Text mit „Erneut versuchen“', async () => {
    const { flows } = await openPhilipp();
    flows.respond('createCode', { type: 'failed' });
    await renderRouter(appDir, { initialUrl: '/partner/invite' });

    expect(await screen.findByText('Das hat gerade nicht geklappt. Versuch es erneut.')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByLabelText('Einladungscode 4 8 2 9 1 5')).toBeOnTheScreen();
  });

  it('„Fertig“ und System-Zurück kehren zum Aufrufer zurück', async () => {
    await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner' });
    await user().press(await screen.findByRole('button', { name: 'Partner einladen' }));
    await screen.findByLabelText('Einladungscode 4 8 2 9 1 5');
    expect(screen).toHavePathname('/partner/invite');

    await user().press(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen).toHavePathname('/partner');

    await user().press(screen.getByRole('button', { name: 'Partner einladen' }));
    await screen.findByLabelText('Einladungscode 4 8 2 9 1 5');
    // System-Zurück (Geste oder Android-Taste) ist die Navigation zurück im Stapel.
    await act(async () => router.back());
    expect(screen).toHavePathname('/partner');
  });

  it('aus dem Onboarding aufgerufen, kehrt es nach der Kopplung mit „Weiter“ zu Schritt 11 zurück statt zum Schlüpfen', async () => {
    const philipp = await openPhilipp();
    setTestGate('onboarding');
    await renderRouter(appDir, { initialUrl: '/onboarding' });
    await act(async () => router.push('/partner/invite'));
    await screen.findByLabelText('Einladungscode 4 8 2 9 1 5');

    philipp.coupleOnNextPull();
    await act(async () => mockPull());
    await screen.findByRole('header', { name: 'Ihr seid gekoppelt' });

    expect(screen.queryByRole('button', { name: 'Zum Schlüpfen' })).toBeNull();
    await user().press(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen).toHavePathname('/onboarding');
  });
});

describe('partner.redeem', () => {
  async function enter(code: string, typist = user()) {
    await typist.type(await screen.findByLabelText('Einladungscode'), code);
    await typist.press(screen.getByRole('button', { name: 'Weiter' }));
  }

  it('prüft lokal nur Länge und Ziffern, ohne den Server zu fragen', async () => {
    const { flows } = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });
    const field = await screen.findByLabelText('Einladungscode');
    expect(field.props.keyboardType).toBe('number-pad');
    expect(field.props.maxLength).toBe(6);

    // Der Satz steht unter dem Feld; Screenreader hören ihn als Hinweis des Felds.
    const problem = 'Der Code hat genau sechs Ziffern.';
    await enter('48291');
    expect(screen.getByText(problem, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByLabelText('Einladungscode').props.accessibilityHint).toBe(`Fehler: ${problem}`);
    await user().clear(field);
    await enter('48a915');
    expect(screen.getByText(problem, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(flows.calls).toEqual([]);
  });

  it('„Weiter“ prüft den Code, die Bestätigung nennt die einladende Person, „Koppeln“ nimmt an', async () => {
    const philipp = await openPhilipp();
    const { flows } = philipp;
    philipp.coupleOnNextPull();
    flows.respond('checkCode', { type: 'ok', value: { inviterDisplayName: 'Anna', reactivates: false } });
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });

    await enter('048291');
    expect(await screen.findByRole('header', { name: 'Mit Anna koppeln?' })).toBeOnTheScreen();
    expect(screen.queryByText(/Ihr wart schon gekoppelt/)).toBeNull();
    await user().press(screen.getByRole('button', { name: 'Koppeln' }));

    expect(await screen.findByRole('header', { name: 'Ihr seid gekoppelt' })).toBeOnTheScreen();
    expect(screen.getByText('Du und Anna kümmert euch ab jetzt gemeinsam um Momo.')).toBeOnTheScreen();
    expect(flows.calls.map(({ method, code }) => [method, code])).toEqual([['checkCode', '048291'], ['acceptCode', '048291']]);

    await user().press(screen.getByRole('button', { name: 'Zum Schlüpfen' }));
    expect(screen).toHavePathname('/momo');
    expect(screen).toHaveSearchParams({ view: 'rollenwahl' });
  });

  it('nach der Annahme zeigt es „Ihr seid gekoppelt“ erst, wenn der Pull die Kopplung in SQLite gebracht hat', async () => {
    jest.useFakeTimers();
    // Mit Testuhr braucht userEvent den Vorlauf der Timer (https://callstack.github.io/react-native-testing-library/docs/api/events/user-event).
    const typist = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    const philipp = await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });
    await enter('482915', typist);
    await typist.press(await screen.findByRole('button', { name: 'Koppeln' }));

    // Der Sync nach der Annahme brachte noch nichts; die Ansicht wartet und zieht im 10-Sekunden-Takt nach.
    expect(await screen.findByLabelText('Kopplung wird geladen …')).toBeOnTheScreen();
    expect(screen.queryByText('Ihr seid gekoppelt')).toBeNull();
    philipp.coupleOnNextPull();
    await act(async () => jest.advanceTimersByTime(couplingPullIntervalMs));

    expect(await screen.findByRole('header', { name: 'Ihr seid gekoppelt' })).toBeOnTheScreen();
    expect(mockPull).toHaveBeenCalledTimes(2);
  });

  it('zeigt bei reactivates die Reaktivierungsvorschau und danach den Weg zur Insel statt zum Schlüpfen', async () => {
    const philipp = await openPhilipp();
    const { flows } = philipp;
    // Reaktiviert: Die Kopplung kommt mit den Rollen zurück, Momo ist schon geschlüpft (#83).
    philipp.coupleOnNextPull('gekoppelt');
    flows.respond('checkCode', { type: 'ok', value: { inviterDisplayName: 'Anna', reactivates: true } });
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });

    await enter('482915');

    expect(await screen.findByRole('header', { name: 'Mit Anna koppeln?' })).toBeOnTheScreen();
    expect(screen.getByText('Ihr wart schon gekoppelt. Eure Insel und Momo kommen mit euren bisherigen Rollen und Freigaben zurück.')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Koppeln' }));

    expect(await screen.findByRole('header', { name: 'Ihr seid wieder gekoppelt' })).toBeOnTheScreen();
    expect(screen.getByText('Du und Anna: Eure Insel und Momo sind wieder da.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Zum Schlüpfen' })).toBeNull();
    await user().press(screen.getByRole('button', { name: 'Zu eurer Insel' }));
    expect(screen).toHavePathname('/momo');
    expect(screen).toHaveSearchParams({});
  });

  it.each(problemCodes)('„Code prüfen“ mit %s zeigt den generischen, nicht verratenden Text', async (code) => {
    const { flows } = await openPhilipp();
    flows.respond('checkCode', { type: 'rejected', code });
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });

    await enter('482915');

    expect(await screen.findByText('Dieser Code passt nicht. Prüfe ihn oder bitte um einen neuen.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Erneut versuchen' })).toBeNull();
  });

  it.each([
    ...problemCodes.map((code) => [code, 'Dieser Code passt nicht. Prüfe ihn oder bitte um einen neuen.'] as const),
    ['already_coupled', 'Du bist bereits gekoppelt.'],
    ['invite_rate_limited', 'Zu viele Versuche. Bitte später erneut.'],
  ] as const)('„Koppeln“ mit %s zeigt „%s“', async (code, text) => {
    const { flows } = await openPhilipp();
    flows.respond('acceptCode', { type: 'rejected', code });
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });
    await enter('482915');

    await user().press(await screen.findByRole('button', { name: 'Koppeln' }));

    expect(await screen.findByText(text)).toBeOnTheScreen();
    expect(screen.queryByText('Ihr seid gekoppelt')).toBeNull();
  });

  it.each([
    ['already_coupled', 'Du bist bereits gekoppelt.'],
    ['invite_rate_limited', 'Zu viele Versuche. Bitte später erneut.'],
  ] as const)('„Code prüfen“ mit %s zeigt den eigenen Text', async (code, text) => {
    const { flows } = await openPhilipp();
    flows.respond('checkCode', { type: 'rejected', code });
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });

    await enter('482915');

    expect(await screen.findByText(text)).toBeOnTheScreen();
  });

  it('„Anderen Code eingeben“ führt von der Bestätigung zurück zur Eingabe', async () => {
    await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });
    await enter('482915');

    await user().press(await screen.findByRole('button', { name: 'Anderen Code eingeben' }));

    expect(await screen.findByLabelText('Einladungscode')).toBeOnTheScreen();
  });

  it('offline: „Braucht Internet“ mit „Erneut versuchen“ beim Prüfen und beim Koppeln', async () => {
    const philipp = await openPhilipp();
    const { flows } = philipp;
    philipp.coupleOnNextPull();
    flows.respond('checkCode', { type: 'offline' });
    flows.respond('acceptCode', { type: 'offline' });
    await renderRouter(appDir, { initialUrl: '/partner/redeem' });

    await enter('482915');
    expect(await screen.findByText('Braucht Internet')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Erneut versuchen' }));
    await user().press(await screen.findByRole('button', { name: 'Koppeln' }));
    expect(await screen.findByText('Braucht Internet')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Erneut versuchen' }));

    expect(await screen.findByRole('header', { name: 'Ihr seid gekoppelt' })).toBeOnTheScreen();
    const accepts = flows.calls.filter((call) => call.method === 'acceptCode');
    expect(accepts).toHaveLength(2);
    expect(accepts[1]!.requestId).toBe(accepts[0]!.requestId);
  });

  it('„Fertig“ und System-Zurück kehren zum Aufrufer zurück', async () => {
    await openPhilipp();
    await renderRouter(appDir, { initialUrl: '/partner' });
    await user().press(await screen.findByRole('button', { name: 'Code eingeben' }));
    await screen.findByLabelText('Einladungscode');

    await user().press(screen.getByRole('button', { name: 'Fertig' }));
    expect(screen).toHavePathname('/partner');

    await user().press(screen.getByRole('button', { name: 'Code eingeben' }));
    await screen.findByLabelText('Einladungscode');
    await act(async () => router.back());
    expect(screen).toHavePathname('/partner');
  });

  it('aus dem Onboarding aufgerufen, kehrt es nach der Kopplung mit „Weiter“ zu Schritt 11 zurück', async () => {
    const philipp = await openPhilipp();
    philipp.coupleOnNextPull();
    setTestGate('onboarding');
    await renderRouter(appDir, { initialUrl: '/onboarding' });
    await act(async () => router.push('/partner/redeem'));
    await enter('482915');
    await user().press(await screen.findByRole('button', { name: 'Koppeln' }));
    await screen.findByRole('header', { name: 'Ihr seid gekoppelt' });

    expect(screen.queryByRole('button', { name: 'Zum Schlüpfen' })).toBeNull();
    await user().press(screen.getByRole('button', { name: 'Weiter' }));
    expect(screen).toHavePathname('/onboarding');
  });
});
