import { describe, expect, it } from 'vitest';

import { EntityId, LocalDate } from '../src/base.ts';

import {
  confirmPhotoDraftKey,
  dailyIntakeKcal,
  entryAmount,
  entryTotals,
  latestAcceptedEntryDate,
  MealPhotoAnalysis,
  NutritionSnapshot,
  photoDraftComponentOf,
  photoDraftSnapshot,
  roundKcal,
  roundMacroGrams,
  sameFoodValues,
  sameSnapshot,
  type EntryAmount,
} from '../src/nutrition.ts';

// Rechenregeln der Ernährung (Spezifikation 2, Abschnitt 2): App, Server und Projektoren bilden mit
// denselben Funktionen dieselben Summen. Die erwarteten Werte sind von Hand nachgerechnet.

/** Hafer Flocken aus dem BLS 4.0 (Schlüssel C133000): 348 kcal, 13,22 g Eiweiß, 53,3 g Kohlenhydrate, 6,65 g Fett je 100 g. */
const haferflocken = NutritionSnapshot.parse({
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
});

describe('Werte vergleichen (#158)', () => {
  const ownOats = NutritionSnapshot.parse({ ...haferflocken, portions: [{ unit: 'portion', label: '1 Schale', baseAmount: 40_000 }], source: 'eigen', attribution: null });

  it('vergleicht Werte unabhängig von der Reihenfolge der Schlüssel, Umrechnungen samt Reihenfolge', () => {
    const reordered = { portions: ownOats.portions, fatMg: 6_650, carbsMg: 53_300, proteinMg: 13_220, milliKcal: 348_000, referenceAmount: 100_000, baseUnit: 'g' as const, name: 'Hafer Flocken' };
    expect(sameFoodValues(ownOats, reordered)).toBe(true);
    expect(sameFoodValues(ownOats, { ...ownOats, fatMg: 6_651 })).toBe(false);
    expect(sameFoodValues(ownOats, { ...ownOats, portions: [{ unit: 'portion', label: '1 Becher', baseAmount: 40_000 }] })).toBe(false);
    expect(sameFoodValues(ownOats, haferflocken)).toBe(false);
  });

  it('vergleicht Snapshots samt Quelle und Quellenangabe', () => {
    expect(sameSnapshot(haferflocken, NutritionSnapshot.parse({ ...haferflocken }))).toBe(true);
    expect(sameSnapshot(haferflocken, { ...haferflocken, source: 'eigen', attribution: null })).toBe(false);
  });
});

describe('entryTotals', () => {
  it('rechnet die Nährwerte des Snapshots auf die verzehrte Basismenge um', () => {
    const amount: EntryAmount = { baseAmount: 40_000, displayUnit: 'g', displayAmountMilli: 40_000 };

    expect(entryTotals(haferflocken, amount)).toEqual({
      milliKcal: 139_200,
      proteinMg: 5_288,
      carbsMg: 21_320,
      fatMg: 2_660,
    });
  });

  it('rundet kaufmännisch auf ganze milli_kcal und mg', () => {
    // 1 g mit 333 milli_kcal: 1,5 g sind 499,5 milli_kcal, 1,499 g sind 499,167 milli_kcal.
    const snapshot = { ...apfel, referenceAmount: 1_000, milliKcal: 333, proteinMg: 1, carbsMg: 0, fatMg: 0, portions: [] };

    expect(entryTotals(snapshot, { baseAmount: 1_500, displayUnit: 'g', displayAmountMilli: 1_500 }).milliKcal).toBe(500);
    expect(entryTotals(snapshot, { baseAmount: 1_499, displayUnit: 'g', displayAmountMilli: 1_499 }).milliKcal).toBe(499);
    // 1 mg Eiweiß je g: 1,5 g → 1,5 mg → 2 mg.
    expect(entryTotals(snapshot, { baseAmount: 1_500, displayUnit: 'g', displayAmountMilli: 1_500 }).proteinMg).toBe(2);
  });
});

