import { entryAmount, type DisplayUnit, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import { defaultAmountMilli } from './amount-input';

/** Vorbelegung der Mengenprüfung: Anzeigeeinheit und Menge in Tausendsteln. */
export type AmountPrefill = Readonly<{ displayUnit: DisplayUnit; displayAmountMilli: number }>;

/**
 * Vorbelegung der Mengenprüfung (Spezifikation 2, Abschnitt 6): die zuletzt verwendete Menge samt Einheit,
 * sonst eine bekannte Portion, sonst 100 g bzw. 100 ml. Die letzte Menge gilt nur, wenn ihre Einheit im
 * Snapshot noch bekannt ist.
 */
export function amountPrefill(snapshot: NutritionSnapshot, last: AmountPrefill | undefined): AmountPrefill {
  if (last !== undefined && entryAmount(snapshot, last.displayUnit, last.displayAmountMilli).type === 'menge') {
    return { displayUnit: last.displayUnit, displayAmountMilli: last.displayAmountMilli };
  }
  const portion = snapshot.portions.find((conversion) => conversion.unit === 'portion') ?? snapshot.portions[0];
  const displayUnit = portion?.unit ?? snapshot.baseUnit;
  return { displayUnit, displayAmountMilli: defaultAmountMilli(snapshot, displayUnit) };
}
