import {
  foodNameMaxLength,
  maxBaseAmount,
  OwnFoodUpsert,
  portionLabelMaxLength,
  type BaseUnit,
  type NutritionSnapshot,
  type FoodValues,
  type PortionConversion,
} from '@abnehm/contracts/nutrition';

import { parseDecimalMilli } from './amount-input';
import type { OffProduct } from './food-product-source';
import { conversionFields, type ConversionUnit, type OwnFoodField, type OwnFoodProblem } from './own-food-fields';
import { milliText } from './texts';

// Formular „Eigenes Lebensmittel“ (Spezifikation 2, Abschnitte 2 und 3): Die Person tippt deutsche
// Dezimalzahlen in g, ml und kcal; daraus werden die Ganzzahlen des Vertrags (mg, ml, `milli_kcal`).
// Jede ungültige Eingabe bekommt ein Problem am Feld, damit der Bildschirm den Lösungsweg nennt
// (`problem` im Design-System). Stück und Portion sind optional; die App schätzt keine Umrechnung.

/** Eine optionale Umrechnung im Formular: Gewicht bzw. Volumen eines Stücks oder einer Portion und ihre Bezeichnung. */
export type PortionDraft = Readonly<{ amount: string; label: string }>;

/** Die Eingaben des Formulars als Text, wie die Person sie tippt. */
export type OwnFoodDraft = Readonly<{
  name: string;
  baseUnit: BaseUnit;
  /** Bezugsmenge in g bzw. ml, für die kcal und Makros gelten, etwa „100“. */
  referenceAmount: string;
  kcal: string;
  protein: string;
  carbs: string;
  fat: string;
  stueck: PortionDraft;
  portion: PortionDraft;
}>;

export type OwnFoodCheck =
  | { type: 'werte'; values: FoodValues }
  | { type: 'probleme'; problems: Readonly<Partial<Record<OwnFoodField, OwnFoodProblem>>> };


const emptyPortion: PortionDraft = { amount: '', label: '' };

/** Ein leeres Formular, etwa mit dem Suchtext als Name; Bezugsmenge 100 g. */
export function emptyOwnFoodDraft(name = ''): OwnFoodDraft {
  return { name: name.trim(), baseUnit: 'g', referenceAmount: '100', kcal: '', protein: '', carbs: '', fat: '', stueck: emptyPortion, portion: emptyPortion };
}

/**
 * Das Formular für ein unvollständiges Barcode-Produkt (Spezifikation 2, Abschnitt 5): alle bekannten Werte
 * je 100 g bzw. 100 ml vorbelegt, fehlende bleiben leer, damit die Person sie vom Etikett ergänzt.
 */
export function ownFoodDraftOfProduct(product: OffProduct): OwnFoodDraft {
  const known = (value: number | null) => (value === null ? '' : milliText(value));
  const serving = product.portions.find((portion) => portion.unit === 'portion');
  return {
    ...emptyOwnFoodDraft(product.name ?? ''),
    baseUnit: product.baseUnit,
    kcal: known(product.milliKcalPer100),
    protein: known(product.proteinMgPer100),
    carbs: known(product.carbsMgPer100),
    fat: known(product.fatMgPer100),
    portion: serving === undefined ? emptyPortion : { amount: baseAmountText(product.baseUnit, serving.baseAmount), label: serving.label ?? '' },
  };
}

/** Das Formular vorbelegt mit der aktuellen Fassung eines Lebensmittels, etwa zum Korrigieren. */
export function ownFoodDraftOf(snapshot: NutritionSnapshot): OwnFoodDraft {
  const base = (amount: number) => baseAmountText(snapshot.baseUnit, amount);
  const portionOf = (unit: ConversionUnit): PortionDraft => {
    const conversion = snapshot.portions.find((candidate) => candidate.unit === unit);
    return conversion === undefined ? emptyPortion : { amount: base(conversion.baseAmount), label: conversion.label ?? '' };
  };
  return {
    name: snapshot.name,
    baseUnit: snapshot.baseUnit,
    referenceAmount: base(snapshot.referenceAmount),
    kcal: milliText(snapshot.milliKcal),
    protein: milliText(snapshot.proteinMg),
    carbs: milliText(snapshot.carbsMg),
    fat: milliText(snapshot.fatMg),
    stueck: portionOf('stueck'),
    portion: portionOf('portion'),
  };
}

