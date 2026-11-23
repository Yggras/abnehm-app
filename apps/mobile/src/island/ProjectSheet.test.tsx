/**
 * @jest-environment ./jest/skia-environment.js
 */
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { openIslandScreen } from './testing/island-screen';
import type { LaichkugelWorld } from './testing/laichkugel-world';
import type * as mockSkia from './testing/skia-mock';

// Nachweis für #208: das Projekt-Sheet im Tab „Momo“ auf echter SQLite mit dem echten Spieldienst (Spezifikation 4,
// Abschnitt 8). Philipp hat Bauen; Projekt 1 ist das Gartenhäuschen mit 20 Bedarf je Anteil. Die Insel zeichnet der
// echte Skia-Code (CanvasKit), das native Sheet ersetzt der Test-Adapter `inline-sheet`.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const user = userEvent.setup();
const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const contributions = (world: LaichkugelWorld) =>
  world.operations().flatMap((operation) => (operation.type === 'contributeToProject' ? [operation.payload.amount] : []));
const ownHalf = () => screen.getByRole('progressbar', { name: 'Level 1' }).props.accessibilityValue.text;

async function openProject() {
  await user.press(screen.getByRole('button', { name: 'Projekt' }));
  expect(screen.getByRole('header', { name: 'Gartenhäuschen' })).toBeOnTheScreen();
}

test('Tracer Bullet: in den eigenen Anteil einzahlen und den gemeinsamen Fortschritt nur als Stufe sehen', async () => {
  const world = await openIslandScreen(clock, cleanups, { energy: 12 });
  await openProject();

  expect(screen.getByText('Gemeinschaftsprojekt')).toBeOnTheScreen();
  expect(screen.getByText('Gemeinsam: gestartet')).toBeOnTheScreen();
  expect(screen.getByText('Dein Anteil: 0 von 20')).toBeOnTheScreen();
  // Vorgeschlagen ist, was geht: die ganze Energie, höchstens der Restbedarf.
  expect(screen.getByLabelText('Betrag: 12 Energie')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Betrag verringern' }));
  await user.press(screen.getByRole('button', { name: 'Betrag verringern' }));
  await user.press(screen.getByRole('button', { name: '10 Energie einzahlen' }));

  expect(contributions(world)).toEqual([10]);
  expect(screen.getByText('10 Energie eingezahlt')).toBeOnTheScreen();
  expect(screen.getByText('Dein Anteil: 10 von 20')).toBeOnTheScreen();
  expect(screen.getByLabelText('Betrag: 2 Energie')).toBeOnTheScreen();
  // Die Einzahlung füllt sofort die eigene Hälfte: 10 von 11.
  expect(screen.getByLabelText('2 Energie')).toBeOnTheScreen();
  expect(ownHalf()).toBe('Deine Hälfte zu 90 Prozent gefüllt');
  // Die gemeinsame Stufe kommt erst mit dem Sync; exakte Partnerwerte gibt es nie.
  expect(screen.getByText('Gemeinsam: gestartet')).toBeOnTheScreen();
  const sheet = within(screen.getByTestId('sheet'));
  expect(sheet.queryByText(/Anna/)).toBeNull();
  expect(sheet.queryByText(/fehlt/)).toBeNull();
});

test('ein voller Anteil zeigt „Dein Anteil ist voll“ ohne Einzahlen', async () => {
  const world = await openIslandScreen(clock, cleanups, { energy: 24 });
  await openProject();
  expect(screen.getByLabelText('Betrag: 20 Energie')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: '20 Energie einzahlen' }));

  expect(contributions(world)).toEqual([20]);
  expect(screen.getByText('Dein Anteil ist voll')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /einzahlen/ })).toBeNull();
});

test('ohne Energie steht neutral, woher neue kommt, statt eines Knopfs; die Route `momo` mit `view: projekt` öffnet das Sheet', async () => {
  await openIslandScreen(clock, cleanups, { energy: 0 });
  await act(() => router.navigate({ pathname: '/momo', params: { view: 'projekt' } }));

  expect(screen.getByRole('header', { name: 'Gartenhäuschen' })).toBeOnTheScreen();
  expect(screen.getByText('Gerade hast du keine Energie. Erfüllte Tagesziele bringen neue.')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /einzahlen/ })).toBeNull();
});
