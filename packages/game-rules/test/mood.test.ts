import { describe, expect, it } from 'vitest';

import { LocalDate } from '@abnehm/contracts/base';

import { momoMood, reactionMood, strongestEvent, type MoodFacts } from '../src/mood.ts';

// Nachweis für #188: Momos Stimmung nach Abschnitt 6 von #83, Priorität von oben nach unten:
// begeistert, freut sich, schläft (nur Insel, 20:00–06:00), neugierig, döst, zufrieden.

const today = LocalDate.parse('2026-10-14');
const minute = (hours: number, minutes: number) => hours * 60 + minutes;

/** Mittags auf „Heute“, ohne Reaktion und Hinweis, heute schon ein Tagesziel erfüllt: der Standard. */
const base: MoodFacts = {
  view: 'heute',
  reaction: null,
  minuteOfDay: minute(12, 0),
  islandNotice: 0,
  today,
  lastOwnCompletion: today,
};

const facts = (overrides: Partial<MoodFacts>): MoodFacts => ({ ...base, ...overrides });

describe('Stimmungspriorität', () => {
  it.each([
    ['Standard', {}, 'zufrieden'],
    ['kurz nach Tagesbonus oder Levelaufstieg', { reaction: 'begeistert' }, 'begeistert'],
    ['kurz nach Tageszielerfüllung', { reaction: 'freut_sich' }, 'freut_sich'],
    ['abends auf der Insel', { view: 'insel', minuteOfDay: minute(21, 0) }, 'schlaeft'],
    ['Neues auf der Insel', { islandNotice: 1 }, 'neugierig'],
    ['heute und gestern nichts erfüllt', { lastOwnCompletion: null }, 'doest'],
    // Jede Stimmung schlägt die nächstniedrigere, auch wenn deren Auslöser gleichzeitig gilt.
    ['begeistert vor schläft', { reaction: 'begeistert', view: 'insel', minuteOfDay: minute(22, 0) }, 'begeistert'],
    ['freut sich vor schläft', { reaction: 'freut_sich', view: 'insel', minuteOfDay: minute(22, 0) }, 'freut_sich'],
    ['schläft vor neugierig', { view: 'insel', minuteOfDay: minute(22, 0), islandNotice: 2 }, 'schlaeft'],
    ['schläft vor döst', { view: 'insel', minuteOfDay: minute(22, 0), lastOwnCompletion: null }, 'schlaeft'],
    ['neugierig vor döst', { islandNotice: 1, lastOwnCompletion: null }, 'neugierig'],
    ['freut sich vor döst', { reaction: 'freut_sich', lastOwnCompletion: null }, 'freut_sich'],
    ['begeistert vor allem anderen', { reaction: 'begeistert', islandNotice: 3, lastOwnCompletion: null }, 'begeistert'],
  ] as const)('%s → %s', (_name, overrides, mood) => {
    expect(momoMood(facts(overrides))).toBe(mood);
  });
});

describe('Uhrzeitgrenzen von „schläft“', () => {
  it.each([
    [minute(19, 59), 'zufrieden'],
    [minute(20, 0), 'schlaeft'],
    [minute(23, 59), 'schlaeft'],
    [minute(0, 0), 'schlaeft'],
    [minute(5, 59), 'schlaeft'],
    [minute(6, 0), 'zufrieden'],
  ] as const)('auf der Insel um Minute %i → %s', (minuteOfDay, mood) => {
    expect(momoMood(facts({ view: 'insel', minuteOfDay }))).toBe(mood);
  });

  it.each([minute(20, 0), minute(23, 59), minute(0, 0), minute(5, 59)])('auf „Heute“ schläft Momo nie (Minute %i)', (minuteOfDay) => {
    expect(momoMood(facts({ view: 'heute', minuteOfDay }))).toBe('zufrieden');
  });
});

describe('Grenze von „döst“', () => {
  it.each([
    ['heute erfüllt', '2026-10-14', 'zufrieden'],
    ['zuletzt gestern erfüllt', '2026-10-13', 'zufrieden'],
    ['zuletzt vorgestern erfüllt', '2026-10-12', 'doest'],
    ['zuletzt vor einem Monat erfüllt', '2026-09-14', 'doest'],
    ['über den Monatswechsel: gestern am 30.09.', '2026-09-30', 'zufrieden'],
  ] as const)('%s → %s', (_name, lastOwnCompletion, mood) => {
    const onFirst = lastOwnCompletion === '2026-09-30' ? LocalDate.parse('2026-10-01') : today;
    expect(momoMood(facts({ today: onFirst, lastOwnCompletion: LocalDate.parse(lastOwnCompletion) }))).toBe(mood);
  });

  it('noch nie erfüllt → döst', () => {
    expect(momoMood(facts({ lastOwnCompletion: null }))).toBe('doest');
  });
});

describe('Reaktion auf eigene Ereignisse', () => {
  it.each([
    [['tageszielerfuellung'], 'freut_sich'],
    [['tageszielerfuellung', 'tageszielerfuellung'], 'freut_sich'],
    [['tagesbonus'], 'begeistert'],
    [['levelaufstieg'], 'begeistert'],
    // Kommen Ereignisse zusammen, zählt das stärkste.
    [['tageszielerfuellung', 'tagesbonus'], 'begeistert'],
  ] as const)('%j → %s', (events, mood) => {
    expect(reactionMood(events)).toBe(mood);
  });

  it('ohne Ereignis gibt es keine Reaktion', () => {
    expect(() => reactionMood([])).toThrow(RangeError);
    expect(() => strongestEvent([])).toThrow(RangeError);
  });

  it.each([
    [['tageszielerfuellung'], 'tageszielerfuellung'],
    [['tageszielerfuellung', 'tagesbonus'], 'tagesbonus'],
    [['tagesbonus', 'levelaufstieg', 'tageszielerfuellung'], 'levelaufstieg'],
  ] as const)('das stärkste von %j ist %s', (events, strongest) => {
    expect(strongestEvent(events)).toBe(strongest);
  });
});

describe('ungültige Fakten', () => {
  it.each([-1, 1440, 12.5])('lehnt Minute %s ab', (minuteOfDay) => {
    expect(() => momoMood(facts({ minuteOfDay }))).toThrow(RangeError);
  });

  it('lehnt einen negativen Hinweiszähler ab', () => {
    expect(() => momoMood(facts({ islandNotice: -1 }))).toThrow(RangeError);
  });
});
