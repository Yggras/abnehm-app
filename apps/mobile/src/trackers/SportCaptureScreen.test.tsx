import { act, screen, userEvent, within } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';

import { ClockProvider } from '../clock/clock-context';
import { routeScreen } from '../navigation';
import { MessageHostProvider, MessageSlot } from '../shell/MessageHost';
import { appTrackers } from './app-trackers';
import { berlin, createTrackerWorld, noon, type TrackerWorld } from './testing/tracker-world';
import { SportCaptureScreen } from './SportCaptureScreen';

// Nachweis für #173: Die Route `capture.sport` mit `newEntry: true` öffnet direkt das Formular „+ Einheit“,
// wie „+ Einheit“ auf dem Mini-Tracker und „Sport“ im ＋-Sheet, mit dem Tracker-Modul des geöffneten
// Kontos (`appTrackers`). Nach dem Speichern kehrt der modale Ablauf zum Aufrufer zurück, und die Meldung
// mit „Rückgängig“ erscheint dort.

jest.mock('../design/native/DateTimePicker', () => jest.requireActual('../design/testing/text-date-time-picker'));

const user = userEvent.setup();
const clock = createTestClock({ instant: noon, timeZone: berlin });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function open({ opened = true } = {}) {
  const world: TrackerWorld = await createTrackerWorld(clock);
  cleanups.push(() => world.close());
  if (opened) cleanups.push(appTrackers.opened(world.trackers));
  const Layout = () => (
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <Slot />
        <MessageSlot />
      </MessageHostProvider>
    </ClockProvider>
  );
  await renderRouter(
    { _layout: Layout, index: () => null, 'capture/sport': routeScreen('capture.sport', SportCaptureScreen) },
    { initialUrl: '/' },
  );
  return world;
}

test('newEntry öffnet das Formular; Speichern trägt ein, schließt und zeigt die Meldung mit „Rückgängig“', async () => {
  const world = await open();
  await act(() => router.push({ pathname: '/capture/sport', params: { newEntry: 'true' } }));

  expect(screen.getByRole('header', { name: 'Sport' })).toBeOnTheScreen();
  await user.press(screen.getByRole('radio', { name: 'Gehen' }));
  await user.press(screen.getByRole('radio', { name: '45 min' }));
  await user.press(screen.getByRole('button', { name: 'Speichern' }));

  expect(world.sports()).toEqual([expect.objectContaining({ activityType: 'gehen', durationMinutes: 45 })]);
  expect(screen).toHavePathname('/');
  expect(within(screen.getByTestId('message-slot')).getByText('45 min Gehen eingetragen')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeOnTheScreen();
});

test('Tipps erreichen „Speichern“ auch bei offener Tastatur, statt sie nur zu schließen (Impeccable-Kritik)', async () => {
  await open();
  await act(() => router.push({ pathname: '/capture/sport', params: { newEntry: 'true' } }));

  // https://reactnative.dev/docs/scrollview#keyboardshouldpersisttaps
  expect(screen.getByTestId('screen-scroll').props.keyboardShouldPersistTaps).toBe('handled');
});

test('ohne newEntry zeigt die Route die Wochenübersicht (#174); ohne ihr Lesemodell lädt sie', async () => {
  await open();
  await act(() => router.push('/capture/sport'));

  expect(screen.queryByText(/Kommt mit/)).not.toBeOnTheScreen();
  expect(screen.queryByLabelText('Dauer')).not.toBeOnTheScreen();
  expect(screen.getByText('Sport lädt …')).toBeOnTheScreen();
});

test('lädt, solange kein Konto geöffnet ist', async () => {
  await open({ opened: false });
  await act(() => router.push({ pathname: '/capture/sport', params: { newEntry: 'true' } }));

  expect(screen.queryByLabelText('Dauer')).not.toBeOnTheScreen();
  expect(screen.getByText('Sport lädt …')).toBeOnTheScreen();
});
