import { describe, expect, it } from 'vitest';

import { gameCatalog } from '../content/index.ts';
import { areaFields, testCatalog } from '../fixtures/index.ts';
import type { Blueprint, GameCatalog } from '../src/catalog.ts';
import { checkCatalog } from '../src/catalog-check.ts';

// Nachweis für #179: Die Katalogprüfung hält Format und Regeln zusammen (Abschnitte 3–5 von #83).
// Inhalts-Tickets laufen über dieselbe Prüfung.

const catalog = testCatalog();
const replace = <T extends { key: string }>(entries: readonly T[], key: string, change: (entry: T) => T) =>
  entries.map((entry) => (entry.key === key ? change(entry) : entry));
const withBlueprint = (key: string, change: (blueprint: Blueprint) => Blueprint): GameCatalog => ({
  ...catalog,
  blueprints: replace(catalog.blueprints, key, change),
});

describe('Katalogprüfung', () => {
  it('lässt den ausgelieferten Katalog und den Test-Katalog durch', () => {
    expect(checkCatalog(gameCatalog)).toEqual([]);
    expect(checkCatalog(catalog)).toEqual([]);
  });

  it('verlangt eine ganze Version ab 1', () => {
    expect(checkCatalog({ ...catalog, version: 0 })).toContainEqual({ rule: 'version', key: '0' });
  });

  it('verlangt eindeutige Schlüssel über alle Arten, weil ein Inselobjekt Bauplan oder Deko sein kann', () => {
    const deko = { key: 't_weg', name: 'Doppelt', origin: 'besucher', art: 'x' } as const;
    expect(checkCatalog({ ...catalog, deko: [...catalog.deko, deko] })).toContainEqual({ rule: 'schluessel_doppelt', key: 't_weg' });
  });

  it('verlangt Schlüssel aus Kleinbuchstaben, Ziffern und Unterstrich, ohne das Präfix endloser Gebiete', () => {
    expect(checkCatalog(withBlueprint('t_weg', (b) => ({ ...b, key: 'Holz Weg' })))).toContainEqual({
      rule: 'schluessel_format',
      key: 'Holz Weg',
    });
    const areas = replace(catalog.areas, 't_gebiet_1', (area) => ({ ...area, key: 'endlos_1_x' }));
    expect(checkCatalog({ ...catalog, areas })).toContainEqual({ rule: 'schluessel_format', key: 'endlos_1_x' });
  });

  it('verlangt je Rolle genau drei Start-Baupläne zu 1, 2 und 3 Energie', () => {
    expect(checkCatalog(withBlueprint('t_busch', (b) => ({ ...b, startPrice: 1 }) as Blueprint))).toContainEqual({
      rule: 'start_bauplaene',
      key: 'natur',
    });
    const withoutStart = { ...catalog, blueprints: catalog.blueprints.filter((b) => b.key !== 't_laterne') };
    expect(checkCatalog(withoutStart)).toContainEqual({ rule: 'start_bauplaene', key: 'bauen' });
  });

  it('verlangt einen Preislevel als ganze Zahl ab 1', () => {
    expect(checkCatalog(withBlueprint('t_bauen_2', (b) => ({ ...b, priceLevel: 0 }) as Blueprint))).toContainEqual({
      rule: 'preislevel',
      key: 't_bauen_2',
    });
  });

  it('verlangt Level-Freischaltungen ab Level 2, höchstens eine je Level und Rolle, mit einem Level-Bauplan dieser Rolle', () => {
    const unlocks = (...extra: GameCatalog['levelUnlocks']) => checkCatalog({ ...catalog, levelUnlocks: [...catalog.levelUnlocks, ...extra] });
    expect(unlocks({ level: 1, role: 'bauen', blueprint: 't_bauen_4' })).toContainEqual({ rule: 'level_freischaltung', key: '1:bauen' });
    expect(unlocks({ level: 2, role: 'bauen', blueprint: 't_bauen_4' })).toContainEqual({ rule: 'level_freischaltung', key: '2:bauen' });
    expect(unlocks({ level: 3, role: 'natur', blueprint: 't_bauen_4' })).toContainEqual({ rule: 'level_freischaltung', key: '3:natur' });
    expect(unlocks({ level: 3, role: 'bauen', blueprint: 't_weg' })).toContainEqual({ rule: 'level_freischaltung', key: '3:bauen' });
    expect(unlocks({ level: 3, role: 'bauen', blueprint: 'fehlt' })).toContainEqual({ rule: 'verweis_unbekannt', key: 'fehlt' });
  });

  it('verlangt die Feldkontingente: Grundinsel 20 + 40 je Seite, jedes Gebiet 10 + 30 je Seite', () => {
    const baseIsland = { fields: catalog.baseIsland.fields.filter(({ x, y }) => !(x === 0 && y === 0)) };
    expect(checkCatalog({ ...catalog, baseIsland })).toContainEqual({ rule: 'feldkontingent', key: 'grundinsel' });
    const areas = replace(catalog.areas, 't_gebiet_2', (area) => ({ ...area, fields: area.fields.slice(1) }));
    expect(checkCatalog({ ...catalog, areas })).toContainEqual({ rule: 'feldkontingent', key: 't_gebiet_2' });
    const landscapeTemplates = replace(catalog.landscapeTemplates, 't_vorlage_erste', (template) => ({
      ...template,
      fields: [...template.fields, { x: 99, y: 0, kind: 'ecke', side: 'b' } as const],
    }));
    expect(checkCatalog({ ...catalog, landscapeTemplates })).toContainEqual({ rule: 'feldkontingent', key: 't_vorlage_erste' });
  });

  it('verlangt jedes Feld der festen Insel nur einmal, mit ganzzahligen Koordinaten', () => {
    const areas = replace(catalog.areas, 't_gebiet_2', (area) => ({ ...area, fields: areaFields(0, 0) }));
    expect(checkCatalog({ ...catalog, areas })).toContainEqual({ rule: 'feld_doppelt', key: '0:0' });
    const fractional = replace(catalog.areas, 't_gebiet_2', (area) => ({
      ...area,
      fields: area.fields.map((field, index) => (index === 0 ? { ...field, x: 0.5 } : field)),
    }));
    expect(checkCatalog({ ...catalog, areas: fractional })).toContainEqual({ rule: 'feld_koordinate', key: 't_gebiet_2:0.5:-10' });
  });

  it('verlangt Landschaftsvorlagen im Band von 16 × 5 Feldern ab (0, 0), damit endlose Gebiete übereinander passen (#204)', () => {
    const shifted = replace(catalog.landscapeTemplates, 't_vorlage_zweite', (template) => ({ ...template, fields: areaFields(0, 1) }));
    expect(checkCatalog({ ...catalog, landscapeTemplates: shifted })).toContainEqual({ rule: 'feld_koordinate', key: 't_vorlage_zweite:0:5' });
  });

  it('verlangt feste Gebiete nur an Formlevels, je Formlevel höchstens eines', () => {
    const at = (level: number) => ({ ...catalog, areas: replace(catalog.areas, 't_gebiet_2', (area) => ({ ...area, unlockLevel: level })) });
    expect(checkCatalog(at(5))).toContainEqual({ rule: 'gebiet_level', key: 't_gebiet_2' });
    expect(checkCatalog(at(4))).toContainEqual({ rule: 'gebiet_level', key: 't_gebiet_2' });
  });

  it('verlangt Entdeckungs-Baupläne der passenden Rolle und Herkunft', () => {
    const areas = replace(catalog.areas, 't_gebiet_1', (area) => ({
      ...area,
      discoveryBlueprints: { ...area.discoveryBlueprints, bauen: ['t_ent_natur_1a', 't_bauen_2'] as const },
    }));
    const issues = checkCatalog({ ...catalog, areas });
    expect(issues).toContainEqual({ rule: 'entdeckung', key: 't_ent_natur_1a' });
    expect(issues).toContainEqual({ rule: 'entdeckung', key: 't_bauen_2' });
    const landscapeTemplates = replace(catalog.landscapeTemplates, 't_vorlage_erste', (template) => ({
      ...template,
      discoveryBlueprints: { bauen: 'fehlt', natur: 't_ent_natur_1a' },
    }));
    expect(checkCatalog({ ...catalog, landscapeTemplates })).toContainEqual({ rule: 'verweis_unbekannt', key: 'fehlt' });
  });

  it('verlangt Verweise auf vorhandene Deko', () => {
    const areas = replace(catalog.areas, 't_gebiet_1', (area) => ({ ...area, discoveryDeko: ['fehlt'] }));
    expect(checkCatalog({ ...catalog, areas })).toContainEqual({ rule: 'verweis_unbekannt', key: 'fehlt' });
    const challengeTemplates = [{ key: 't_challenge', name: 'Test', description: 'Test', measure: { type: 'tagesziele', required: 17 }, deko: 'fehlt_auch' } as const];
    expect(checkCatalog({ ...catalog, challengeTemplates })).toContainEqual({ rule: 'verweis_unbekannt', key: 'fehlt_auch' });
    const visitorTemplates = [
      { key: 't_igel', name: 'Igel', animal: 'igel', wish: 'bauplan_bauen', rewards: { blueprints: ['fehlt_bauplan'], deko: [] } },
    ] as const;
    expect(checkCatalog({ ...catalog, visitorTemplates })).toContainEqual({ rule: 'verweis_unbekannt', key: 'fehlt_bauplan' });
  });

  it('verlangt einen eigenen Bauplatz je Gemeinschaftsprojekt auf dem Gemeinschaftsplatz', () => {
    const second = { key: 't_projekt_2', name: 'Zwei', landmark: 'x', site: 'grundinsel:7:2' };
    expect(checkCatalog({ ...catalog, projects: [...catalog.projects, second] })).toContainEqual({ rule: 'bauplatz', key: 't_projekt_2' });
    const onBeach = { ...second, site: 'grundinsel:7:11' };
    expect(checkCatalog({ ...catalog, projects: [...catalog.projects, onBeach] })).toContainEqual({ rule: 'bauplatz', key: 't_projekt_2' });
  });

  it('verlangt Besucher mit Belohnungen der Herkunft `besucher` und mindestens einer Deko (#202)', () => {
    const igel = catalog.visitorTemplates[0]!;
    const withVisitor = (rewards: typeof igel.rewards) => ({ ...catalog, visitorTemplates: [{ ...igel, rewards }] });
    expect(checkCatalog(withVisitor({ ...igel.rewards, blueprints: ['t_weg'] }))).toContainEqual({ rule: 'besucher', key: 't_igel' });
    expect(checkCatalog(withVisitor({ ...igel.rewards, deko: ['t_ent_deko_1'] }))).toContainEqual({ rule: 'besucher', key: 't_igel' });
    expect(checkCatalog(withVisitor({ ...igel.rewards, deko: [] }))).toContainEqual({ rule: 'besucher', key: 't_igel' });
  });

  it('verlangt für Jahreszeiten-Deko einen ganzzahligen Jahresindex ab 1', () => {
    const deko = { key: 't_kuerbis', name: 'Kürbis', origin: 'jahreszeit', season: 'herbst', yearIndex: 0, art: 'kuerbis' } as const;
    expect(checkCatalog({ ...catalog, deko: [...catalog.deko, deko] })).toContainEqual({ rule: 'jahreszeit', key: 't_kuerbis' });
  });
});
