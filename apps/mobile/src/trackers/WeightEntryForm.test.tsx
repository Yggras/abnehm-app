import { act, fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant } from '@abnehm/contracts/base';

import { ClockProvider } from '../clock/clock-context';
import { hitArea } from '../design/testing/hit-area';
import { MessageHostProvider, MessageSlot } from '../shell/MessageHost';
import { berlin, createTrackerWorld, noon, type TrackerWorld } from './testing/tracker-world';
import { WeightEntryForm } from './WeightEntryForm';

// Nachweis für #175 am gerenderten Formular (Spezifikation 3, Abschnitte 3–5): Das letzte Tagesgewicht
// ist vorausgefüllt, der Messzeitpunkt ist „jetzt“ und änderbar. Weicht die Eingabe um mehr als 2 kg
// ab, fragt das Formular inline „Tippfehler?“ mit „Stimmt so“ und „Korrigieren“, ohne Systemdialog.
// Gespeichert wird über das echte Tracker-Modul auf echtem SQLite; danach kommt die Meldung mit
// „Rückgängig“ über den Meldungs-Host.

jest.mock('../design/native/DateTimePicker', () => jest.requireActual('../design/testing/text-date-time-picker'));

const user = userEvent.setup();
const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

async function renderForm({ lastWeighings = [[91_800, '2026-10-13T05:45:00.000Z']] as readonly (readonly [number, string])[] } = {}) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world = await createTrackerWorld(clock);
  worlds.push(world);
  for (const [weightG, at] of lastWeighings) world.trackers.recordWeight({ weightG, measuredAt: Instant.parse(at) });
  const before = world.weights().length;
  const onSaved = jest.fn();
  await render(
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <WeightEntryForm trackers={world.trackers} onSaved={onSaved} />
        <MessageSlot />
      </MessageHostProvider>
    </ClockProvider>,
  );
  const added = () => world.weights().slice(before);
  return { ...world, onSaved, added };
}

const field = () => screen.getByLabelText('Gewicht');
const save = () => user.press(screen.getByRole('button', { name: 'Speichern' }));

async function enter(text: string) {
  await user.clear(field());
  await user.type(field(), text);
}

test('füllt das letzte Tagesgewicht vor und speichert es mit dem Messzeitpunkt „jetzt“', async () => {
  const { added, onSaved } = await renderForm({
    lastWeighings: [[92_400, '2026-10-12T05:30:00.000Z'], [91_800, '2026-10-13T05:45:00.000Z'], [92_300, '2026-10-13T19:00:00.000Z']],
  });

  expect(field()).toHaveDisplayValue('91,8');
  // Sichtbar beschriftet: Ohne „Gemessen am“ stünden Datum und Uhrzeit ohne Bezug da (Impeccable-Kritik).
  expect(screen.getByText('Gemessen am')).toBeOnTheScreen();
  expect(screen.getByLabelText('Gemessen am')).toHaveDisplayValue(noon);

  await save();

  expect(added()).toEqual([expect.objectContaining({ weightG: 91_800, measuredAt: noon, localDate: '2026-10-14' })]);
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(within(screen.getByTestId('message-slot')).getByText('91,8 kg eingetragen')).toBeOnTheScreen();
});

test('ohne frühere Messung ist das Feld leer', async () => {
  await renderForm({ lastWeighings: [] });

  expect(field()).toHaveDisplayValue('');
});

test('nimmt kg mit einer Nachkommastelle, mit Komma oder Punkt', async () => {
  const { added } = await renderForm();

  await enter('91.4');
  await save();

  expect(added()).toEqual([expect.objectContaining({ weightG: 91_400 })]);
});

test('der Messzeitpunkt ist änderbar, etwa für eine nachgetragene Messung', async () => {
  const { added } = await renderForm();

  fireEvent.changeText(screen.getByLabelText('Gemessen am'), '2026-10-14T05:10:00.000Z');
  await save();

  expect(added()).toEqual([expect.objectContaining({ measuredAt: '2026-10-14T05:10:00.000Z', localDate: '2026-10-14' })]);
});

