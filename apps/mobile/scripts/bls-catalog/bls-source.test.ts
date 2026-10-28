/**
 * @jest-environment node
 */
import { blsFoodsFromRows } from './bls-source.ts';

// Einlesen der BLS-Hauptdatei (#154): Zeilen wie aus `BLS_4_0_Daten_2025_DE.xlsx`, Spalten nach
// ihrer Kopfzeile. Die Beispiele stammen aus dem BLS 4.0.

const header = new Map<string, string | number>([
  ['A', 'BLS Code'],
  ['B', 'Lebensmittelbezeichnung'],
  ['C', 'Food name'],
  ['G', 'ENERCC Energie (Kilokalorien) [kcal/100g]'],
  ['M', 'PROT625 Protein (Nx6,25) [g/100g]'],
  ['P', 'FAT Fett [g/100g]'],
  ['S', 'CHO Kohlenhydrate, verfügbar [g/100g]'],
]);

function row(key: string, name: string, kcal: number | string, protein: number | string, fat: number | string, carbs: number | string) {
  return new Map<string, string | number>([
    ['A', key],
    ['B', name],
    ['C', 'english name'],
    ['G', kcal],
    ['M', protein],
    ['P', fat],
    ['S', carbs],
  ]);
}

describe('blsFoodsFromRows', () => {
  it('übernimmt Schlüssel, Namen und die Werte je 100 g als milli_kcal und mg', () => {
    const { foods, excluded } = blsFoodsFromRows([header, row('C131000', 'Hafer ganzes Korn, roh', 343, 11.375, 7.09, 53.7)]);

    expect(foods).toEqual([
      { key: 'C131000', name: 'Hafer ganzes Korn, roh', milliKcalPer100: 343_000, proteinMgPer100: 11_375, carbsMgPer100: 53_700, fatMgPer100: 7_090 },
    ]);
    expect(excluded).toEqual([]);
  });

  it('rechnet Dezimalwerte exakt und kaufmännisch gerundet in Tausendstel um', () => {
    // Excel speichert 9,3 als 9.3000000000000007 und 0,027 als 2.7E-2; 1,0005 × 1000 ergibt in
    // Gleitkommazahlen 1000,4999…, gemeint sind 1000,5.
    const { foods } = blsFoodsFromRows([header, row('F110100', 'Apfel roh', 58, 9.3000000000000007, 2.7e-2, 1.0005)]);

    expect(foods[0]).toMatchObject({ proteinMgPer100: 9_300, fatMgPer100: 27, carbsMgPer100: 1_001 });
  });

  it('setzt Spuren und Werte unter Nachweis- oder Bestimmungsgrenze auf 0', () => {
    const { foods } = blsFoodsFromRows([header, row('F110600', 'Apfelsaft', 44, 'TR', '<LOD or <LOQ', '<LOQ')]);

    expect(foods[0]).toMatchObject({ proteinMgPer100: 0, fatMgPer100: 0, carbsMgPer100: 0 });
  });

  it('lässt Lebensmittel mit fehlendem Wert weg, statt ihn als 0 zu lesen', () => {
    const { foods, excluded } = blsFoodsFromRows([
      header,
      row('R411000', 'Kutterhilfsmittel (E 450)', 0, 0, '-', 0),
      row('F110100', 'Apfel roh', 58, 0.424, 0.5, 11.7),
    ]);

    expect(foods.map((food) => food.key)).toEqual(['F110100']);
    expect(excluded).toEqual([{ key: 'R411000', name: 'Kutterhilfsmittel (E 450)', reason: 'Fett fehlt' }]);
  });

  it('entfernt Leerraum am Rand und doppelte Leerzeichen im Namen', () => {
    const { foods } = blsFoodsFromRows([header, row('X537063', ' Rotkohl  mit Apfel gedünstet ', 62, 1.01, 3.74, 4.9)]);

    expect(foods[0]?.name).toBe('Rotkohl mit Apfel gedünstet');
  });

  it('bricht bei unbekanntem Aufbau ab, statt falsche Werte zu liefern', () => {
    const renamed = new Map(header).set('G', 'ENERCJ Energie (Kilojoule) [kJ/100g]');
    expect(() => blsFoodsFromRows([renamed])).toThrow(/Spalte/);
    expect(() => blsFoodsFromRows([header, row('C131000', 'Hafer', 343, 'n.a.', 7, 53)])).toThrow(/n\.a\./);
    expect(() => blsFoodsFromRows([header, row('C13100', 'Hafer', 343, 11, 7, 53)])).toThrow(/Schlüssel/);
    expect(() => blsFoodsFromRows([header, row('C131000', 'Hafer', -1, 11, 7, 53)])).toThrow(/-1/);
    expect(() =>
      blsFoodsFromRows([header, row('C131000', 'Hafer', 343, 11, 7, 53), row('C131000', 'Hafer', 343, 11, 7, 53)]),
    ).toThrow(/doppelt/);
  });
});
