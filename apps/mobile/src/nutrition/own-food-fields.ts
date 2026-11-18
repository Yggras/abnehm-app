import type { PortionConversion } from '@abnehm/contracts/nutrition';

// Felder und Probleme des Formulars „Eigenes Lebensmittel“ (#157), getrennt von Prüfung und Texten,
// damit beide sie ohne gegenseitigen Import nutzen.

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

/** Stück oder Portion. */
export type ConversionUnit = PortionConversion['unit'];

/** Die Formularfelder einer Umrechnung: Gewicht bzw. Volumen und Bezeichnung. */
export const conversionFields = {
  stueck: { amount: 'stueckAmount', label: 'stueckLabel' },
  portion: { amount: 'portionAmount', label: 'portionLabel' },
} as const satisfies Record<ConversionUnit, Record<'amount' | 'label', OwnFoodField>>;

const conversionUnitByField: Readonly<Partial<Record<OwnFoodField, ConversionUnit>>> = {
  stueckAmount: 'stueck',
  stueckLabel: 'stueck',
  portionAmount: 'portion',
  portionLabel: 'portion',
};

/** Die Umrechnungseinheit eines Formularfelds; `undefined` für Name, Nährwerte und Bezugsmenge. */
export function conversionUnitOf(field: OwnFoodField): ConversionUnit | undefined {
  return conversionUnitByField[field];
}
