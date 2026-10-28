/**
 * @jest-environment node
 */
import { createFoodSearch, type FoodSearch, type FoodSearchResult } from './food-search';
import { openTestCatalog } from './testing/test-catalog';

// Lokale Suche des Moduls „Ernährung“ (Spezifikation 2, Abschnitt 4; #154) über einem kleinen
// BLS-Testkatalog, gebaut vom selben Skript wie das echte Asset.

let catalog: ReturnType<typeof openTestCatalog>;
let foods: FoodSearch;

beforeEach(() => {
  catalog = openTestCatalog();
  foods = createFoodSearch({ catalog: catalog.database });
});

afterEach(() => catalog.close());

const names = (result: FoodSearchResult) => (result.type === 'treffer' ? result.hits.map((hit) => hit.snapshot.name) : result.type);

describe('Normalisierung', () => {
  it('findet „Müsli“ mit und ohne Umlaut und unabhängig von Groß- und Kleinschreibung', () => {
    const expected = ['Müslimischung Bircher Art (mit Trockenfrüchten und Nüssen) ungesüßt'];

    expect(names(foods.search('Muesli'))).toEqual(expect.arrayContaining(expected));
    expect(names(foods.search('Musli'))).toEqual(names(foods.search('Muesli')));
    expect(names(foods.search('MÜSLI'))).toEqual(names(foods.search('Muesli')));
  });

  it('schreibt ß als ss und fasst überzählige Leerzeichen zusammen', () => {
    const kloss = ['Kartoffelkloß (aus rohen Kartoffeln) Trockenprodukt'];

    expect(names(foods.search('Kartoffelkloß'))).toEqual(kloss);
    expect(names(foods.search('kartoffelkloss'))).toEqual(kloss);
    expect(names(foods.search('  Kartoffelkloss   roh  '))).toEqual(kloss);
  });

  it('sucht erst ab zwei Zeichen, gezählt wie getippt', () => {
    expect(foods.search('')).toEqual({ type: 'zu_kurz' });
    expect(foods.search(' a ')).toEqual({ type: 'zu_kurz' });
    expect(foods.search('ß')).toEqual({ type: 'zu_kurz' });
    expect(names(foods.search('Ha'))).toEqual(['Hafer Flocken']);
  });

  it('behandelt Sonderzeichen der Eingabe als Worttrenner, nicht als Suchsyntax', () => {
    expect(names(foods.search('"Hafer" OR *'))).toEqual([]);
    expect(names(foods.search('hafer-flocken'))).toEqual(['Hafer Flocken']);
    expect(names(foods.search('%%'))).toEqual([]);
  });
});

describe('Rangfolge', () => {
  it('stellt Namensanfang vor Wortanfang vor Treffer im Wortinneren, kürzere Namen zuerst', () => {
    expect(names(foods.search('Apfel'))).toEqual([
      // Der Name beginnt mit „Apfel“.
      'Apfel roh',
      'Apfelsaft',
      'Apfelessig',
      'Apfel geschält, roh',
      // Ein späteres Wort beginnt mit „Apfel“.
      'Rotkohl mit Apfel gedünstet',
      // „apfel“ steckt im Wortinneren.
      'Granatapfel roh',
    ]);
  });

  it('findet zusammengesetzte Wörter erst ab drei Zeichen im Wortinneren', () => {
    expect(names(foods.search('saft'))).toEqual(['Apfelsaft']);
    expect(names(foods.search('ap'))).not.toContain('Granatapfel roh');
    expect(names(foods.search('apf'))).toContain('Granatapfel roh');
  });

  it('verlangt jedes Suchwort und bewertet den Namensanfang über die ganze Anfrage', () => {
    expect(names(foods.search('apfel roh'))).toEqual(['Apfel roh', 'Apfel geschält, roh', 'Granatapfel roh']);
    // Kein Name beginnt mit „ro apfel“: Alle Wortanfangs-Treffer stehen in einer Stufe, kürzere zuerst.
    expect(names(foods.search('ro apfel'))).toEqual(['Apfel roh', 'Apfel geschält, roh', 'Rotkohl mit Apfel gedünstet', 'Granatapfel roh']);
  });
});

describe('Treffer', () => {
  it('enthält Name, kcal je 100 g, Quellenmarke BLS und den Snapshot ohne Portionsumrechnung', () => {
    const result = foods.search('Hafer Flocken');

    expect(result).toEqual({
      type: 'treffer',
      hits: [
        {
          mark: 'bls',
          ref: { type: 'bls', key: 'C133000' },
          kcalPer100: 348,
          snapshot: {
            name: 'Hafer Flocken',
            baseUnit: 'g',
            referenceAmount: 100_000,
            milliKcal: 348_000,
            proteinMg: 13_220,
            carbsMg: 53_300,
            fatMg: 6_650,
            portions: [],
            source: 'bls',
            attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0',
          },
        },
      ],
    });
  });

  it('liefert ohne Treffer eine leere Liste', () => {
    expect(foods.search('Zitronengras')).toEqual({ type: 'treffer', hits: [] });
  });
});
