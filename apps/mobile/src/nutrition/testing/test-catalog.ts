import { writeCatalogFile, type CatalogFood } from '../../../scripts/bls-catalog/catalog-file.ts';
import { openCatalog } from '../../local-db/testing/better-sqlite-catalog';
import type { OwnFoodLookup } from '../food-search';

/**
 * Kleiner BLS-Katalog für Modultests: dreizehn Lebensmittel mit ihren Werten aus dem Asset
 * (BLS 4.0), je 100 g in `milli_kcal` bzw. mg.
 */
export const testCatalogFoods: readonly CatalogFood[] = [
  food('C512600', 'Müslimischung Bircher Art (mit Trockenfrüchten und Nüssen) ungesüßt', 366_000, 11_800, 49_400, 11_000),
  food('C514300', 'Knuspermüslimischung, klassisch, gesüßt, angereichert mit Vitaminen und Mineralstoffen', 421_000, 9_000, 56_400, 15_950),
  food('F110100', 'Apfel roh', 58_000, 424, 11_700, 500),
  food('F110600', 'Apfelsaft', 44_000, 97, 10_585, 0),
  food('F120100', 'Apfel geschält, roh', 43_000, 300, 8_900, 130),
  food('R123100', 'Apfelessig', 18_000, 200, 147, 0),
  food('X537063', 'Rotkohl mit Apfel gedünstet', 62_000, 1_010, 4_900, 3_740),
  food('F506100', 'Granatapfel roh', 79_000, 700, 16_100, 600),
  food('C133000', 'Hafer Flocken', 348_000, 13_220, 53_300, 6_650),
  food('C133032', 'Hafer Flocken, gekocht', 66_000, 2_499, 10_000, 1_257),
  food('D701600', 'Haferflockenplätzchen', 448_000, 8_670, 51_800, 21_870),
  food('D701700', 'Haferflocken-Nussplätzchen', 517_000, 9_699, 37_900, 35_161),
  food('K240400', 'Kartoffelkloß (aus rohen Kartoffeln) Trockenprodukt', 320_000, 6_030, 70_700, 227),
];

/** Öffnet einen im Speicher gebauten Testkatalog, schreibgeschützt wie in der App. */
export function openTestCatalog(foods: readonly CatalogFood[] = testCatalogFoods, version = 'test-1') {
  const database = openCatalog(
    writeCatalogFile(foods, { version, attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0' }),
  );
  return { database, close: database.close };
}

function food(key: string, name: string, milliKcal: number, proteinMg: number, carbsMg: number, fatMg: number): CatalogFood {
  return { key, name, milliKcalPer100: milliKcal, proteinMgPer100: proteinMg, carbsMgPer100: carbsMg, fatMgPer100: fatMg };
}

/** Für Tests nur über den BLS-Katalog: ein Konto ohne eigene Lebensmittel. */
export const noOwnFoods: OwnFoodLookup = { search: () => [], overlaidOrigins: () => new Set() };