/** Prüft das Formular und liefert die Werte des eigenen Lebensmittels oder die Probleme je Feld. */
export function checkOwnFoodDraft(draft: OwnFoodDraft): OwnFoodCheck {
  const problems: Partial<Record<OwnFoodField, OwnFoodProblem>> = {};
  const fail = (field: OwnFoodField, problem: OwnFoodProblem) => {
    problems[field] = problem;
    return null;
  };

  const name = draft.name.trim();
  if (name === '') fail('name', 'leer');
  else if ([...name].length > foodNameMaxLength) fail('name', 'zu_lang');

  const referenceAmount = baseAmountOf(draft.baseUnit, draft.referenceAmount, (problem) => fail('referenceAmount', problem));
  const milliKcal = nonNegative(draft.kcal, (problem) => fail('kcal', problem));
  const proteinMg = nonNegative(draft.protein, (problem) => fail('protein', problem));
  const carbsMg = nonNegative(draft.carbs, (problem) => fail('carbs', problem));
  const fatMg = nonNegative(draft.fat, (problem) => fail('fat', problem));
  // Makros und Bezugsmenge sind nur bei g beide Massen (wie im Vertrag).
  if (draft.baseUnit === 'g' && referenceAmount !== null && proteinMg !== null && carbsMg !== null && fatMg !== null && proteinMg + carbsMg + fatMg > referenceAmount) {
    fail('makros', 'makros_zu_schwer');
  }

  const portions: PortionConversion[] = [];
  for (const unit of ['stueck', 'portion'] as const) {
    const portion = draft[unit];
    if (portion.amount.trim() === '' && portion.label.trim() === '') continue;
    const conversion = checkPortionDraft(unit, draft.baseUnit, portion);
    if (conversion.type === 'umrechnung') portions.push(conversion.conversion);
    else {
      const fields = conversionFields[unit];
      if (conversion.problems.amount !== undefined) fail(fields.amount, conversion.problems.amount);
      if (conversion.problems.label !== undefined) fail(fields.label, conversion.problems.label);
    }
  }

  if (Object.keys(problems).length > 0 || referenceAmount === null || milliKcal === null || proteinMg === null || carbsMg === null || fatMg === null) {
    return { type: 'probleme', problems };
  }
  const values = { name, baseUnit: draft.baseUnit, referenceAmount, milliKcal, proteinMg, carbsMg, fatMg, portions };
  // Dieselben Regeln wie Server und Datenbank; die Prüfungen oben decken sie ab.
  OwnFoodUpsert.parse({ ...values, origin: null });
  return { type: 'werte', values };
}

export type PortionCheck =
  | { type: 'umrechnung'; conversion: PortionConversion }
  | { type: 'probleme'; problems: Readonly<Partial<Record<'amount' | 'label', OwnFoodProblem>>> };

/** Prüft eine Umrechnung: Gewicht bzw. Volumen ist Pflicht, die Bezeichnung optional. */
export function checkPortionDraft(unit: ConversionUnit, baseUnit: BaseUnit, draft: PortionDraft): PortionCheck {
  const problems: Partial<Record<'amount' | 'label', OwnFoodProblem>> = {};
  const baseAmount = baseAmountOf(baseUnit, draft.amount, (problem) => {
    problems.amount = problem === 'leer' ? 'gewicht_fehlt' : problem;
    return null;
  });
  const label = draft.label.trim();
  if ([...label].length > portionLabelMaxLength) problems.label = 'zu_lang';
  if (baseAmount === null || problems.label !== undefined) return { type: 'probleme', problems };
  return { type: 'umrechnung', conversion: { unit, label: label === '' ? null : label, baseAmount } };
}

/** Eine Basismenge (mg bzw. ml) als Formulartext in g bzw. ml. */
function baseAmountText(baseUnit: BaseUnit, amount: number): string {
  return milliText(baseUnit === 'g' ? amount : amount * 1_000);
}

/** Menge in g bzw. ml als Basismenge (mg bzw. ml): größer 0 und höchstens 5 kg bzw. 5 l, ml ganzzahlig. */
function baseAmountOf(baseUnit: BaseUnit, text: string, fail: (problem: OwnFoodProblem) => null): number | null {
  const parsed = parseDecimalMilli(text);
  if (parsed.type === 'problem') return fail(parsed.problem);
  if (parsed.milli === 0) return fail('null');
  if (baseUnit === 'ml' && parsed.milli % 1_000 !== 0) return fail('ganze_ml');
  const amount = baseUnit === 'g' ? parsed.milli : parsed.milli / 1_000;
  return amount > maxBaseAmount[baseUnit] ? fail('zu_gross') : amount;
}

/** kcal bzw. g mit höchstens drei Nachkommastellen als `milli_kcal` bzw. mg; 0 ist erlaubt. */
function nonNegative(text: string, fail: (problem: OwnFoodProblem) => null): number | null {
  const parsed = parseDecimalMilli(text);
  return parsed.type === 'problem' ? fail(parsed.problem) : parsed.milli;
}

