import { act, screen, userEvent, within } from '@testing-library/react-native';
import { router, Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { createTestClock } from '@abnehm/clock/testing';

import { ClockProvider } from '../clock/clock-context';
import { routeScreen } from '../navigation';
import { MessageHostProvider, MessageSlot } from '../shell/MessageHost';
import { screenScrollId } from '../shell/ScreenFrame';
import { appTrackers } from './app-trackers';
import { berlin, createTrackerWorld, noon, type TrackerWorld } from './testing/tracker-world';
import { WeightCaptureScreen } from './WeightCaptureScreen';

// Nachweis für #175: Die Route `capture.weight` mit `newEntry: true` öffnet direkt das Formular für
// einen neuen Eintrag, mit dem Tracker-Modul des geöffneten Kontos (`appTrackers`). Nach dem Speichern
// kehrt der modale Ablauf zum Aufrufer zurück, und die Meldung mit „Rückgängig“ erscheint dort.

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
    { _layout: Layout, index: () => null, 'capture/weight': routeScreen('capture.weight', WeightCaptureScreen) },
    { initialUrl: '/' },
  );
  return world;
}

test('newEntry öffnet das Formular; Speichern trägt ein, schließt und zeigt die Meldung mit „Rückgängig“', async () => {
  const world = await open();
  await act(() => router.push({ pathname: '/capture/weight', params: { newEntry: 'true' } }));

  expect(screen.getByRole('header', { name: 'Gewicht' })).toBeOnTheScreen();
  await user.type(screen.getByLabelText('Gewicht'), '91,8');
  await user.press(screen.getByRole('button', { name: 'Speichern' }));

  expect(world.weights()).toEqual([expect.objectContaining({ weightG: 91_800 })]);
  expect(screen).toHavePathname('/');
  expect(within(screen.getByTestId('message-slot')).getByText('91,8 kg eingetragen')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeOnTheScreen();
});

test('Tipps erreichen „Speichern“ auch bei offener Tastatur, statt sie nur zu schließen (Impeccable-Kritik)', async () => {
  await open();
  await act(() => router.push({ pathname: '/capture/weight', params: { newEntry: 'true' } }));

  // https://reactnative.dev/docs/scrollview#keyboardshouldpersisttaps
  expect(screen.getByTestId(screenScrollId).props.keyboardShouldPersistTaps).toBe('handled');
});

test('ohne newEntry lädt der Detailbildschirm (#176), solange sein Lesemodell nicht angemeldet ist', async () => {
  await open();
  await act(() => router.push('/capture/weight'));

  expect(screen.queryByLabelText('Gewicht')).not.toBeOnTheScreen();
  expect(screen.getByText('Gewicht lädt …')).toBeOnTheScreen();
});

test('lädt, solange kein Konto geöffnet ist', async () => {
  await open({ opened: false });
  await act(() => router.push({ pathname: '/capture/weight', params: { newEntry: 'true' } }));

  expect(screen.queryByLabelText('Gewicht')).not.toBeOnTheScreen();
  expect(screen.getByText('Gewicht lädt …')).toBeOnTheScreen();
});
