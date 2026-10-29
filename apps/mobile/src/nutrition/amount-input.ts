import { entryAmount, entryTotals, type DisplayUnit, type EntryAmount, type EntryTotals, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { AmountInputProblem } from './texts';

// Mengenfeld der Mengenprüfung (Spezifikation 2, Abschnitte 2 und 6): Die eingetippte Zahl wird zur
// Anzeigemenge in Tausendsteln, daraus Basismenge und Summen nach den Rechenregeln des Vertragsmoduls.
// Komma und Punkt trennen gleichermaßen die Nachkommastellen; Tausenderpunkte gibt es im Feld nicht.

export type AmountCheck =
  | { type: 'menge'; amount: EntryAmount; totals: EntryTotals }
  | { type: 'problem'; problem: AmountInputProblem };

/** Höchstens sieben Vor- und drei Nachkommastellen: Tausendstel sind die feinste Anzeigemenge. */
const amountPattern = /^(\d{0,7})(?:[.,](\d{1,3}))?$/;

export function checkAmountInput(snapshot: NutritionSnapshot, displayUnit: DisplayUnit, input: string): AmountCheck {
  const text = input.trim();
  if (text === '') return { type: 'problem', problem: 'leer' };
  const match = amountPattern.exec(text);
  if (match === null || (match[1] === '' && match[2] === undefined)) return { type: 'problem', problem: 'format' };
  const displayAmountMilli = Number(match[1] || '0') * 1_000 + Number((match[2] ?? '').padEnd(3, '0'));
  const amount = entryAmount(snapshot, displayUnit, displayAmountMilli);
  if (amount.type === 'problem') return { type: 'problem', problem: amount.problem };
  return { type: 'menge', amount: amount.amount, totals: entryTotals(snapshot, amount.amount) };
}
