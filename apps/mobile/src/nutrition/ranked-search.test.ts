/** @jest-environment node */
import { createBlsCatalog } from './bls-catalog';
import { rankName } from './ranked-search';
import { searchNames, searchQuery } from './search-text';
import { openTestCatalog, testCatalogFoods } from './testing/test-catalog';

// Nachweis für #158: `rankName` ordnet einzelne Namen genau wie die SQL-Rangfolge der Suche (#154), damit
// Lebensmittelfavoriten und „Zuletzt verwendet“ nach denselben Regeln treffen wie Katalog und eigene
// Lebensmittel. Verglichen wird über alle Namen des Testkatalogs mit denselben Gleichstandsregeln
// (kürzerer Name, dann Name, dann Schlüssel).

const queries = ['Apfel', 'apfel roh', 'Haferflocken', 'Hafer Flocken', 'flocken', 'Muesli', 'Musli', 'saft', 'roh', 'ap', 'Ha Fl', 'Kartoffelkloß', 'gekocht', 'xyz'];

let catalog: ReturnType<typeof openTestCatalog>;
beforeEach(() => (catalog = openTestCatalog()));
afterEach(() => catalog.close());

describe('rankName', () => {
  it.each(queries)('ordnet „%s“ wie die SQL-Suche', (input) => {
    const query = searchQuery(input)!;
    const fromSql = createBlsCatalog(catalog.database).search(query, 100).map((food) => food.key);

    const inMemory = testCatalogFoods
      .flatMap((food) => {
        const tier = rankName(query, food.name);
        return tier === null ? [] : [{ key: food.key, tier, name: searchNames(food.name).searchName }];
      })
      .sort((a, b) => a.tier - b.tier || a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || (a.key < b.key ? -1 : 1))
      .map((food) => food.key);

    expect(inMemory).toEqual(fromSql);
  });
});
