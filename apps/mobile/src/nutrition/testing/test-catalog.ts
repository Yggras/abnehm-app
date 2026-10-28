import { writeCatalogFile, type CatalogFood } from '../../../scripts/bls-catalog/catalog-file.ts';
import { openCatalog } from '../../local-db/testing/better-sqlite-catalog';

/**
 * Kleiner BLS-Katalog für Modultests: elf Lebensmittel mit ihren Werten aus dem BLS 4.0
 * (`BLS_4_0_Daten_2025_DE.xlsx`; „Spuren“ und Werte unter der Nachweisgrenze als 0).
 */
export const testCatalogFoods: readonly CatalogFood[] = [
  food('C512600', 'Müslimischung Bircher Art (mit Trockenfrüchten und Nüssen) ungesüßt', 366, 11.8, 49.4, 11),
  food('C514300', 'Knuspermüslimischung, klassisch, gesüßt, angereichert mit Vitaminen und Mineralstoffen', 421, 9, 56.4, 15.95),
  food('F110100', 'Apfel roh', 58, 0.424, 11.7, 0.5),
  food('F110600', 'Apfelsaft', 44, 0.097, 10.585, 0),
  food('F120100', 'Apfel geschält, roh', 43, 0.3, 8.9, 0.13),
  food('R123100', 'Apfelessig', 18, 0.2, 0.147, 0),
  food('X537063', 'Rotkohl mit Apfel gedünstet', 62, 1.01, 4.9, 3.74),
  food('F506100', 'Granatapfel roh', 79, 0.7, 16.1, 0.6),
  food('C133000', 'Hafer Flocken', 348, 13.22, 53.3, 6.65),
  food('D701600', 'Haferflockenplätzchen', 448, 8.67, 51.8, 21.87),
  food('K240400', 'Kartoffelkloß (aus rohen Kartoffeln) Trockenprodukt', 320, 6.03, 70.7, 0.227),
];

/** Öffnet einen im Speicher gebauten Testkatalog, schreibgeschützt wie in der App. */
export function openTestCatalog(foods: readonly CatalogFood[] = testCatalogFoods, version = 'test-1') {
  const database = openCatalog(
    writeCatalogFile(foods, { version, attribution: 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0' }),
  );
  return { database, close: database.close };
}

/** Werte je 100 g wie im BLS: kcal und g. */
function food(key: string, name: string, kcal: number, protein: number, carbs: number, fat: number): CatalogFood {
  const thousandths = (value: number) => Math.round(value * 1_000);
  return {
    key,
    name,
    milliKcalPer100: thousandths(kcal),
    proteinMgPer100: thousandths(protein),
    carbsMgPer100: thousandths(carbs),
    fatMgPer100: thousandths(fat),
  };
}
