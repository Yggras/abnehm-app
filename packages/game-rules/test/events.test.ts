import { describe, expect, it } from 'vitest';

import { testCatalog } from '../fixtures/index.ts';
import {
  chooseWish,
  freeEventSlots,
  isWishFulfilled,
  personalEventAllowed,
  planVisitors,
  resolveClaimedReward,
  visitorReward,
  wishPriceCap,
  type VisitorDayInput,
} from '../src/events.ts';
import { seededRandom } from '../src/random.ts';

// Nachweis für #202: Ereignistakt und Besucher mit Wunsch nach Abschnitt 9 von #83. Grenzwerte als
// Wahrheitstabellen knapp unter, exakt an und über jeder Schwelle.

const catalog = testCatalog();
const startBlueprints = ['t_weg', 't_bank', 't_laterne', 't_blumen', 't_busch', 't_baum'];
const philipp = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b01';
const anna = '0b3f9a52-6c1e-4d7a-9f20-1a5e8c4d2b02';
const island = '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f';

describe('Tagesdeckel', () => {
  it.each([
    [0, 2],
    [1, 1],
    [2, 0], // exakt am Deckel
    [3, 0], // darüber, etwa nach einem Katalog-Update; nie negativ
  ])('%i deckelnde Ereignisse heute → %i freie Plätze', (cappedToday, free) => {
    expect(freeEventSlots(cappedToday)).toBe(free);
  });
});

describe('Grenze je Person', () => {
  it.each([
    [0, 0, true],
    [0, 3, true], // knapp unter der Grenze von 4 offenen
    [0, 4, false], // exakt an der Grenze
    [0, 5, false],
    [1, 0, false], // schon ein neues personenbezogenes Ereignis heute
    [1, 3, false],
  ])('heute %i, offen %i → %s', (personalToday, openPersonal, allowed) => {
    expect(personalEventAllowed({ personalToday, openPersonal })).toBe(allowed);
  });
});

describe('Preisgrenze des Wunschs', () => {
  it('ist ohne Level-Bauplan der teuerste Start-Bauplan der Rolle (Festlegung in #202)', () => {
    expect(wishPriceCap(catalog, 'bauen', new Set(startBlueprints))).toBe(3);
  });

  it('ist der Preis des neuesten freigeschalteten Level-Bauplans der Rolle', () => {
    // t_bauen_2: Preislevel 2 → 4; t_bauen_4: Preislevel 4 → 5.
    expect(wishPriceCap(catalog, 'bauen', new Set([...startBlueprints, 't_bauen_2']))).toBe(4);
    expect(wishPriceCap(catalog, 'bauen', new Set([...startBlueprints, 't_bauen_2', 't_bauen_4']))).toBe(5);
    // Der Level-Bauplan der anderen Rolle zählt nicht.
    expect(wishPriceCap(catalog, 'natur', new Set([...startBlueprints, 't_bauen_4']))).toBe(3);
  });
});

describe('gewünschter Bauplan', () => {
  const wish = (unlocked: readonly string[], built: readonly string[] = [], seed = 'a') =>
    chooseWish(catalog, { role: 'bauen', unlockedBlueprints: new Set(unlocked), builtBlueprints: new Set(built), random: seededRandom(seed) });

  it('kommt nur aus freigeschalteten Bauplänen der eigenen Rolle bis zur Preisgrenze (Festlegung in #202)', () => {
    const seen = new Set(Array.from({ length: 40 }, (_, i) => wish([...startBlueprints, 't_bes_bauen_b'], [], `s${i}`)));
    // t_bes_bauen_b kostet 5 und liegt über der Grenze 3.
    expect(seen).toEqual(new Set(['t_weg', 't_bank', 't_laterne']));
  });

  it('bevorzugt einen Bauplan, den die Person noch nicht gebaut hat', () => {
    for (let i = 0; i < 20; i += 1) expect(wish(startBlueprints, ['t_weg', 't_bank'], `s${i}`)).toBe('t_laterne');
  });

  it('wiederholt einen gebauten, wenn sie alle schon besitzt', () => {
    expect(startBlueprints.slice(0, 3)).toContain(wish(startBlueprints, ['t_weg', 't_bank', 't_laterne']));
  });

  it('gibt es nicht ohne passenden Bauplan', () => {
    expect(wish([])).toBeUndefined();
  });
});

