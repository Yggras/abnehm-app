import { screen, userEvent } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';

import { Instant, TimeZone } from '@abnehm/contracts/base';
import { createTestClock } from '@abnehm/clock/testing';

import { ClockProvider } from '../clock/clock-context';
import StartScreen from './StartScreen';

const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as typeof fetch;
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function renderStart() {
  const clock = createTestClock({
    instant: Instant.parse('2026-10-14T22:30:00.000Z'),
    timeZone: TimeZone.parse('Europe/Berlin'),
  });
  const Layout = () => (
    <ClockProvider clock={clock}>
      <Slot />
    </ClockProvider>
  );
  await renderRouter({ _layout: Layout, index: StartScreen }, { initialUrl: '/' });
}

test('zeigt die Datenbankzeit, die das Backend nach seiner Postgres-Abfrage liefert', async () => {
  fetchMock.mockResolvedValue(json({ type: 'ok', databaseTime: '2026-10-14T22:29:59.512Z' }, 200));

  await renderStart();

  expect(await screen.findByText('Backend und Datenbank erreichbar')).toBeOnTheScreen();
  expect(screen.getByText('Datenbankzeit: 2026-10-14T22:29:59.512Z')).toBeOnTheScreen();
  expect(screen.getByText('Adresse: http://localhost:8787')).toBeOnTheScreen();
  const [url] = fetchMock.mock.calls[0] ?? [];
  expect(String(url)).toBe('http://localhost:8787/v1/status');
});

test('zeigt Zeitpunkt, Zeitzone und lokalen Tag aus der Uhr', async () => {
  fetchMock.mockResolvedValue(json({ type: 'ok', databaseTime: '2026-10-14T22:29:59.512Z' }, 200));

  await renderStart();

  expect(await screen.findByText('Lokaler Tag: 2026-10-15')).toBeOnTheScreen();
  expect(screen.getByText('Zeitzone: Europe/Berlin')).toBeOnTheScreen();
  expect(screen.getByText('Zeitpunkt: 2026-10-14T22:30:00.000Z')).toBeOnTheScreen();
});

test('unterscheidet eine fehlende Datenbank von einem unerreichbaren Backend', async () => {
  fetchMock.mockResolvedValueOnce(json({ type: 'database_unavailable' }, 503));
  fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));

  await renderStart();
  expect(await screen.findByText('Backend erreichbar, Datenbank nicht')).toBeOnTheScreen();

  await userEvent.press(screen.getByRole('button', { name: 'Erneut prüfen' }));
  expect(await screen.findByText('Backend nicht erreichbar')).toBeOnTheScreen();
});

test('meldet eine Antwort, die nicht dem Vertrag entspricht', async () => {
  fetchMock.mockResolvedValue(json({ type: 'ok', databaseTime: 'gestern' }, 200));

  await renderStart();

  expect(await screen.findByText('Unerwartete Antwort vom Backend')).toBeOnTheScreen();
});
