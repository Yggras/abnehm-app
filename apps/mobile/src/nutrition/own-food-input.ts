import {
  foodNameMaxLength,
  maxBaseAmount,
  OwnFoodUpsert,
  portionLabelMaxLength,
  type BaseUnit,
  type FoodRef,
  type NutritionSnapshot,
  type PortionConversion,
} from '@abnehm/contracts/nutrition';

import { parseDecimalMilli } from './amount-input';
import type { OwnFoodBase, OwnFoodValues } from './own-foods';
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

export type OwnFoodField =
  | 'name'
  | 'referenceAmount'
  | 'kcal'
  | 'protein'
  | 'carbs'
  | 'fat'
  | 'stueckAmount'
  | 'stueckLabel'
  | 'portionAmount'
  | 'portionLabel'
  /** Eiweiß, Kohlenhydrate und Fett zusammen. */
  | 'makros';

/** Warum eine Eingabe nicht gespeichert werden kann. */
export type OwnFoodProblem = 'leer' | 'format' | 'tausenderpunkt' | 'null' | 'zu_gross' | 'ganze_ml' | 'zu_lang' | 'makros_zu_schwer' | 'gewicht_fehlt';

export type OwnFoodCheck =
  | { type: 'werte'; values: OwnFoodValues }
  | { type: 'probleme'; problems: Readonly<Partial<Record<OwnFoodField, OwnFoodProblem>>> };


const emptyPortion: PortionDraft = { amount: '', label: '' };

/** Stück oder Portion. */
export type ConversionUnit = PortionConversion['unit'];

/** Die Formularfelder einer Umrechnung: Gewicht bzw. Volumen und Bezeichnung. */
export const conversionFields = {
  stueck: { amount: 'stueckAmount', label: 'stueckLabel' },
  portion: { amount: 'portionAmount', label: 'portionLabel' },
} as const satisfies Record<ConversionUnit, Record<'amount' | 'label', OwnFoodField>>;

/** Die Umrechnungseinheit eines Formularfelds; `undefined` für Name, Nährwerte und Bezugsmenge. */
export function conversionUnitOf(field: OwnFoodField): ConversionUnit | undefined {
  return (['stueck', 'portion'] as const).find((unit) => Object.values(conversionFields[unit]).includes(field as never));
}

/**
 * Was eine Änderung an diesem Lebensmittel speichern würde: das eigene Lebensmittel selbst oder die
 * BLS-Quelle, aus der ein eigenes Lebensmittel wird. `undefined` für ein Barcode-Produkt; dessen
 * Korrektur samt deterministischer ID liefert #160.
 */
export function editableBaseOf(ref: FoodRef): Exclude<OwnFoodBase, null> | undefined {
  return ref.type === 'off' ? undefined : ref;
}

/** Ein leeres Formular, etwa mit dem Suchtext als Name; Bezugsmenge 100 g. */
export function emptyOwnFoodDraft(name = ''): OwnFoodDraft {
  return { name: name.trim(), baseUnit: 'g', referenceAmount: '100', kcal: '', protein: '', carbs: '', fat: '', stueck: emptyPortion, portion: emptyPortion };
}

/** Das Formular vorbelegt mit der aktuellen Fassung eines Lebensmittels, etwa zum Korrigieren. */
export function ownFoodDraftOf(snapshot: NutritionSnapshot): OwnFoodDraft {
  const base = (amount: number) => milliText(snapshot.baseUnit === 'g' ? amount : amount * 1_000);
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

