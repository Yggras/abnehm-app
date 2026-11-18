/**
 * @jest-environment ./jest/skia-environment.js
 */
import { act, screen, userEvent, within } from '@testing-library/react-native';
import { router } from 'expo-router';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant, TimeZone } from '@abnehm/contracts/base';

import { fieldOnScreen, glowing, openIslandScreen, selected, tap } from './testing/island-screen';
import type { LaichkugelWorld } from './testing/laichkugel-world';
import type * as mockSkia from './testing/skia-mock';

// Nachweis für #194: Objekt-Sheet, Umstellen und Lager im Tab „Momo“ auf echter SQLite mit dem echten
// Spieldienst (Spezifikation 4, Abschnitt 7). Philipp hat Bauen, also Seite a der Grundinsel mit 60 eigenen
// Feldern: Ecke x 0–3 und y 0–4, Rollenbereich unter anderem x 0–5 und y 5–9; Anna hat Seite b. Die Insel
// zeichnet der echte Skia-Code (CanvasKit), das native Sheet ersetzt der Test-Adapter `inline-sheet`.
jest.mock('@shopify/react-native-skia', () => jest.requireActual<typeof mockSkia>('./testing/skia-mock').skiaWithCanvasKit());
jest.mock('../design/native/Sheet', () => jest.requireActual('../design/testing/inline-sheet'));

const user = userEvent.setup();
const clock = createTestClock({ instant: Instant.parse('2026-10-14T12:00:00.000Z'), timeZone: TimeZone.parse('Europe/Berlin') });
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const ownCorner = fieldOnScreen(2, 2);
const ownRoleArea = fieldOnScreen(4, 6);
const partnerCorner = fieldOnScreen(12, 0);

/** Die Insel mit Philipps Laterne in seiner Ecke (`grundinsel:2:2`), gebaut über den Spieldienst. */
async function islandWithLantern(energy: number, arrange?: (world: LaichkugelWorld) => void) {
  return openIslandScreen(clock, cleanups, {
    energy,
    arrange(world) {
      expect(world.game.build({ fieldId: world.fieldId('grundinsel:2:2'), blueprintKey: 'laterne' })).toMatchObject({ type: 'gebaut' });
      arrange?.(world);
    },
  });
}

const commands = (world: LaichkugelWorld) =>
  world.operations().flatMap((operation) => ('businessKey' in operation ? [{ type: operation.type, payload: operation.payload }] : []));
const ownHalf = () => screen.getByRole('progressbar', { name: 'Level 1' }).props.accessibilityValue.text;
const islandImage = (ownObjects: number) => screen.getByRole('image', { name: `Momos Insel, Level 1, ${ownObjects} eigene Objekte` });

test('Tracer Bullet: Laterne auf Stufe 2 aufwerten, umstellen, einlagern und aus dem Lager wieder platzieren', async () => {
  // 12 Energie: Laterne 3, dann 9 übrig; Stufe 2 kostet 6.
  const world = await islandWithLantern(12);
  expect(ownHalf()).toBe('Deine Hälfte zu 27 Prozent gefüllt');

  await tap(ownCorner);
  expect(screen.getByRole('header', { name: 'Laterne' })).toBeOnTheScreen();
  expect(screen.getByText('Stufe 1')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Auf Stufe 2 aufwerten · 6 Energie' }));

  expect(screen.queryByTestId('sheet')).toBeNull();
  expect(screen.getByLabelText('3 Energie')).toBeOnTheScreen();
  // 3 + 6 von Bedarf(1) = 11: 81 Prozent, abgerundet.
  expect(ownHalf()).toBe('Deine Hälfte zu 81 Prozent gefüllt');

  await tap(ownCorner);
  expect(screen.getByText('Stufe 2')).toBeOnTheScreen();
  // Stufe 3 kostet das 3-Fache; was fehlt, steht neutral da, ohne Knopf.
  expect(screen.getByText('Stufe 3 kostet 9 Energie. Noch 6 Energie')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: /aufwerten/ })).toBeNull();
  await user.press(screen.getByRole('button', { name: 'Umstellen' }));

  // Wie beim Bauen leuchten die freien eigenen Felder; das der Laterne selbst nicht.
  expect(screen.getByText('Laterne umstellen')).toBeOnTheScreen();
  expect(glowing()).toHaveLength(59);
  await tap(ownRoleArea);
  expect(glowing()).toHaveLength(0);
  expect(islandImage(1)).toBeOnTheScreen();

  await tap(ownRoleArea);
  await user.press(screen.getByRole('button', { name: 'Einlagern' }));
  expect(islandImage(0)).toBeOnTheScreen();
  // Die verbaute Energie bleibt der Insel, auch im Lager.
  expect(ownHalf()).toBe('Deine Hälfte zu 81 Prozent gefüllt');

  await user.press(screen.getByRole('button', { name: 'Lager' }));
  expect(screen.getByRole('header', { name: 'Lager' })).toBeOnTheScreen();
  const row = within(screen.getByTestId('lager'));
  expect(row.getByText('Laterne')).toBeOnTheScreen();
  expect(row.getByText('Gebaut · Stufe 2')).toBeOnTheScreen();
  await user.press(screen.getByRole('button', { name: 'Laterne platzieren' }));

  expect(screen.getByText('Laterne platzieren')).toBeOnTheScreen();
  expect(glowing()).toHaveLength(60);
  await tap(ownCorner);
  expect(islandImage(1)).toBeOnTheScreen();
  expect(screen.getByLabelText('3 Energie')).toBeOnTheScreen();

  const fieldId = (key: string) => world.fieldId(key);
  const laterne = commands(world)[0]!.payload.islandObjectId;
  expect(commands(world).map(({ type, payload }) => ({ type, ...('target' in payload ? { target: payload.target } : {}), ...('toLevel' in payload ? { toLevel: payload.toLevel } : {}) }))).toEqual([
    { type: 'buildObject' },
    { type: 'upgradeObject', toLevel: 2 },
    { type: 'placeObject', target: { type: 'feld', fieldId: fieldId('grundinsel:4:6') } },
    { type: 'placeObject', target: { type: 'lager' } },
    { type: 'placeObject', target: { type: 'feld', fieldId: fieldId('grundinsel:2:2') } },
  ]);
  expect(commands(world).every(({ payload }) => payload.islandObjectId === laterne)).toBe(true);
});

