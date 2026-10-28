import {
  BaseUnit,
  DisplayUnit,
  EntryAmount,
  EntryTotals,
  FoodRef,
  NutritionSnapshot,
  PortionConversion,
  SnapshotSource,
} from '../src/nutrition.ts';
import { fixtures, without } from './define.ts';

const ownFood = '5c7e9a1b-3d5f-4a7c-9e1b-5d7f9a1c3e01';

/** Hafer Flocken aus dem BLS 4.0 (C133000), Werte je 100 g. */
const blsSnapshot = {
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
} as const;

const ownSnapshot = {
  name: 'Apfel aus dem Garten',
  baseUnit: 'g',
  referenceAmount: 100_000,
  milliKcal: 52_000,
  proteinMg: 300,
  carbsMg: 11_400,
  fatMg: 200,
  portions: [{ unit: 'stueck', label: null, baseAmount: 125_000 }],
  source: 'eigen',
  attribution: null,
} as const;

export const nutritionFixtures = {
  BaseUnit: fixtures(BaseUnit, {
    valid: { 'Gramm': 'g', 'Milliliter': 'ml' },
    invalid: { 'Stück ist keine Basiseinheit': 'stueck', 'Kilogramm': 'kg' },
  }),
  DisplayUnit: fixtures(DisplayUnit, {
    valid: { 'Gramm': 'g', 'Milliliter': 'ml', 'Stück': 'stueck', 'Portion': 'portion' },
    invalid: { 'Großgeschrieben': 'Stück', 'Liter': 'l' },
  }),
  SnapshotSource: fixtures(SnapshotSource, {
    valid: { 'BLS': 'bls', 'Open Food Facts': 'off', 'eigenes Lebensmittel': 'eigen', 'KI-Schätzung': 'ki' },
    invalid: { 'unbekannte Quelle': 'usda' },
  }),
  FoodRef: fixtures(FoodRef, {
    valid: {
      'BLS-Schlüssel': { type: 'bls', key: 'C133000' },
      'BLS-Schlüssel mit Buchstaben': { type: 'bls', key: 'B6A2100' },
      'EAN-13': { type: 'off', key: '4006040001234' },
      'EAN-8': { type: 'off', key: '40170725' },
      'eigenes Lebensmittel': { type: 'eigen', key: ownFood },
    },
    invalid: {
      'BLS-Schlüssel zu kurz': { type: 'bls', key: 'C13300' },
      'BLS-Schlüssel kleingeschrieben': { type: 'bls', key: 'c133000' },
      'Barcode mit 10 Stellen': { type: 'off', key: '4006040001' },
      'Barcode mit Buchstaben': { type: 'off', key: '400604000123X' },
      'eigenes Lebensmittel ohne UUID': { type: 'eigen', key: 'apfel' },
      'KI hat keine Referenz': { type: 'ki', key: 'C133000' },
    },
  }),
  PortionConversion: fixtures(PortionConversion, {
    valid: {
      'Stück ohne Bezeichnung': { unit: 'stueck', label: null, baseAmount: 125_000 },
      'Portion mit Bezeichnung': { unit: 'portion', label: '1 Becher', baseAmount: 150_000 },
    },
    invalid: {
      'Basiseinheit statt Stück': { unit: 'g', label: null, baseAmount: 1_000 },
      'Menge 0': { unit: 'stueck', label: null, baseAmount: 0 },
      'Bruchteil statt Ganzzahl': { unit: 'stueck', label: null, baseAmount: 12.5 },
      'leere Bezeichnung': { unit: 'portion', label: '', baseAmount: 150_000 },
      'Bezeichnung ohne null': without({ unit: 'portion', label: null, baseAmount: 150_000 }, 'label'),
    },
  }),
  NutritionSnapshot: fixtures(NutritionSnapshot, {
    valid: {
      'BLS je 100 g': blsSnapshot,
      'eigenes Lebensmittel mit Stück': ownSnapshot,
      'Open Food Facts in ml mit Portion': {
        name: 'Hafer Drink',
        baseUnit: 'ml',
        referenceAmount: 100,
        milliKcal: 46_000,
        proteinMg: 300,
        carbsMg: 6_700,
        fatMg: 1_500,
        portions: [{ unit: 'portion', label: '1 Glas', baseAmount: 250 }],
        source: 'off',
        attribution: 'Daten von Open Food Facts (openfoodfacts.org), ODbL',
      },
      'KI-Schätzung für die geschätzte Menge': {
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
      },
      'Makros genau so schwer wie die Bezugsmenge': { ...ownSnapshot, proteinMg: 0, carbsMg: 0, fatMg: 100_000 },
    },
    invalid: {
      'negative kcal': { ...ownSnapshot, milliKcal: -1 },
      'kcal als Kommazahl': { ...ownSnapshot, milliKcal: 52_000.5 },
      'Makros schwerer als die Bezugsmenge': { ...ownSnapshot, proteinMg: 1, carbsMg: 0, fatMg: 100_000 },
      'Bezugsmenge 0': { ...ownSnapshot, referenceAmount: 0 },
      'Bezugsmenge über 5 kg': { ...ownSnapshot, referenceAmount: 5_000_001 },
      'zwei Umrechnungen für Stück': {
        ...ownSnapshot,
        portions: [
          { unit: 'stueck', label: null, baseAmount: 125_000 },
          { unit: 'stueck', label: 'groß', baseAmount: 180_000 },
        ],
      },
      'Stück über 5 kg': { ...ownSnapshot, portions: [{ unit: 'stueck', label: null, baseAmount: 5_000_001 }] },
      'BLS ohne Quellenangabe': { ...blsSnapshot, attribution: null },
      'BLS mit Portionsumrechnung': { ...blsSnapshot, portions: [{ unit: 'stueck', label: null, baseAmount: 125_000 }] },
      'BLS in ml': { ...blsSnapshot, baseUnit: 'ml', referenceAmount: 100 },
      'Name mit Leerraum am Rand': { ...ownSnapshot, name: 'Apfel ' },
      'leerer Name': { ...ownSnapshot, name: '' },
      'unvollständig ohne Fett': without(ownSnapshot, 'fatMg'),
    },
  }),
  EntryAmount: fixtures(EntryAmount, {
    valid: {
      '40 g': { baseAmount: 40_000, displayUnit: 'g', displayAmountMilli: 40_000 },
      '0,5 Stück': { baseAmount: 62_500, displayUnit: 'stueck', displayAmountMilli: 500 },
      '250 ml': { baseAmount: 250, displayUnit: 'ml', displayAmountMilli: 250_000 },
    },
    invalid: {
      'Menge 0': { baseAmount: 0, displayUnit: 'g', displayAmountMilli: 0 },
      'Anzeigemenge als Kommazahl': { baseAmount: 62_500, displayUnit: 'stueck', displayAmountMilli: 0.5 },
      'unbekannte Einheit': { baseAmount: 1_000, displayUnit: 'kg', displayAmountMilli: 1_000 },
    },
  }),
  EntryTotals: fixtures(EntryTotals, {
    valid: {
      '40 g Haferflocken': { milliKcal: 139_200, proteinMg: 5_288, carbsMg: 21_320, fatMg: 2_660 },
      'Wasser ohne Nährwerte': { milliKcal: 0, proteinMg: 0, carbsMg: 0, fatMg: 0 },
    },
    invalid: {
      'negative Summe': { milliKcal: -1, proteinMg: 0, carbsMg: 0, fatMg: 0 },
      'ohne Fett': { milliKcal: 139_200, proteinMg: 5_288, carbsMg: 21_320 },
    },
  }),
};
