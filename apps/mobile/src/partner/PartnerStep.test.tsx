/// <reference types="expo-router/build/ts-declarations/expect" />
import { randomUUID } from 'node:crypto';

import { notifyManager } from '@tanstack/react-query';
import { act, screen, userEvent } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter, testRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';
import { EntityId, Instant, TimeZone, type SyncCursor } from '@abnehm/contracts/base';
import { seedClock, seedManifests } from '@abnehm/contracts/seeds';

import PartnerInvite from '../app/partner/invite';
import PartnerRedeem from '../app/partner/redeem';
import { ClockProvider } from '../clock/clock-context';
import type { LocalDatabase } from '../local-db';
import { createLocalDatabases } from '../local-db/local-databases';
import { createBetterSqliteFiles } from '../local-db/testing/better-sqlite';
import { OnlineFlowsProvider } from '../online/OnlineFlowsProvider';
import { fakeInvitationFlows, type FakeInvitationFlows } from '../online/testing/fake-invitation-flows';
import { setTestGate } from '../session/testing/test-gate';
import { MessageHostProvider } from '../shell/MessageHost';
import { OnboardingStep } from '../shell/OnboardingStep';
import { createOnboardingRegistry } from '../shell/onboarding-registry';
import { SyncRefreshProvider } from '../shell/SyncRefresh';
import { createSyncEngine, createSyncRegistry, createSyncWriter, foundationSyncEntities, type SyncTransport } from '../sync';
import { pendingOperations } from '../sync/outbox';
import { seedLocalDatabase } from '../test-capabilities/seed/local-seed';
import { appPartner, createPartner, encouragementEntity } from '.';
import { PartnerStep } from './PartnerStep';

// Onboarding-Schritt 11 `partner` (#129; Spezifikation 5, Abschnitt 5) über den Steckplatz der Onboarding-Registry
// aus #110, mit den echten modalen Abläufen `partner.invite` und `partner.redeem` aus `src/app`, dem Online-Test-
// Adapter der Einladungsabläufe (#103) und dem echten Partnerbereich über einer geseedeten SQLite-Datei. Die
// Sitzungs-Weiche steht auf `onboarding`: Die Abläufe kehren dann zum Schritt zurück. Die Shell prüft jedes gemeldete
// Ergebnis gegen den Vertrag.

jest.setTimeout(30_000);
jest.mock('../session/use-session-gate', () => jest.requireActual('../session/testing/test-gate'));

// TanStack bündelt Benachrichtigungen standardmäßig per `setTimeout(0)`, also außerhalb von `act`
// (https://tanstack.com/query/v5/docs/reference/notifyManager); im Test geht jede sofort an React.
beforeAll(() => notifyManager.setScheduler((callback) => callback()));
afterAll(() => notifyManager.setScheduler((callback) => setTimeout(callback, 0)));

const cleanups: (() => void)[] = [];
beforeEach(() => setTestGate('onboarding'));
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  setTestGate('today');
});

const start = { instant: Instant.parse(seedClock.instant), timeZone: TimeZone.parse(seedClock.timeZone) };
const user = () => userEvent.setup();

/**
 * Philipps iPhone im Onboarding mit Seed `scenario`. Ein Pull des Tests bringt nichts, bis `coupleOnNextPull` die neue
 * Kopplung aus `rollenwahl-offen` bereitlegt, wie ein echter Pull nach Annas Annahme. Die gelungene Annahme stößt wie
 * das echte Modul (`invitation-flows.ts`) danach einen Sync an.
 */
async function openStep(scenario: 'solo' | 'gekoppelt' = 'solo') {
  const clock = createTestClock(start);
  const newId = () => EntityId.parse(randomUUID());
  const files = createBetterSqliteFiles();
  const databases = createLocalDatabases({ openSqlite: files.openSqlite, onError: (error) => { throw error; } });
  const database: LocalDatabase = await databases.open('konto_a');
  seedLocalDatabase(database, seedManifests[scenario], 'philipp-iphone');
  let couple = false;
  const pull = async () => {
    if (couple) seedLocalDatabase(database, seedManifests['rollenwahl-offen'], 'philipp-iphone');
  };
  const flows: FakeInvitationFlows = fakeInvitationFlows();
  const acceptCode = flows.acceptCode;
  flows.acceptCode = async (requestId, code) => {
    const result = await acceptCode(requestId, code);
    if (result.type === 'ok') await pull();
    return result;
  };
  const transport: SyncTransport = {
    push: async () => ({ type: 'unavailable' }),
    pull: async () => ({ type: 'ok', body: { changes: [], next: { type: 'complete', cursor: '1' as SyncCursor } } }),
  };
  const registry = createSyncRegistry([...foundationSyncEntities, encouragementEntity]);
  const engine = createSyncEngine({ database, registry, transport, clock, installationId: newId() });
  const partner = createPartner({
    database, clock, sync: () => engine.sync(), writer: createSyncWriter({ registry, clock, newId }), newId,
    observeOnline: () => () => {},
    refresh: () => () => {},
  });
  const release = appPartner.opened(partner);
  cleanups.push(() => {
    release();
    databases.lock();
    files.remove();
  });

  const steps = createOnboardingRegistry();
  steps.register('partner', 'partner', PartnerStep);
  const onComplete = jest.fn();
  function Layout() {
    return (
      <ClockProvider clock={clock}>
        <MessageHostProvider>
          <SyncRefreshProvider refresh={pull}>
            <OnlineFlowsProvider invitations={flows} newId={newId}>
              <Stack screenOptions={{ headerShown: false }} />
            </OnlineFlowsProvider>
          </SyncRefreshProvider>
        </MessageHostProvider>
      </ClockProvider>
    );
  }
  function Onboarding() {
    return <OnboardingStep stepKey="partner" onComplete={onComplete} registry={steps} />;
  }
  await renderRouter(
    { _layout: Layout, index: Onboarding, 'partner/invite': PartnerInvite, 'partner/redeem': PartnerRedeem },
    { initialUrl: '/' },
  );
  return {
    flows,
    onComplete,
    coupleOnNextPull() {
      couple = true;
    },
    operations: () => database.read((tx) => pendingOperations(tx, 100)),
  };
}

