import { act, fireEvent, render, screen, userEvent, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';

import { createTestClock } from '@abnehm/clock/testing';
import { Instant } from '@abnehm/contracts/base';

import { ClockProvider } from '../clock/clock-context';
import { textScale } from '../design';
import { hitArea } from '../design/testing/hit-area';
import { MessageHostProvider, MessageSlot } from '../shell/MessageHost';
import { SportEntryForm } from './SportEntryForm';
import { berlin, createTrackerWorld, noon, type TrackerWorld } from './testing/tracker-world';

// Nachweis für #173 am gerenderten Formular „+ Einheit“ (Spezifikation 3, Abschnitte 3–5; #38): die
// Arten als kurze Liste mit Symbolen, die zuletzt genutzte oben; die Dauer per Schnellwahl oder frei, die
// letzte vorausgefüllt; der Beginn „jetzt − Dauer“, änderbar; Kalorien optional und „wird nur angezeigt“.
// Gespeichert wird über das echte Tracker-Modul auf echtem SQLite; danach kommt die Meldung mit
// „Rückgängig“ über den Meldungs-Host.

jest.mock('../design/native/DateTimePicker', () => jest.requireActual('../design/testing/text-date-time-picker'));

const user = userEvent.setup();
const worlds: TrackerWorld[] = [];
afterEach(() => {
  for (const world of worlds.splice(0)) world.close();
});

type Earlier = Parameters<TrackerWorld['trackers']['recordSport']>[0];

async function renderForm({ earlier = [] as readonly Earlier[] } = {}) {
  const clock = createTestClock({ instant: noon, timeZone: berlin });
  const world = await createTrackerWorld(clock);
  worlds.push(world);
  for (const unit of earlier) world.trackers.recordSport(unit);
  const before = world.sports().length;
  const onSaved = jest.fn();
  await render(
    <ClockProvider clock={clock}>
      <MessageHostProvider>
        <SportEntryForm trackers={world.trackers} onSaved={onSaved} />
        <MessageSlot />
      </MessageHostProvider>
    </ClockProvider>,
  );
  const added = () => world.sports().slice(before);
  return { ...world, clock, onSaved, added };
}

const kinds = () => screen.getAllByRole('radio').filter((radio) => !/^\d+ min$/.test(String(radio.props.accessibilityLabel)));
const kind = (name: string) => screen.getByRole('radio', { name });
const duration = () => screen.getByLabelText('Dauer');
const start = () => screen.getByLabelText('Beginn');
const save = () => user.press(screen.getByRole('button', { name: 'Speichern' }));
/** Ein Lauf gestern Abend: 45 Minuten Radfahren ab 18:00 Berlin. */
const yesterday: Earlier = { activityType: 'radfahren', durationMinutes: 45, startedAt: Instant.parse('2026-10-13T16:00:00.000Z'), activeMilliKcal: null };

async function enter(field: ReturnType<typeof screen.getByLabelText>, text: string) {
  await user.clear(field);
  if (text !== '') await user.type(field, text);
}

test('zeigt die acht Arten als kurze Liste in fester Reihenfolge, ohne Vorauswahl vor der ersten Einheit', async () => {
  await renderForm();

  expect(kinds().map((radio) => radio.props.accessibilityLabel)).toEqual([
    'Gehen', 'Laufen', 'Radfahren', 'Schwimmen', 'Krafttraining', 'Yoga & Dehnen', 'Mannschaftssport', 'Sonstiges',
  ]);
  for (const radio of kinds()) expect(radio).not.toBeChecked();
  // Jede Art hat ihr Symbol.
  expect(within(kind('Laufen')).getByTestId('icon-run', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(within(kind('Krafttraining')).getByTestId('icon-sport', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(duration()).toHaveDisplayValue('');
  expect(screen.queryByText(/Intensität/)).not.toBeOnTheScreen();
});

test('eine typische Einheit ist drei Tipps: Art, Schnellwahl, Speichern; Beginn ist jetzt − Dauer', async () => {
  const { added, onSaved } = await renderForm();

  await user.press(kind('Laufen'));
  await user.press(screen.getByRole('radio', { name: '30 min' }));
  expect(start()).toHaveDisplayValue('2026-10-14T09:30:00.000Z');
  await save();

  expect(added()).toEqual([
    expect.objectContaining({ activityType: 'laufen', durationMinutes: 30, startedAt: '2026-10-14T09:30:00.000Z', activeMilliKcal: null, localDate: '2026-10-14' }),
  ]);
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(within(screen.getByTestId('message-slot')).getByText('30 min Laufen eingetragen')).toBeOnTheScreen();
});

test('mit früherer Einheit: zuletzt genutzte Art oben und gewählt, letzte Dauer vorausgefüllt; ein Tipp speichert', async () => {
  const { added } = await renderForm({ earlier: [yesterday] });

  expect(kinds()[0]).toHaveProp('accessibilityLabel', 'Radfahren');
  expect(kind('Radfahren')).toBeChecked();
  expect(kinds().map((radio) => radio.props.accessibilityLabel)).toEqual([
    'Radfahren', 'Gehen', 'Laufen', 'Schwimmen', 'Krafttraining', 'Yoga & Dehnen', 'Mannschaftssport', 'Sonstiges',
  ]);
  expect(duration()).toHaveDisplayValue('45');
  expect(screen.getByRole('radio', { name: '45 min' })).toBeChecked();
  expect(start()).toHaveDisplayValue('2026-10-14T09:15:00.000Z');

  await save();

  expect(added()).toEqual([expect.objectContaining({ activityType: 'radfahren', durationMinutes: 45, startedAt: '2026-10-14T09:15:00.000Z' })]);
});

test('die Dauer geht frei einzugeben; der Beginn folgt der Dauer, bis man ihn selbst ändert', async () => {
  const { added } = await renderForm({ earlier: [yesterday] });

  await enter(duration(), '25');
  expect(screen.getByRole('radio', { name: '15 min' })).not.toBeChecked();
  expect(screen.getByRole('radio', { name: '30 min' })).not.toBeChecked();
  expect(start()).toHaveDisplayValue('2026-10-14T09:35:00.000Z');

  // Nachgetragen: gestern um 07:00 Berlin. Danach bleibt der Beginn, auch wenn sich die Dauer ändert.
  fireEvent.changeText(start(), '2026-10-13T05:00:00.000Z');
  await user.press(screen.getByRole('radio', { name: '60 min' }));
  expect(start()).toHaveDisplayValue('2026-10-13T05:00:00.000Z');
  await save();

  expect(added()).toEqual([expect.objectContaining({ durationMinutes: 60, startedAt: '2026-10-13T05:00:00.000Z', localDate: '2026-10-13' })]);
});

test('„jetzt − Dauer“ gilt beim Speichern: Wer sich Zeit lässt, bekommt keinen veralteten Beginn', async () => {
  const { added, clock } = await renderForm({ earlier: [yesterday] });

  await act(async () => clock.advanceBy(120_000));
  await save();

  expect(added()).toEqual([expect.objectContaining({ startedAt: '2026-10-14T09:17:00.000Z' })]);
});

test('Kalorien sind optional, tragen den Hinweis „wird nur angezeigt“ und werden in milli_kcal gespeichert', async () => {
  const { added } = await renderForm({ earlier: [yesterday] });
  const calories = screen.getByLabelText('Kalorien (optional)');

  expect(screen.getByText('wird nur angezeigt', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(calories).toHaveProp('accessibilityHint', 'wird nur angezeigt');
  await enter(calories, '210');
  await save();

  expect(added()).toEqual([expect.objectContaining({ activeMilliKcal: 210_000 })]);
});

test.each([
  ['ohne Art', async () => {}, 'Bitte eine Art wählen.'],
  ['ohne Dauer', async () => { await user.press(kind('Laufen')); }, 'Bitte eine Dauer von 1 bis 600 Minuten eingeben.'],
  ['mit 0 Minuten', async () => { await user.press(kind('Laufen')); await enter(duration(), '0'); }, 'Bitte eine Dauer von 1 bis 600 Minuten eingeben.'],
  ['mit 601 Minuten', async () => { await user.press(kind('Laufen')); await enter(duration(), '601'); }, 'Bitte eine Dauer von 1 bis 600 Minuten eingeben.'],
  ['mit 5001 kcal', async () => {
    await user.press(kind('Laufen'));
    await enter(duration(), '30');
    await enter(screen.getByLabelText('Kalorien (optional)'), '5001');
  }, 'Bitte Kalorien von 0 bis 5000 kcal eingeben oder das Feld leer lassen.'],
])('speichert %s nicht und nennt den Lösungsweg', async (_, fill, problem) => {
  const { added, onSaved } = await renderForm();

  await fill();
  await save();

  // Fehler an einem Feld stehen sichtbar darunter und als Hinweis am Feld selbst.
  expect(screen.getByText(problem, { includeHiddenElements: true })).toBeOnTheScreen();
  expect(added()).toEqual([]);
  expect(onSaved).not.toHaveBeenCalled();
});

test('ein Beginn in der Zukunft nennt den Beginn als Ursache und speichert nicht', async () => {
  const { added } = await renderForm({ earlier: [yesterday] });

  // Der Picker endet bei „jetzt“; dahinter landet man etwa, wenn die Uhr zurückspringt.
  fireEvent.changeText(start(), '2026-10-14T10:05:00.000Z');
  await save();

  expect(screen.getByText('Der Beginn liegt in der Zukunft. Bitte einen Zeitpunkt bis jetzt wählen.')).toBeOnTheScreen();
  expect(added()).toEqual([]);
});

test('„Rückgängig“ in der Meldung löscht die Einheit wieder', async () => {
  const { added } = await renderForm({ earlier: [yesterday] });
  await save();

  await user.press(screen.getByRole('button', { name: 'Rückgängig' }));

  expect(added()).toEqual([expect.objectContaining({ deletedAt: expect.any(String) })]);
});

test('Aktionen haben deutsche zugängliche Namen und mindestens 48 × 48 dp', async () => {
  await renderForm();

  for (const control of [...screen.getAllByRole('radio'), screen.getByRole('button', { name: 'Speichern' })]) {
    const name = String(control.props.accessibilityLabel ?? 'Speichern');
    expect(name).toMatch(/^[\p{Lu}\d][\p{L}\p{N} &]+$/u);
    const area = hitArea(control);
    expect({ name, fits: area.width >= 48 && area.height >= 48 }).toEqual({ name, fits: true });
  }
});

describe('Schriftfaktor 2,0', () => {
  const initial = { window: Dimensions.get('window'), screen: Dimensions.get('screen') };

  beforeEach(() => {
    Dimensions.set({ window: { ...initial.window, fontScale: 2 }, screen: { ...initial.screen, fontScale: 2 } });
  });

  afterEach(() => {
    Dimensions.set(initial);
  });

  test('Texte wachsen mit, und eine Einheit lässt sich weiterhin eintragen', async () => {
    const { added } = await renderForm();

    for (const text of screen.queryAllByText(/[\s\S]*/, { includeHiddenElements: true })) {
      expect(text.props.allowFontScaling).not.toBe(false);
      expect(text.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(textScale.max);
    }
    await user.press(kind('Schwimmen'));
    await user.press(screen.getByRole('radio', { name: '45 min' }));
    await save();

    expect(added()).toEqual([expect.objectContaining({ activityType: 'schwimmen', durationMinutes: 45 })]);
  });
});
