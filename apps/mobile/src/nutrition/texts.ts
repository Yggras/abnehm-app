import { weekdayOf, type LocalDate, type MealKey } from '@abnehm/contracts/base';
import { maxBaseAmount, roundMacroGrams, type BaseUnit, type DisplayUnit, type EntryTotals, type NutritionSnapshot, type SnapshotSource } from '@abnehm/contracts/nutrition';

import type { AmountInputProblem } from './amount-input';
import type { SearchMark } from './food-search';

// Sichtbare Texte und zugängliche Namen der Ernährung (Spezifikation 2, Abschnitt 12): deutsche Zahlen
// („1.210 kcal“, „0,5 Stück“), Einheiten mit Leerzeichen, ohne Schuld- und Verlust-Framing.

export const mealNames: Readonly<Record<MealKey, string>> = {
  fruehstueck: 'Frühstück',
  mittagessen: 'Mittagessen',
  abendessen: 'Abendessen',
  snacks: 'Snacks',
};

const weekdays = { montag: 'Montag', dienstag: 'Dienstag', mittwoch: 'Mittwoch', donnerstag: 'Donnerstag', freitag: 'Freitag', samstag: 'Samstag', sonntag: 'Sonntag' } as const;

/** Lokaler Tag mit Wochentag, etwa „Mittwoch, 14.10.2026“. */
export function dateText(localDate: LocalDate): string {
  return `${weekdays[weekdayOf(localDate)]}, ${localDate.split('-').reverse().join('.')}`;
}

/** Ganze kcal mit deutschem Tausenderpunkt, etwa „1.210 kcal“. */
export function kcalText(kcal: number): string {
  return `${kcal.toLocaleString('de-DE')} kcal`;
}

/** Menge in Tausendsteln als deutsche Zahl ohne überflüssige Nullen, etwa „60“ oder „0,5“. */
export function milliText(milli: number): string {
  return (milli / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 3, useGrouping: false });
}

const unitNames: Readonly<Record<DisplayUnit, (amount: number) => string>> = {
  g: () => 'g',
  ml: () => 'ml',
  stueck: () => 'Stück',
  portion: (amount) => (amount === 1_000 ? 'Portion' : 'Portionen'),
};

/** Eintragsmenge, etwa „60 g“, „0,5 Stück“ oder „2 Portionen“. */
export function amountText(displayUnit: DisplayUnit, displayAmountMilli: number): string {
  return `${(displayAmountMilli / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 3 })} ${unitNames[displayUnit](displayAmountMilli)}`;
}

/** Einheit im Mengenfeld, etwa „g“ oder „Stück“. */
export function unitText(unit: DisplayUnit): string {
  return unitNames[unit](1_000);
}

/** Beschriftung eines Einheiten-Chips: g bzw. ml oder die Bezeichnung der Umrechnung, etwa „1 Becher“. */
export function unitChipText(snapshot: NutritionSnapshot, unit: DisplayUnit): string {
  if (unit === 'g' || unit === 'ml') return unit;
  return snapshot.portions.find((portion) => portion.unit === unit)?.label ?? unitNames[unit](1_000);
}

/** Makros in g: ganze g, unter 10 g mit einer Nachkommastelle. */
function gramsText(mg: number): string {
  const grams = roundMacroGrams(mg);
  return `${grams.toLocaleString('de-DE', grams < 10 ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : { maximumFractionDigits: 0 })} g`;
}

export function macrosText(totals: Pick<EntryTotals, 'proteinMg' | 'carbsMg' | 'fatMg'>): string {
  return `Eiweiß ${gramsText(totals.proteinMg)} · Kohlenhydrate ${gramsText(totals.carbsMg)} · Fett ${gramsText(totals.fatMg)}`;
}

export const markNames: Readonly<Record<SearchMark, string>> = { favorit: 'Favorit', zuletzt: 'Zuletzt', eigen: 'Eigen', produkt: 'Produkt', bls: 'BLS' };

export const sourceNames: Readonly<Record<SnapshotSource, string>> = { bls: 'BLS', off: 'Open Food Facts', eigen: 'Eigenes Lebensmittel', ki: 'KI-Schätzung' };

/** Basismenge (mg bzw. ml) eines Gramms bzw. Milliliters. */
const baseAmountPerUnit: Readonly<Record<BaseUnit, number>> = { g: 1_000, ml: 1 };
const kilo = (value: number) => value.toLocaleString('de-DE');

/** Satz mit Lösungsweg zu einer ungültigen Menge (`problem` im Design-System). */
export function amountProblemText(problem: AmountInputProblem, baseUnit: BaseUnit): string {
  switch (problem) {
    case 'leer':
      return 'Gib eine Menge ein, etwa 60.';
    case 'format':
      return 'Gib die Menge als Zahl ein, etwa 60 oder 0,5.';
    case 'menge_zu_klein':
      return 'Gib eine Menge über 0 ein, etwa 60.';
    case 'tausenderpunkt':
      return 'Gib die Menge ohne Tausenderpunkt ein, etwa 1500 oder 1,5.';
    case 'menge_zu_gross':
      return `Höchstens ${kilo(maxBaseAmount[baseUnit] / baseAmountPerUnit[baseUnit])} ${baseUnit} je Eintrag. Teile größere Mengen auf mehrere Einträge auf.`;
    case 'einheit_unbekannt':
      return `Diese Einheit kennt das Lebensmittel nicht. Wähle ${baseUnit}.`;
  }
}

export const nutritionTexts = {
  log: 'Protokoll',
  capture: 'Essen',
  today: 'Heute',
  intakeLabel: 'erfasst',
  intake: (today: boolean, kcal: number) => `${today ? 'Erfasst heute' : 'Erfasst'}: ${kcalText(kcal)}`,
  emptyMeal: 'Noch nichts eingetragen.',
  addTo: (meal: MealKey) => `${mealNames[meal]} hinzufügen`,
  entry: (meal: MealKey, name: string, amount: string, kcal: number) => `${mealNames[meal]}: ${name}, ${amount}, ${kcalText(kcal)}`,
  search: 'Lebensmittel suchen',
  noHits: (query: string) => `Keine Treffer für „${query.trim()}“.`,
  per100: (kcal: number, baseUnit: BaseUnit) => `${kcalText(kcal)} je 100 ${baseUnit}`,
  amount: 'Menge',
  /** Ohne gültige Menge gibt es keine kcal. */
  noKcal: '– kcal',
  loading: (screen: string) => `${screen} lädt`,
  add: 'Hinzufügen',
  close: 'Schließen',
  slots: {
    barcode: 'Barcode scannen',
    foto: 'Foto aufnehmen',
    mahlzeitenfavoriten: 'Mahlzeitenfavoriten',
    zuletzt: 'Zuletzt verwendet',
    lebensmittelfavoriten: 'Lebensmittelfavoriten',
    eigenes_lebensmittel: 'Eigenes Lebensmittel anlegen',
  },
  slotInWork: 'Kommt noch',
} as const;