test('ein Objekt des Partners zeigt nur, wer es gebaut hat, und die Stufe', async () => {
  await islandWithLantern(3, (world) => void world.objectOnServer({ owner: 'anna', fieldKey: 'grundinsel:12:0', catalogKey: 'apfelbaum', level: 2 }));

  await tap(partnerCorner);

  expect(screen.getByRole('header', { name: 'Apfelbaum' })).toBeOnTheScreen();
  expect(screen.getByText('von Anna gebaut · Stufe 2')).toBeOnTheScreen();
  expect(within(screen.getByTestId('sheet')).queryAllByRole('button')).toEqual([]);
});

test('Lager: verdrängte Objekte stehen dort mit „Platzieren“; ohne passendes freies Feld steht das neutral da', async () => {
  // Ein Apfelbaum (Natur) darf nur in Philipps Ecke; dort sind alle 20 Felder belegt.
  await openIslandScreen(clock, cleanups, {
    energy: 0,
    arrange(world) {
      for (let x = 0; x <= 3; x++) for (let y = 0; y <= 4; y++) world.objectOnServer({ owner: 'philipp', fieldKey: `grundinsel:${x}:${y}`, catalogKey: 'holzweg' });
      world.objectOnServer({ owner: 'philipp', fieldKey: null, catalogKey: 'apfelbaum', level: 3 });
      world.objectOnServer({ owner: 'philipp', fieldKey: null, catalogKey: 'laterne' });
    },
  });

  await user.press(screen.getByRole('button', { name: 'Lager' }));

  const list = within(screen.getByTestId('lager'));
  expect(list.getByText('Apfelbaum')).toBeOnTheScreen();
  expect(list.getByText('Gebaut · Stufe 3')).toBeOnTheScreen();
  expect(list.getByText('Kein passendes Feld frei')).toBeOnTheScreen();
  expect(list.queryByRole('button', { name: 'Apfelbaum platzieren' })).toBeNull();
  expect(list.getByRole('button', { name: 'Laterne platzieren' })).toBeOnTheScreen();
});

test('ein leeres Lager sagt, was dort landet; die Route `momo` mit `view: lager` öffnet es', async () => {
  await openIslandScreen(clock, cleanups, { energy: 0 });

  await act(() => router.navigate({ pathname: '/momo', params: { view: 'lager' } }));

  expect(screen.getByRole('header', { name: 'Lager' })).toBeOnTheScreen();
  expect(screen.getByText('Dein Lager ist leer. Was du einlagerst oder geschenkt bekommst, wartet hier.')).toBeOnTheScreen();
});

test('Abbrechen beim Umstellen lässt das Objekt stehen', async () => {
  const world = await islandWithLantern(3);
  await tap(ownCorner);
  await user.press(screen.getByRole('button', { name: 'Umstellen' }));

  await user.press(screen.getByRole('button', { name: 'Abbrechen' }));

  expect(glowing()).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Bauen' })).toBeOnTheScreen();
  expect(commands(world).map(({ type }) => type)).toEqual(['buildObject']);
});

test('nach dem Platzieren bleibt das frühere Feld nicht hervorgehoben', async () => {
  await islandWithLantern(3);
  await tap(ownCorner);
  expect(selected()).toHaveLength(1);
  await user.press(screen.getByRole('button', { name: 'Einlagern' }));
  await user.press(screen.getByRole('button', { name: 'Lager' }));
  await user.press(screen.getByRole('button', { name: 'Laterne platzieren' }));

  await tap(ownRoleArea);

  // Die Auswahl gehörte zur Laterne; nach dem Platzieren markierte sie ein leeres Feld neben dem Objekt.
  expect(islandImage(1)).toBeOnTheScreen();
  expect(selected()).toHaveLength(0);
});
