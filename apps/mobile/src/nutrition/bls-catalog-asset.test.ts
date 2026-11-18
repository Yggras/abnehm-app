/**
 * @jest-environment node
 */
import { join } from 'node:path';

import { NutritionSnapshot } from '@abnehm/contracts/nutrition';

import { catalogVersion } from '../local-db/catalog';
import { openCatalog } from '../local-db/testing/better-sqlite-catalog';
import { blsCatalogVersion } from './bls-catalog-version';
import { createFoodSearch, type FoodSearchResult } from './food-search';
import { searchNames } from './search-text';
import { noOwnFoods } from './testing/test-catalog';

// Nachweis für #154: Das eingecheckte Asset passt zum Code. Schlägt ein Test fehl, das Asset mit
// `npm run bls-katalog --workspace @abnehm/mobile` neu bauen und `blsCatalogVersion` erhöhen, damit
// installierte Kataloge ersetzt werden.

const catalog = openCatalog(join(__dirname, '../../assets/catalog/bls-katalog.db'));
afterAll(() => catalog.close());

type FoodRow = {
  key: string;
  name: string;
  search_name: string;
  search_alt: string | null;
  milli_kcal_per_100: number;
  protein_mg_per_100: number;
  carbs_mg_per_100: number;
  fat_mg_per_100: number;
};

const rows = catalog.all<FoodRow>('SELECT * FROM food ORDER BY key');
const names = (result: FoodSearchResult) => (result.type === 'treffer' ? result.hits.map((hit) => hit.snapshot.name) : []);

describe('BLS-Katalog-Asset', () => {
  it('trägt die Katalogversion der App und die Quellenangabe des BLS', () => {
    expect(catalogVersion(catalog)).toBe(blsCatalogVersion);
    expect(catalog.all('SELECT attribution FROM catalog_info')).toEqual([
      { attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0' },
    ]);
  });

  it('enthält die 7.140 Lebensmittel des BLS 4.0 außer den drei mit fehlendem Fettwert', () => {
    expect(rows).toHaveLength(7_137);
    expect(rows.map((row) => row.key)).not.toEqual(expect.arrayContaining(['R172000']));
  });

  it('hat die Suchnamen der aktuellen Normalisierung', () => {
    const outdated = rows.filter((row) => {
      const { searchName, searchAlt } = searchNames(row.name);
      return row.search_name !== searchName || row.search_alt !== searchAlt;
    });

    expect(outdated.map((row) => row.key)).toEqual([]);
  });

  // Die Abbildung einer Zeile auf den Snapshot prüft food-search.test.ts über die Suche. Hier geht es um
  // die Daten: Jede der 7.137 Zeilen über die Suche zu laden, dauerte zu lange.
  it('hält in jeder Zeile die Regeln des Nährwert-Snapshots ein', () => {
    const [{ attribution } = { attribution: '' }] = catalog.all<{ attribution: string }>('SELECT attribution FROM catalog_info');
    const invalid = rows.filter(
      (row) =>
        !NutritionSnapshot.safeParse({
          name: row.name,
          baseUnit: 'g',
          referenceAmount: 100_000,
          milliKcal: row.milli_kcal_per_100,
          proteinMg: row.protein_mg_per_100,
          carbsMg: row.carbs_mg_per_100,
          fatMg: row.fat_mg_per_100,
          portions: [],
          source: 'bls',
          attribution,
        }).success,
    );

    expect(invalid.map((row) => row.key)).toEqual([]);
  });

  it('findet typische Lebensmittel', () => {
    const foods = createFoodSearch({ catalog, ownFoods: noOwnFoods });

    expect(names(foods.search('Haferflocken')).slice(0, 2)).toEqual(['Hafer Flocken', 'Hafer Flocken, gekocht']);
    expect(names(foods.search('Musli'))).toEqual(names(foods.search('Muesli')));
    expect(names(foods.search('Musli'))[0]).toMatch(/^Müsli/);
    expect(names(foods.search('Apfel'))[0]).toBe('Apfel roh');
    expect(names(foods.search('Saft'))).toContain('Apfelsaft');
  });
});