test('„Tippfehler?“ erscheint bei mehr als 2 kg Abweichung inline vor dem Speichern; „Stimmt so“ speichert', async () => {
  const { added, onSaved } = await renderForm();

  await enter('94,0');
  await save();

  expect(screen.getByText('Tippfehler? Das sind 2,2 kg mehr als dein letztes Tagesgewicht (91,8 kg).')).toBeOnTheScreen();
  expect(added()).toEqual([]);
  expect(onSaved).not.toHaveBeenCalled();

  await user.press(screen.getByRole('button', { name: 'Stimmt so' }));

  expect(added()).toEqual([expect.objectContaining({ weightG: 94_000 })]);
  expect(onSaved).toHaveBeenCalledTimes(1);
});

test('„Korrigieren“ schließt die Frage, ohne zu speichern; die korrigierte Eingabe speichert ohne Frage', async () => {
  const { added } = await renderForm();
  await enter('19,8');
  await save();
  await enter('89,0');
  await save();
  expect(screen.getByText('Tippfehler? Das sind 2,8 kg weniger als dein letztes Tagesgewicht (91,8 kg).')).toBeOnTheScreen();

  await user.press(screen.getByRole('button', { name: 'Korrigieren' }));

  expect(screen.queryByText(/Tippfehler\?/)).not.toBeOnTheScreen();
  expect(added()).toEqual([]);
  await enter('91,0');
  await save();
  expect(added()).toEqual([expect.objectContaining({ weightG: 91_000 })]);
});

test('genau 2,0 kg Abweichung speichert ohne Frage', async () => {
  const { added } = await renderForm();

  await enter('93,8');
  await save();

  expect(screen.queryByText(/Tippfehler\?/)).not.toBeOnTheScreen();
  expect(added()).toEqual([expect.objectContaining({ weightG: 93_800 })]);
});

test('eine neue Eingabe nach der Frage fragt neu, statt die alte Antwort zu übernehmen', async () => {
  const { added } = await renderForm();
  await enter('94,0');
  await save();

  await enter('95,0');

  expect(screen.queryByText(/Tippfehler\?/)).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Speichern' })).toBeOnTheScreen();
  expect(added()).toEqual([]);
});

test.each([
  ['unter 20 kg', '19,9'],
  ['über 350 kg', '350,1'],
  ['zwei Nachkommastellen', '82,45'],
  ['keine Zahl', 'achtzig'],
  ['leer', ''],
])('lehnt %s mit einem Satz unter dem Feld ab, ohne zu speichern', async (_, text) => {
  const { added, onSaved } = await renderForm();

  await enter(text);
  await save();

  expect(screen.getByText('Bitte ein Gewicht von 20,0 bis 350,0 kg mit höchstens einer Nachkommastelle eingeben.')).toBeOnTheScreen();
  expect(added()).toEqual([]);
  expect(onSaved).not.toHaveBeenCalled();
});

test('„Rückgängig“ in der Meldung löscht den Eintrag wieder', async () => {
  const { added } = await renderForm();
  await save();

  await user.press(screen.getByRole('button', { name: 'Rückgängig' }));
  await act(async () => {});

  expect(added()).toEqual([expect.objectContaining({ deletedAt: expect.any(String) })]);
});

test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp, auch in der Frage', async () => {
  await renderForm();
  const atLeast48 = (name: string) => {
    const area = hitArea(screen.getByRole('button', { name }));
    expect(area.height).toBeGreaterThanOrEqual(48);
    expect(area.width).toBeGreaterThanOrEqual(48);
  };
  atLeast48('Speichern');

  await enter('99,0');
  await save();

  atLeast48('Stimmt so');
  atLeast48('Korrigieren');
});
