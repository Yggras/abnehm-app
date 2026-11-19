import { describe, expect, it } from 'vitest';

import { testCatalog } from '../fixtures/index.ts';
import { formAt, levelOccasionKey, unlocksAt } from '../src/unlocks.ts';

// Nachweis für #179: Freischaltungen und Entwicklungsformen nach Abschnitt 5 von #83, gegen den
// Test-Katalog mit zwei Gebieten (Level 4 und 8) und zwei Landschaftsvorlagen.

const catalog = testCatalog();

describe('Form zu jedem Level', () => {
  it.each([
    [1, 'kaulquappe'],
    [3, 'kaulquappe'],
    [4, 'huepfer'],
    [7, 'huepfer'],
    [8, 'krabbler'],
    [12, 'krabbler'],
    [13, 'aufrechter'],
    [18, 'aufrechter'],
    [19, 'springer'],
    [25, 'springer'],
    [26, 'spirale'],
    [33, 'spirale'],
    [34, 'fluegling'],
    [42, 'fluegling'],
    [43, 'lagunendrache'],
    [49, 'lagunendrache'], // endlose Gebiete bringen keine neue Form
    [200, 'lagunendrache'],
  ] as const)('Level %i → %s', (level, form) => {
    expect(formAt(level)).toBe(form);
  });

  it('lehnt Level unter 1 ab', () => {
    expect(() => formAt(0)).toThrow(RangeError);
  });
});

describe('Freischaltungen je Level', () => {
  it('schaltet beim Schlüpfen die Start-Baupläne beider Rollen und Form 1 frei', () => {
    expect(unlocksAt(catalog, 1)).toEqual({
      level: 1,
      blueprints: ['t_weg', 't_bank', 't_laterne', 't_blumen', 't_busch', 't_baum'].map((key) => ({ key, reason: 'start' })),
      form: 'kaulquappe',
      area: null,
    });
  });

  it('bringt ab Level 2 die Level-Freischaltung je Rolle', () => {
    expect(unlocksAt(catalog, 2)).toEqual({
      level: 2,
      blueprints: [
        { key: 't_bauen_2', reason: 'level' },
        { key: 't_natur_2', reason: 'level' },
      ],
      form: null,
      area: null,
    });
  });

  it('zählt ein Level ohne Katalogeintrag trotzdem, ohne neuen Bauplan', () => {
    expect(unlocksAt(catalog, 3)).toEqual({ level: 3, blueprints: [], form: null, area: null });
  });

  it('schaltet an einem Formlevel Form, Gebiet und dessen Entdeckungs-Baupläne frei', () => {
    expect(unlocksAt(catalog, 4)).toEqual({
      level: 4,
      blueprints: [
        { key: 't_bauen_4', reason: 'level' },
        { key: 't_natur_4', reason: 'level' },
        { key: 't_ent_bauen_1a', reason: 'entdeckung' },
        { key: 't_ent_bauen_1b', reason: 'entdeckung' },
        { key: 't_ent_natur_1a', reason: 'entdeckung' },
        { key: 't_ent_natur_1b', reason: 'entdeckung' },
      ],
      form: 'huepfer',
      area: { type: 'gebiet', key: 't_gebiet_1' },
    });
    expect(unlocksAt(catalog, 8)).toMatchObject({ form: 'krabbler', area: { type: 'gebiet', key: 't_gebiet_2' } });
  });

  it('bringt die neue Form auch, wenn das Gebiet noch nicht im Katalog steht', () => {
    expect(unlocksAt(catalog, 13)).toEqual({ level: 13, blueprints: [], form: 'aufrechter', area: null });
  });

  it.each([42, 44, 48, 50, 54])('schaltet bei Level %i kein Gebiet frei', (level) => {
    expect(unlocksAt(catalog, level).area).toBeNull();
  });

  it('schaltet ab Level 49 alle 6 Level ein endloses Gebiet aus der nächsten Landschaftsvorlage frei', () => {
    expect(unlocksAt(catalog, 49)).toEqual({
      level: 49,
      blueprints: [
        { key: 't_ent_bauen_1a', reason: 'entdeckung' },
        { key: 't_ent_natur_1a', reason: 'entdeckung' },
      ],
      form: null,
      area: { type: 'endlos', key: 'endlos_1_t_vorlage_erste', template: 't_vorlage_erste', k: 1 },
    });
    expect(unlocksAt(catalog, 55).area).toEqual({ type: 'endlos', key: 'endlos_2_t_vorlage_zweite', template: 't_vorlage_zweite', k: 2 });
    // Nach der letzten Vorlage beginnt die Reihe von vorn.
    expect(unlocksAt(catalog, 61).area).toEqual({ type: 'endlos', key: 'endlos_3_t_vorlage_erste', template: 't_vorlage_erste', k: 3 });
  });

  it('schaltet ohne Landschaftsvorlage kein endloses Gebiet frei', () => {
    expect(unlocksAt({ ...catalog, landscapeTemplates: [] }, 49)).toEqual({ level: 49, blueprints: [], form: null, area: null });
  });
});

describe('Anlassschlüssel des Levelaufstiegs (#200)', () => {
  it('ist `level:‹insel›:‹L›` und nur für ganze Level ab 1 definiert', () => {
    expect(levelOccasionKey('5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c02', 4)).toBe('level:5d1c7e3a-2b4f-4a8e-b6c1-3e9f0a7d5c02:4');
    expect(() => levelOccasionKey('insel', 0)).toThrow();
    expect(() => levelOccasionKey('insel', 2.5)).toThrow();
  });
});