describe('Onboarding-Schritt „partner“', () => {
  it('solo: „Partner einladen“ und „Code eingeben“, noch ohne „Weiter“', async () => {
    const { onComplete } = await openStep();

    expect(await screen.findByRole('button', { name: 'Partner einladen' })).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Code eingeben' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Weiter' })).not.toBeOnTheScreen();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('„Partner einladen“ öffnet `partner.invite` und kehrt zurück; wurde nur ein Code erzeugt, meldet „Weiter“ `partner_invite_created`', async () => {
    const { onComplete } = await openStep();

    await user().press(await screen.findByRole('button', { name: 'Partner einladen' }));
    expect(screen).toHavePathname('/partner/invite');
    expect(await screen.findByLabelText('Einladungscode 4 8 2 9 1 5')).toBeOnTheScreen();
    await act(() => testRouter.back());

    expect(screen).toHavePathname('/');
    await user().press(await screen.findByRole('button', { name: 'Weiter' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ type: 'partner_invite_created' });
  });

  it('scheitert das Erzeugen offline, gibt es kein „Weiter“; der Schritt bleibt beim Einladen', async () => {
    const { flows, onComplete } = await openStep();
    flows.respond('createCode', { type: 'offline' });

    await user().press(await screen.findByRole('button', { name: 'Partner einladen' }));
    expect(await screen.findByText('Braucht Internet')).toBeOnTheScreen();
    await act(() => testRouter.back());

    expect(await screen.findByRole('button', { name: 'Partner einladen' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Weiter' })).not.toBeOnTheScreen();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('„Code eingeben“ → gekoppelt → zurück zum Schritt: vier Partnerfreigaben und Fotofreigabe mit Startwerten; „Weiter“ meldet `partner_coupled`', async () => {
    const step = await openStep();
    step.coupleOnNextPull();

    await user().press(await screen.findByRole('button', { name: 'Code eingeben' }));
    expect(screen).toHavePathname('/partner/redeem');
    await user().type(await screen.findByLabelText('Einladungscode'), '482915');
    await user().press(screen.getByRole('button', { name: 'Weiter' }));
    await user().press(await screen.findByRole('button', { name: 'Koppeln' }));
    // Aus dem Onboarding führt „Weiter“ zurück zu Schritt 11 statt zum Schlüpfen.
    await user().press(await screen.findByRole('button', { name: 'Weiter' }));

    expect(screen).toHavePathname('/');
    for (const name of ['Ernährung', 'Wasser', 'Sport', 'Gewicht', 'Mahlzeitenfotos teilen']) {
      expect(await screen.findByRole('switch', { name })).toBeChecked();
    }
    expect(screen.getByText('Nur Trend und Veränderung, nie dein absolutes Gewicht')).toBeOnTheScreen();
    await user().press(screen.getByRole('button', { name: 'Weiter' }));
    expect(step.onComplete).toHaveBeenCalledWith({ type: 'partner_coupled' });
  });

  it('gekoppelt: dieselben Schalter wie „Partner & Freigaben“ ändern die Freigabe sofort; „Weiter“ meldet `partner_coupled`', async () => {
    const step = await openStep('gekoppelt');

    await user().press(await screen.findByRole('switch', { name: 'Mahlzeitenfotos teilen' }));
    expect(await screen.findByRole('switch', { name: 'Mahlzeitenfotos teilen' })).not.toBeChecked();
    expect(step.operations()).toEqual([expect.objectContaining({ entityType: 'photo_sharing', payload: { level: 'privat' } })]);
    expect(screen.queryByRole('button', { name: 'Partner einladen' })).not.toBeOnTheScreen();

    await user().press(screen.getByRole('button', { name: 'Weiter' }));
    expect(step.onComplete).toHaveBeenCalledTimes(1);
    expect(step.onComplete).toHaveBeenCalledWith({ type: 'partner_coupled' });
  });
});