describe('Belohnung des Besuchers', () => {
  const reward = (templateKey: string, role: 'bauen' | 'natur', unlocked: readonly string[], unavailable: readonly string[] = [], seed = 'a') =>
    visitorReward(catalog, { templateKey, role, unlockedBlueprints: new Set(unlocked), unavailable: new Set(unavailable), random: seededRandom(seed) });

  it('ist ein noch nicht freigeschalteter Besucher-Bauplan der Rolle, bevorzugt aus dem Pool des Besuchers', () => {
    expect(reward('t_igel', 'bauen', startBlueprints)).toEqual({ type: 'bauplan', key: 't_bes_bauen_a' });
    expect(reward('t_igel', 'natur', startBlueprints)).toEqual({ type: 'bauplan', key: 't_bes_natur_a' });
  });

  it('nimmt einen anderen Besucher-Bauplan der Rolle, wenn der Pool erschöpft ist', () => {
    expect(reward('t_igel', 'bauen', [...startBlueprints, 't_bes_bauen_a'])).toEqual({ type: 'bauplan', key: 't_bes_bauen_b' });
    expect(reward('t_igel', 'bauen', startBlueprints, ['t_bes_bauen_a'])).toEqual({ type: 'bauplan', key: 't_bes_bauen_b' });
  });

  it('ist Deko aus dem Pool, wenn kein Besucher-Bauplan der Rolle mehr übrig ist', () => {
    expect(reward('t_igel', 'natur', [...startBlueprints, 't_bes_natur_a'])).toEqual({ type: 'deko', key: 't_bes_deko_1' });
    expect(reward('t_fuchs', 'bauen', [...startBlueprints, 't_bes_bauen_a', 't_bes_bauen_b'])).toEqual({ type: 'deko', key: 't_bes_deko_2' });
  });

  it('wird beim Abholen neu bestimmt, wenn der geplante Bauplan inzwischen freigeschaltet ist', () => {
    const resolve = (planned: { type: 'bauplan' | 'deko'; key: string }, unlocked: readonly string[], role: 'bauen' | 'natur' = 'bauen') =>
      resolveClaimedReward(catalog, { eventId: 'e1', templateKey: 't_igel', planned, role, unlockedBlueprints: new Set(unlocked) });
    expect(resolve({ type: 'bauplan', key: 't_bes_bauen_a' }, startBlueprints)).toEqual({ type: 'bauplan', key: 't_bes_bauen_a' });
    expect(resolve({ type: 'bauplan', key: 't_bes_bauen_a' }, [...startBlueprints, 't_bes_bauen_a'])).toEqual({ type: 'bauplan', key: 't_bes_bauen_b' });
    // Nach einem Rollentausch passt der geplante Bauplan nicht mehr zur Rolle.
    expect(resolve({ type: 'bauplan', key: 't_bes_bauen_a' }, startBlueprints, 'natur')).toEqual({ type: 'bauplan', key: 't_bes_natur_a' });
    expect(resolve({ type: 'deko', key: 't_bes_deko_1' }, startBlueprints)).toEqual({ type: 'deko', key: 't_bes_deko_1' });
  });
});

describe('Bedingung des Wunschs', () => {
  const event = { wish: { blueprintKey: 't_laterne' }, responsiblePersonId: philipp, occurredAt: '2026-10-14T08:00:00.000Z' };
  const built = (change: Partial<{ ownerPersonId: string; catalogKey: string; origin: 'gebaut' | 'besucher'; createdAt: string }> = {}) => ({
    ownerPersonId: philipp, catalogKey: 't_laterne', origin: 'gebaut' as const, createdAt: '2026-10-14T09:00:00.000Z', ...change,
  });

  it('ist erfüllt durch einen eigenen Bau des Bauplans nach dem Erzeugen', () => {
    expect(isWishFulfilled(event, [built()])).toBe(true);
  });

  it.each([
    ['vor dem Erzeugen', built({ createdAt: '2026-10-14T07:59:59.999Z' })],
    ['im selben Augenblick', built({ createdAt: '2026-10-14T08:00:00.000Z' })],
    ['durch den Partner', built({ ownerPersonId: anna })],
    ['mit einem anderen Bauplan', built({ catalogKey: 't_bank' })],
    ['durch Deko gleichen Schlüssels', built({ origin: 'besucher' })],
  ])('ist nicht erfüllt %s', (_, object) => {
    expect(isWishFulfilled(event, [object])).toBe(false);
  });
});

