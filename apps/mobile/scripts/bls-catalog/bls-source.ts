import { BlsKey } from '@abnehm/contracts/nutrition';

import type { CatalogFood } from './catalog-file.ts';
import { readSingleSheet, readZip } from './xlsx.ts';

// Einlesen des Bundeslebensmittelschlüssels 4.0 (Max Rubner-Institut, https://www.blsdb.de). Die
// Hauptdatei hat je Lebensmittel eine Zeile; die Spalten stehen in der Kopfzeile, je Nährstoff mit
// Wert, Datenherkunft und Referenz (BLS-4.0-Dokumentation, Abschnitte 2.1 und 2.2). Alle Werte gelten
// je 100 g essbaren Anteil (Abschnitt 7.2).

/** Quellenangabe der BLS-Lebensmittel (Spezifikation 2, Abschnitt 3). */
export const blsAttribution = 'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0';

/** Die Hauptdatei im ZIP-Archiv von blsdb.de. */
const dataFile = 'BLS_4_0_2025_DE/BLS_4_0_Daten_2025_DE.xlsx';

/** Benötigte Spalten mit ihrer Kopfzeile in `BLS_4_0_Daten_2025_DE.xlsx`. */
const columns = {
  key: 'BLS Code',
  name: 'Lebensmittelbezeichnung',
  kcal: 'ENERCC Energie (Kilokalorien) [kcal/100g]',
  protein: 'PROT625 Protein (Nx6,25) [g/100g]',
  fat: 'FAT Fett [g/100g]',
  carbs: 'CHO Kohlenhydrate, verfügbar [g/100g]',
} as const;

/**
 * Spuren („TR“) und Werte unter Nachweis- oder Bestimmungsgrenze sind laut Dokumentation (Abschnitt
 * 4.4) gering, aber unbekannt; für Kalorien und Makros zählen sie als 0. Ein fehlender Wert („-“) ist
 * dagegen „nicht als Null“ zu lesen: Solche Lebensmittel bleiben draußen, wie unvollständige Produkte
 * (Spezifikation 2, Abschnitt 3).
 */
const belowDetection = new Set(['TR', '<LOD', '<LOQ', '<LOD or <LOQ', '<LOQ or <LOD']);
const missing = '-';

export type ExcludedFood = Readonly<{ key: string; name: string; reason: string }>;

/** Lebensmittel aus dem ZIP-Archiv `BLS_4_0_2025_DE.zip`. */
export function readBlsArchive(archive: Buffer): { foods: CatalogFood[]; excluded: ExcludedFood[] } {
  const workbook = readZip(archive).get(dataFile);
  if (workbook === undefined) throw new Error(`Im Archiv fehlt ${dataFile}`);
  return blsFoodsFromRows(readSingleSheet(workbook));
}

/** Lebensmittel aus den Zeilen der Hauptdatei; die erste Zeile ist die Kopfzeile. */
export function blsFoodsFromRows(rows: readonly ReadonlyMap<string, string | number>[]): {
  foods: CatalogFood[];
  excluded: ExcludedFood[];
} {
  const [header = new Map(), ...data] = rows;
  const column = (title: string) => {
    const found = [...header.entries()].filter(([, value]) => value === title);
    if (found.length !== 1) throw new Error(`Spalte „${title}“ nicht genau einmal in der Kopfzeile`);
    return found[0]?.[0] as string;
  };
  const keyColumn = column(columns.key);
  const nameColumn = column(columns.name);
  const nutrientColumns = {
    kcal: column(columns.kcal),
    protein: column(columns.protein),
    carbs: column(columns.carbs),
    fat: column(columns.fat),
  };

  const foods: CatalogFood[] = [];
  const excluded: ExcludedFood[] = [];
  const keys = new Set<string>();
  for (const row of data) {
    const key = String(row.get(keyColumn) ?? '');
    if (!BlsKey.safeParse(key).success) throw new Error(`Unerwarteter BLS-Schlüssel: „${key}“`);
    if (keys.has(key)) throw new Error(`BLS-Schlüssel doppelt: ${key}`);
    keys.add(key);
    const name = String(row.get(nameColumn) ?? '').trim().replace(/\s+/g, ' ');
    if (name === '') throw new Error(`${key} hat keinen Namen`);

    const value = (nutrient: keyof typeof nutrientColumns) => nutrientValue(row.get(nutrientColumns[nutrient]), key);
    const kcal = value('kcal');
    const protein = value('protein');
    const carbs = value('carbs');
    const fat = value('fat');
    if (kcal === null || protein === null || carbs === null || fat === null) {
      const absent = Object.entries({ Energie: kcal, Eiweiß: protein, Kohlenhydrate: carbs, Fett: fat })
        .filter(([, amount]) => amount === null)
        .map(([nutrient]) => nutrient);
      excluded.push({ key, name, reason: `${absent.join(', ')} fehlt` });
      continue;
    }
    foods.push({ key, name, milliKcalPer100: kcal, proteinMgPer100: protein, carbsMgPer100: carbs, fatMgPer100: fat });
  }
  return { foods, excluded };
}

/** Wert in Tausendsteln (kcal → milli_kcal, g → mg); `null` bei fehlendem Wert. */
function nutrientValue(value: string | number | undefined, key: string): number | null {
  if (value === missing || value === undefined) return null;
  if (typeof value === 'string') {
    if (belowDetection.has(value)) return 0;
    throw new Error(`${key}: unbekannter Wert „${value}“`);
  }
  if (!(value >= 0)) throw new Error(`${key}: ungültiger Wert ${value}`);
  return thousandths(value);
}

/**
 * Exakt in Tausendstel, kaufmännisch gerundet. Gerechnet wird mit der kürzesten Dezimaldarstellung
 * der Zahl (`String`), also mit dem Wert, den Excel als 9.3000000000000007 für 9,3 speichert, als 9,3.
 */
function thousandths(value: number): number {
  const [mantissa = '', exponent = '0'] = String(value).split('e');
  const [whole = '', fraction = ''] = mantissa.split('.');
  const digits = BigInt(whole + fraction);
  const shift = Number(exponent) - fraction.length + 3;
  if (shift >= 0) return Number(digits * 10n ** BigInt(shift));
  const divisor = 10n ** BigInt(-shift);
  return Number((2n * digits + divisor) / (2n * divisor));
}