/** Eigenes Lebensmittel: 52 kcal, 0,3 g Eiweiß, 11,4 g Kohlenhydrate, 0,2 g Fett je 100 g; ein Stück wiegt 125 g. */
const apfel = NutritionSnapshot.parse({
  name: 'Apfel',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 52_000,
  proteinMg: 300,
  carbsMg: 11_400,
  fatMg: 200,
  portions: [{ unit: 'stueck', label: null, baseAmount: 125_000 }],
  source: 'eigen',
  attribution: null,
});

/** Eigenes Lebensmittel in ml: 64 kcal je 100 ml; ein Glas sind 200 ml. */
const milch = NutritionSnapshot.parse({
  name: 'Milch',
  baseUnit: 'ml',
  referenceAmount: 100,
  milliKcal: 64_000,
  proteinMg: 3_300,
  carbsMg: 4_800,
  fatMg: 3_500,
  portions: [{ unit: 'portion', label: '1 Glas', baseAmount: 200 }],
  source: 'eigen',
  attribution: null,
});

describe('entryAmount', () => {
  it('nimmt Gramm in Tausendsteln direkt als mg', () => {
    expect(entryAmount(apfel, 'g', 40_000)).toEqual({
      type: 'menge',
      amount: { baseAmount: 40_000, displayUnit: 'g', displayAmountMilli: 40_000 },
    });
  });

  it('rechnet 0,5 Stück über die bekannte Umrechnung um', () => {
    const result = entryAmount(apfel, 'stueck', 500);

    expect(result).toEqual({ type: 'menge', amount: { baseAmount: 62_500, displayUnit: 'stueck', displayAmountMilli: 500 } });
    // 52 kcal × 62,5 g / 100 g = 32,5 kcal.
    expect(result.type === 'menge' && entryTotals(apfel, result.amount).milliKcal).toBe(32_500);
  });

  it('rundet Milliliter und Bruchteile kaufmännisch auf ganze ml', () => {
    expect(entryAmount(milch, 'ml', 250_000)).toEqual({
      type: 'menge',
      amount: { baseAmount: 250, displayUnit: 'ml', displayAmountMilli: 250_000 },
    });
    // 0,5 ml → 1 ml; 1,25 Gläser à 200 ml → 250 ml; 0,002 Gläser → 0,4 ml → 0 ml.
    expect(entryAmount(milch, 'ml', 500)).toMatchObject({ amount: { baseAmount: 1 } });
    expect(entryAmount(milch, 'portion', 1_250)).toMatchObject({ amount: { baseAmount: 250 } });
    expect(entryAmount(milch, 'portion', 2)).toEqual({ type: 'problem', problem: 'menge_zu_klein' });
  });

  it('bietet Stück, Portion und die andere Basiseinheit nur mit bekannter Umrechnung an', () => {
    expect(entryAmount(apfel, 'portion', 1_000)).toEqual({ type: 'problem', problem: 'einheit_unbekannt' });
    expect(entryAmount(apfel, 'ml', 1_000)).toEqual({ type: 'problem', problem: 'einheit_unbekannt' });
    expect(entryAmount(milch, 'g', 1_000)).toEqual({ type: 'problem', problem: 'einheit_unbekannt' });
  });

  it('erlaubt mehr als 0 und höchstens 5 kg bzw. 5 l', () => {
    expect(entryAmount(apfel, 'g', 0)).toEqual({ type: 'problem', problem: 'menge_zu_klein' });
    expect(entryAmount(milch, 'ml', 499)).toEqual({ type: 'problem', problem: 'menge_zu_klein' });
    expect(entryAmount(apfel, 'g', 5_000_000)).toMatchObject({ type: 'menge' });
    expect(entryAmount(apfel, 'g', 5_000_001)).toEqual({ type: 'problem', problem: 'menge_zu_gross' });
    expect(entryAmount(milch, 'portion', 25_000)).toMatchObject({ type: 'menge', amount: { baseAmount: 5_000 } });
    expect(entryAmount(milch, 'portion', 25_003)).toEqual({ type: 'problem', problem: 'menge_zu_gross' });
  });
});