describe('Besucher eines Inseltags', () => {
  const day = (change: Partial<VisitorDayInput> = {}): VisitorDayInput => ({
    islandId: island,
    date: '2026-10-14',
    cappedToday: 0,
    visitorSlotsUsed: new Set(),
    unlockedBlueprints: new Set(startBlueprints),
    openTemplates: new Set(),
    promisedBlueprints: new Set(),
    persons: [
      { personId: philipp, role: 'bauen', personalToday: 0, openPersonal: 0, builtBlueprints: new Set() },
      { personId: anna, role: 'natur', personalToday: 0, openPersonal: 0, builtBlueprints: new Set() },
    ],
    ...change,
  });

  it('füllen den Deckel auf: je Person einer, Anlassschlüssel `tag:‹datum›:‹n›`', () => {
    const visitors = planVisitors(catalog, day());
    expect(visitors.map((v) => v.occasionKey)).toEqual(['tag:2026-10-14:1', 'tag:2026-10-14:2']);
    expect(new Set(visitors.map((v) => v.responsiblePersonId))).toEqual(new Set([philipp, anna]));
    const forAnna = visitors.find((v) => v.responsiblePersonId === anna)!;
    expect(['t_blumen', 't_busch', 't_baum']).toContain(forAnna.details.wish.blueprintKey);
    expect(forAnna.details.reward).toEqual({ type: 'bauplan', key: 't_bes_natur_a' });
  });

  it('sind deterministisch: dieselbe Insel am selben Tag ergibt dieselben Besucher', () => {
    expect(planVisitors(catalog, day())).toEqual(planVisitors(catalog, day()));
    const other = planVisitors(catalog, day({ islandId: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e60' }));
    const days = Array.from({ length: 10 }, (_, i) => planVisitors(catalog, day({ date: `2026-10-${10 + i}` })));
    // Über mehrere Inseln und Tage variiert der Zufall.
    expect(new Set([other, ...days].map((visitors) => JSON.stringify(visitors.map((v) => [v.responsiblePersonId, v.templateKey])))).size).toBeGreaterThan(1);
  });

  it('kommen nur, solange der Deckel Platz hat', () => {
    expect(planVisitors(catalog, day({ cappedToday: 1, visitorSlotsUsed: new Set([1]) }))).toHaveLength(1);
    expect(planVisitors(catalog, day({ cappedToday: 1, visitorSlotsUsed: new Set([1]) }))[0]!.occasionKey).toBe('tag:2026-10-14:2');
    expect(planVisitors(catalog, day({ cappedToday: 2, visitorSlotsUsed: new Set([1, 2]) }))).toEqual([]);
  });

  it('übergehen eine Person mit 4 offenen oder schon einem neuen Ereignis heute', () => {
    const full = { personId: philipp, role: 'bauen' as const, personalToday: 0, openPersonal: 4, builtBlueprints: new Set<string>() };
    const today = { personId: anna, role: 'natur' as const, personalToday: 1, openPersonal: 1, builtBlueprints: new Set<string>() };
    expect(planVisitors(catalog, day({ persons: [full, today], cappedToday: 1, visitorSlotsUsed: new Set([1]) }))).toEqual([]);
    const visitors = planVisitors(catalog, day({ persons: [full, { ...today, personalToday: 0 }] }));
    expect(visitors.map((v) => v.responsiblePersonId)).toEqual([anna]);
  });

  it('bevorzugen Besucher, die gerade nicht auf der Insel sind, und versprechen keinen Bauplan doppelt', () => {
    for (const date of ['2026-10-14', '2026-10-15', '2026-10-16']) {
      const visitors = planVisitors(catalog, day({ date, openTemplates: new Set(['t_igel']), promisedBlueprints: new Set(['t_bes_bauen_a']) }));
      expect(visitors[0]!.templateKey).toBe('t_fuchs');
      // Der Igel hätte t_bes_bauen_a im Pool; das ist schon einem offenen Besuch versprochen.
      expect(visitors.find((v) => v.responsiblePersonId === philipp)!.details.reward).toEqual({ type: 'bauplan', key: 't_bes_bauen_b' });
    }
  });
});
