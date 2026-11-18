import {
  entryAmount,
  entryTotals,
  type AmountProblem,
  type DisplayUnit,
  type EntryAmount,
  type EntryTotals,
  type NutritionSnapshot,
} from '@abnehm/contracts/nutrition';

// Mengenfeld der Mengenprüfung (Spezifikation 2, Abschnitte 2 und 6): Die eingetippte Zahl wird zur
// Anzeigemenge in Tausendsteln, daraus Basismenge und Summen nach den Rechenregeln des Vertragsmoduls.
// Komma und Punkt trennen gleichermaßen die Nachkommastellen. „1.500“ ist im Deutschen 1500, als
// Dezimalzahl aber 1,5; statt zu raten, fragt das Feld nach der Schreibweise ohne Tausenderpunkt.

/**
 * Warum eine eingegebene Menge nicht gespeichert werden kann: leer, keine Zahl, ein Punkt vor genau drei
 * Ziffern (im Deutschen ein Tausenderpunkt, „1.500“) oder eine Regel der Menge.
 */
export type AmountInputProblem = AmountProblem | 'leer' | 'format' | 'tausenderpunkt';

/**
 * Standardmenge einer Einheit in Tausendsteln, wenn nichts Eigenes vorliegt (Spezifikation 2,
 * Abschnitt 6): 100 g bzw. 100 ml in der Basiseinheit, sonst 1 Stück bzw. 1 Portion.
 */
export function defaultAmountMilli(snapshot: NutritionSnapshot, displayUnit: DisplayUnit): number {
  return displayUnit === snapshot.baseUnit ? 100_000 : 1_000;
}

export type AmountCheck =
  | { type: 'menge'; amount: EntryAmount; totals: EntryTotals }
  | { type: 'problem'; problem: AmountInputProblem };

/** Höchstens sieben Vor- und drei Nachkommastellen: Tausendstel sind die feinste Anzeigemenge. */
const decimalPattern = /^(\d{0,7})(?:[.,](\d{1,3}))?$/;

/** Eine eingetippte deutsche Dezimalzahl in Tausendsteln, etwa „0,5“ → 500; sonst warum nicht. */
export type DecimalInput = { type: 'zahl'; milli: number } | { type: 'problem'; problem: 'leer' | 'format' | 'tausenderpunkt' };

export function parseDecimalMilli(input: string): DecimalInput {
  const text = input.trim();
  if (text === '') return { type: 'problem', problem: 'leer' };
  const match = decimalPattern.exec(text);
  if (match === null || (match[1] === '' && match[2] === undefined)) return { type: 'problem', problem: 'format' };
  if (text.includes('.') && match[1] !== '' && match[2]?.length === 3) return { type: 'problem', problem: 'tausenderpunkt' };
  return { type: 'zahl', milli: Number(match[1] || '0') * 1_000 + Number((match[2] ?? '').padEnd(3, '0')) };
}

export function checkAmountInput(snapshot: NutritionSnapshot, displayUnit: DisplayUnit, input: string): AmountCheck {
  const parsed = parseDecimalMilli(input);
  if (parsed.type === 'problem') return parsed;
  const amount = entryAmount(snapshot, displayUnit, parsed.milli);
  if (amount.type === 'problem') return { type: 'problem', problem: amount.problem };
  return { type: 'menge', amount: amount.amount, totals: entryTotals(snapshot, amount.amount) };
}