describe('Rundung für die Anzeige', () => {
  it('rundet kcal kaufmännisch auf ganze kcal', () => {
    expect(roundKcal(0)).toBe(0);
    expect(roundKcal(499)).toBe(0);
    expect(roundKcal(500)).toBe(1);
    expect(roundKcal(1_499)).toBe(1);
    expect(roundKcal(1_500)).toBe(2);
    expect(roundKcal(1_210_000)).toBe(1_210);
  });

  it('bildet die Tagesaufnahme aus der Summe der milli_kcal, nicht aus gerundeten Einträgen', () => {
    // Je Eintrag 0,4 kcal ergäben gerundet 0 kcal; zusammen sind es 0,8 kcal, also 1 kcal.
    expect(dailyIntakeKcal([400, 400])).toBe(1);
    expect(dailyIntakeKcal([139_200, 32_500])).toBe(172);
    expect(dailyIntakeKcal([])).toBe(0);
  });

  it('rundet Makros auf ganze g und unter 10 g auf eine Nachkommastelle', () => {
    expect(roundMacroGrams(0)).toBe(0);
    expect(roundMacroGrams(49)).toBe(0);
    expect(roundMacroGrams(50)).toBe(0.1);
    expect(roundMacroGrams(1_250)).toBe(1.3);
    expect(roundMacroGrams(9_949)).toBe(9.9);
    // 9,95 g ergeben auf eine Stelle 10,0 g; ab 10 g zählt nur die ganze Zahl.
    expect(roundMacroGrams(9_950)).toBe(10);
    expect(roundMacroGrams(10_499)).toBe(10);
    expect(roundMacroGrams(10_500)).toBe(11);
    expect(roundMacroGrams(53_300)).toBe(53);
  });
});

describe('latestAcceptedEntryDate', () => {
  it('erlaubt einen Tag Toleranz nach dem aktuellen lokalen Tag der Person, auch über Monats- und Jahresgrenzen', () => {
    expect(latestAcceptedEntryDate(LocalDate.parse('2026-10-14'))).toBe('2026-10-15');
    expect(latestAcceptedEntryDate(LocalDate.parse('2026-10-31'))).toBe('2026-11-01');
    expect(latestAcceptedEntryDate(LocalDate.parse('2026-12-31'))).toBe('2027-01-01');
    expect(latestAcceptedEntryDate(LocalDate.parse('2028-02-28'))).toBe('2028-02-29');
  });
});

