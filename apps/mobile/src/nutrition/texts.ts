import { weekdayOf, type LocalDate, type MealKey } from '@abnehm/contracts/base';
import { maxBaseAmount, roundMacroGrams, type BaseUnit, type DisplayUnit, type EntryTotals, type NutritionSnapshot, type SnapshotSource } from '@abnehm/contracts/nutrition';

import type { AmountInputProblem } from './amount-input';
import type { SearchMark } from './food-search';
import type { OwnFoodField, OwnFoodProblem } from './own-food-input';

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

const conversionNames = { stueck: '1 Stück', portion: '1 Portion' } as const;

/** Satz mit Lösungsweg zu einem Feld des Formulars „Eigenes Lebensmittel“ (`problem` im Design-System). */
export function ownFoodProblemText(field: OwnFoodField, problem: OwnFoodProblem, baseUnit: BaseUnit): string {
  const max = `${kilo(maxBaseAmount[baseUnit] / baseAmountPerUnit[baseUnit])} ${baseUnit}`;
  switch (problem) {
    case 'zu_lang':
      return field === 'name' ? 'Kürze den Namen auf höchstens 200 Zeichen.' : 'Kürze die Bezeichnung auf höchstens 40 Zeichen.';
    case 'makros_zu_schwer':
      return `Eiweiß, Kohlenhydrate und Fett wiegen zusammen mehr als die Menge, für die die Werte gelten. Prüfe die Werte auf der Packung.`;
    case 'format':
      return 'Gib eine Zahl ein, etwa 4,5.';
    case 'tausenderpunkt':
      return 'Gib die Zahl ohne Tausenderpunkt ein, etwa 1500 oder 1,5.';
    case 'ganze_ml':
      return 'Gib ganze ml ein, etwa 250.';
    case 'null':
      return `Gib eine Menge über 0 ${baseUnit} ein, etwa 100.`;
    case 'zu_gross':
      return field === 'referenceAmount' ? `Höchstens ${max}. Gib die Werte etwa je 100 ${baseUnit} ein.` : `Höchstens ${max}.`;
    case 'gewicht_fehlt': {
      const unit = field === 'stueckAmount' ? 'stueck' : 'portion';
      return `Gib ein, wie viel ${baseUnit} ${conversionNames[unit]} hat, oder lösche die Bezeichnung.`;
    }
    case 'leer':
      switch (field) {
        case 'name':
          return 'Gib einen Namen ein, etwa „Bircher-Müsli“.';
        case 'referenceAmount':
          return `Gib die Menge ein, für die die Werte gelten, etwa 100 ${baseUnit}.`;
        case 'kcal':
          return 'Gib die kcal von der Packung ein, etwa 150.';
        default:
          return 'Gib den Wert von der Packung ein, oder 0, wenn nichts angegeben ist.';
      }
  }
}

/** Satz mit Lösungsweg zur fehlenden Umrechnung in der Mengenprüfung. */
export function conversionProblemText(unit: 'stueck' | 'portion', problem: OwnFoodProblem, baseUnit: BaseUnit): string {
  if (problem === 'gewicht_fehlt') return `Gib ein, wie viel ${baseUnit} ${conversionNames[unit]} hat, etwa ${unit === 'stueck' ? 180 : 250}.`;
  return ownFoodProblemText(unit === 'stueck' ? 'stueckAmount' : 'portionAmount', problem, baseUnit);
}

export const nutritionTexts = {
  log: 'Protokoll',
  capture: 'Essen',
  today: 'Heute',
  intakeLabel: 'erfasst',
  intake: (today: boolean, kcal: number) => `${today ? 'Erfasst heute' : 'Erfasst'}: ${kcalText(kcal)}`,
  emptyMeal: 'Noch nichts eingetragen.',
  addTo: (meal: MealKey) => `${mealNames[meal]} hinzufügen`,
  /** Zugänglicher Name eines Eintrags; KI-Einträge tragen zusätzlich „KI-Schätzung“ (Spezifikation 2, Abschnitt 12). */
  entry: (meal: MealKey, name: string, amount: string, kcal: number, aiEstimate = false) =>
    `${mealNames[meal]}: ${name}, ${amount}, ${kcalText(kcal)}${aiEstimate ? ', KI-Schätzung' : ''}`,
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
  /** Ohne Suchtreffer: das eigene Lebensmittel mit dem Suchtext als Namen anlegen. */
  createNamed: (name: string) => `„${name.trim()}“ als eigenes Lebensmittel anlegen`,
  ownFood: {
    create: 'Eigenes Lebensmittel anlegen',
    edit: 'Eigenes Lebensmittel bearbeiten',
    correct: 'Werte korrigieren',
    correctHint: 'Die BLS-Daten bleiben unverändert. Deine Fassung ersetzt das Lebensmittel ab jetzt in der Suche.',
    name: 'Name',
    unit: 'Einheit',
    referenceAmount: 'Werte gelten für',
    kcal: 'Energie',
    protein: 'Eiweiß',
    carbs: 'Kohlenhydrate',
    fat: 'Fett',
    macros: 'Eiweiß, Kohlenhydrate und Fett',
    /** Satz über „Speichern“, wenn Felder Probleme haben, etwa „Prüfe die markierten Felder: Energie, Fett.“ */
    checkFields: (labels: readonly string[]) => `Prüfe ${labels.length === 1 ? 'das markierte Feld' : 'die markierten Felder'}: ${labels.join(', ')}.`,
    conversions: 'Stück und Portion',
    conversionsHint: 'Optional. Trag nur ein, was du weißt; die App schätzt nichts.',
    conversionAmount: (unit: 'stueck' | 'portion') => `${conversionNames[unit]} hat`,
    conversionLabel: (unit: 'stueck' | 'portion') => (unit === 'stueck' ? 'Bezeichnung für Stück' : 'Bezeichnung für Portion'),
    conversionPlaceholder: (unit: 'stueck' | 'portion') => (unit === 'stueck' ? 'etwa 1 mittelgroßer' : 'etwa 1 Glas'),
    save: 'Speichern',
    cancel: 'Abbrechen',
    delete: 'Löschen',
    deleteQuestion: (name: string) => `„${name}“ löschen? Einträge damit behalten ihre Werte.`,
    confirmDelete: 'Endgültig löschen',
  },
  /** Aktionen der Mengenprüfung zum Lebensmittel selbst. */
  editFood: 'Bearbeiten',
  addConversion: (missing: readonly ('stueck' | 'portion')[]) =>
    missing.length === 2 ? 'Stück oder Portion eintragen' : missing[0] === 'stueck' ? 'Stück eintragen' : 'Portion eintragen',
  conversion: {
    title: 'Umrechnung eintragen',
    hint: (eigen: boolean) =>
      eigen ? 'Die Umrechnung wird an deinem eigenen Lebensmittel gespeichert.' : 'Daraus entsteht ein eigenes Lebensmittel; die BLS-Daten bleiben unverändert.',
    unitName: { stueck: 'Stück', portion: 'Portion' },
    back: 'Zurück',
  },
} as const;
