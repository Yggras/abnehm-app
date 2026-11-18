/// <reference types="expo-router/build/ts-declarations/expect" />
import { act, screen } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { useSyncExternalStore } from 'react';
import { Text } from 'react-native';

import type { AppSession } from '../session/app-session';
import type { SessionGate } from '../session/session-gate';
import type { AppTestClock } from './clock';
import { createFaultController } from './faults';
import { createTestInbox, type TestInbox } from './inbox';
import { parseTestLink } from './links';
import { createNotificationTestControl } from './notifications';
import type { SeedRun } from './seed/seed-flow';
import { notificationNoticeMs, TestCapabilityHost } from './TestCapabilityHost';

// Nachweis für #155: Der Seed-Link öffnet sein Ziel (etwa `ziel=/log`) auch nach der ersten Anmeldung.
// Dort steht die Sitzungs-Weiche erst auf der Anmeldung, und `Stack.Protected` leitet danach von der
// Sitzungsseite nach „Heute“ um; ein früheres Ziel ginge verloren. Den Seed selbst ersetzt ein Stub,
// die Umleitung der Weiche der Test.

jest.mock('./seed/seed-flow', () => ({
  runSeed: async (run: SeedRun) => ({ type: 'geseedet', scenario: run.scenario, installation: 'philipp-iphone', target: run.target }),
}));

let gate: SessionGate | null = 'ohne_sitzung';
const gateListeners = new Set<() => void>();
function setGate(next: SessionGate) {
  gate = next;
  for (const listener of gateListeners) listener();
}

let seed: ((run: SeedRun) => Promise<unknown>) | null = null;
// Fest, damit `useSyncExternalStore` denselben Stand sieht.
const quiet = { type: 'ruhe' } as const;
const inbox: TestInbox = {
  receive() {},
  handleSeeds(handler) {
    seed = handler;
    return () => {};
  },
  status: () => quiet,
  subscribe: () => () => {},
};

function Layout() {
  const current = useSyncExternalStore(
    (listener) => {
      gateListeners.add(listener);
      return () => gateListeners.delete(listener);
    },
    () => gate,
  );
  return (
    <>
      <Slot />
      <TestCapabilityHost inbox={inbox} clock={{} as AppTestClock} notifications={createNotificationTestControl()} session={() => ({}) as AppSession} gate={current} />
    </>
  );
}

const routes = {
  _layout: Layout,
  index: () => <Text>Heute</Text>,
  sitzung: () => <Text>Anmelden</Text>,
  log: () => <Text>Protokoll</Text>,
};

const run: SeedRun = { scenario: 'solo', installation: null, target: { type: 'log' } };

beforeEach(() => {
  gate = 'ohne_sitzung';
  seed = null;
});

test('nach der ersten Anmeldung öffnet der Host das Ziel erst, wenn die Weiche freigibt und die Sitzungsseite verlassen ist', async () => {
  await renderRouter(routes, { initialUrl: '/sitzung' });

  await act(async () => {
    await seed!(run);
  });
  expect(screen).toHavePathname('/sitzung');

  // Die Weiche gibt frei, der Router steht aber noch auf der Sitzungsseite.
  await act(async () => setGate('today'));
  expect(screen).toHavePathname('/sitzung');

  // `Stack.Protected` leitet nach „Heute“ um; danach öffnet der Host das Ziel.
  await act(async () => router.replace('/'));
  expect(screen).toHavePathname('/log');
  expect(screen.getByText('Protokoll')).toBeOnTheScreen();
});

test('bei bestehender Anmeldung öffnet der Host das Ziel sofort, und nur einmal', async () => {
  gate = 'today';
  await renderRouter(routes, { initialUrl: '/' });

  await act(async () => {
    await seed!(run);
  });
  expect(screen).toHavePathname('/log');

  await act(async () => router.replace('/'));
  expect(screen).toHavePathname('/');
});

test('der Stand des Mitteilungs-Ports steht nach dem Link kurz da und gibt dann den Kopf der Seite frei (#125)', async () => {
  jest.useFakeTimers();
  try {
    const notifications = createNotificationTestControl();
    const realInbox = createTestInbox({ faults: createFaultController(), clock: {} as AppTestClock, notifications, deviceSuite: () => Promise.reject(new Error('nicht im Test')), health: { apply: () => Promise.resolve(null) } });
    await renderRouter(
      {
        _layout: () => (
          <>
            <Slot />
            <TestCapabilityHost inbox={realInbox} clock={{} as AppTestClock} notifications={notifications} session={() => ({}) as AppSession} gate="today" />
          </>
        ),
        index: () => <Text>Heute</Text>,
      },
      { initialUrl: '/' },
    );

    await act(async () => realInbox.receive(parseTestLink('abnehmapp-dev://mitteilungen?erlaubnis=system')!));
    expect(screen.getByText('Mitteilungen: echter Port des Systems.')).toBeOnTheScreen();

    await act(async () => jest.advanceTimersByTime(notificationNoticeMs));
    expect(screen.queryByText('Mitteilungen: echter Port des Systems.')).not.toBeOnTheScreen();
  } finally {
    jest.useRealTimers();
  }
});