describe('Fotoanalyse: Bestandteile in Vertragseinheiten', () => {
  it('rechnet Gramm in mg und kcal in milli_kcal um, kaufmännisch gerundet', () => {
    expect(
      photoDraftComponentOf({ name: 'Bratkartoffeln', amount: 180, unit: 'g', kcal: 270.4, proteinG: 4.0006, carbsG: 32, fatG: 13.25 }),
    ).toEqual({ name: 'Bratkartoffeln', baseUnit: 'g', baseAmount: 180_000, milliKcal: 270_400, proteinMg: 4_001, carbsMg: 32_000, fatMg: 13_250 });
  });

  it('nimmt Milliliter als ganze ml', () => {
    expect(photoDraftComponentOf({ name: 'Apfelschorle', amount: 330.4, unit: 'ml', kcal: 82.5, proteinG: 0, carbsG: 19.8, fatG: 0 })).toEqual({
      name: 'Apfelschorle',
      baseUnit: 'ml',
      baseAmount: 330,
      milliKcal: 82_500,
      proteinMg: 0,
      carbsMg: 19_800,
      fatMg: 0,
    });
  });

  it('lehnt Mengen unter einer Basiseinheit, über 5 kg bzw. 5 l und Makros über der Menge ab', () => {
    const base = { name: 'Reis', unit: 'g', kcal: 1, proteinG: 0, carbsG: 0, fatG: 0 } as const;
    expect(photoDraftComponentOf({ ...base, amount: 0.0004 })).toBeNull();
    expect(photoDraftComponentOf({ ...base, amount: 5_000.0004 })).toEqual(expect.objectContaining({ baseAmount: 5_000_000 }));
    expect(photoDraftComponentOf({ ...base, amount: 5_001 })).toBeNull();
    expect(photoDraftComponentOf({ ...base, amount: 0.4, unit: 'ml' })).toBeNull();
    expect(photoDraftComponentOf({ ...base, amount: 100, proteinG: 40, carbsG: 40, fatG: 20.001 })).toBeNull();
    // Bei Millilitern hinge der Vergleich von der Dichte ab; er entfällt wie beim Snapshot.
    expect(photoDraftComponentOf({ ...base, amount: 100, unit: 'ml', proteinG: 40, carbsG: 40, fatG: 30 })).not.toBeNull();
  });

  it('MealPhotoAnalysis prüft beim Parsen, was sich nicht in Vertragseinheiten umrechnen lässt', () => {
    const component = { name: 'Spiegelei', amount: 60, unit: 'g', kcal: 110, proteinG: 7.5, carbsG: 0.4, fatG: 8.8 } as const;
    expect(MealPhotoAnalysis.safeParse({ components: [component] }).success).toBe(true);
    expect(MealPhotoAnalysis.safeParse({ components: [] }).success).toBe(true);
    expect(MealPhotoAnalysis.safeParse({ components: [{ ...component, amount: 6_000 }] }).success).toBe(false);
    expect(MealPhotoAnalysis.safeParse({ components: [{ ...component, kcal: -1 }] }).success).toBe(false);
    expect(MealPhotoAnalysis.safeParse({ components: [{ ...component, fatG: 60 }] }).success).toBe(false);
    expect(MealPhotoAnalysis.safeParse({ components: Array.from({ length: 16 }, () => component) }).success).toBe(false);
  });
});

describe('Fotoentwurf bestätigen', () => {
  const potatoes = { name: 'Bratkartoffeln', baseUnit: 'g', baseAmount: 180_000, milliKcal: 270_000, proteinMg: 4_000, carbsMg: 32_000, fatMg: 13_000 } as const;

  it('bildet aus einem Bestandteil den KI-Snapshot mit der geschätzten Menge als Bezugsmenge', () => {
    const snapshot = photoDraftSnapshot(potatoes);
    expect(snapshot).toEqual({
      name: 'Bratkartoffeln',
      baseUnit: 'g',
      referenceAmount: 180_000,
      milliKcal: 270_000,
      proteinMg: 4_000,
      carbsMg: 32_000,
      fatMg: 13_000,
      portions: [],
      source: 'ki',
      attribution: null,
    });
    // Unverändert übernommen ergibt er genau die geschätzten Werte, die halbe Menge die halben.
    const whole = entryAmount(snapshot, 'g', 180_000);
    const half = entryAmount(snapshot, 'g', 90_000);
    if (whole.type !== 'menge' || half.type !== 'menge') throw new Error('Menge erwartet');
    expect(entryTotals(snapshot, whole.amount)).toEqual({ milliKcal: 270_000, proteinMg: 4_000, carbsMg: 32_000, fatMg: 13_000 });
    expect(entryTotals(snapshot, half.amount)).toEqual({ milliKcal: 135_000, proteinMg: 2_000, carbsMg: 16_000, fatMg: 6_500 });
  });

  it('der fachliche Schlüssel nennt den Fotoentwurf', () => {
    expect(confirmPhotoDraftKey(EntityId.parse('5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e03'))).toBe('fotoentwurf:5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e03');
  });
});
