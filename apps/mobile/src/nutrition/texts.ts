import { minutesOfDay, readingOf } from '@abnehm/clock';
import { localDateAfter, weekdayOf, type Instant, type LocalDate, type MealKey, type TimeZone } from '@abnehm/contracts/base';
import {
  foodNameMaxLength,
  maxBaseAmount,
  portionLabelMaxLength,
  roundMacroGrams,
  type BaseUnit,
  type CaptureMethod,
  type DisplayUnit,
  type EntryTotals,
  type NutritionSnapshot,
  type SnapshotSource,
} from '@abnehm/contracts/nutrition';

import type { AmountInputProblem } from './amount-input';
import type { SearchMark } from './food-search';
import { conversionFields, conversionUnitOf, type ConversionUnit, type OwnFoodField, type OwnFoodProblem } from './own-food-fields';

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
  return `${weekdays[weekdayOf(localDate)]}, ${numericDate(localDate)}`;
}

/** Lokaler Tag als Zahl, etwa „14.10.2026“. */
function numericDate(localDate: LocalDate): string {
  return localDate.split('-').reverse().join('.');
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

/** Erfassungsart eines Eintrags in den Details (Spezifikation 2, Abschnitt 6). */
export const captureMethodNames: Readonly<Record<CaptureMethod, string>> = {
  suche: 'Suche',
  barcode: 'Barcode',
  foto: 'Foto',
  lebensmittelfavorit: 'Lebensmittelfavorit',
  mahlzeitenfavorit: 'Mahlzeitenfavorit',
  zuletzt: 'Zuletzt verwendet',
  eigenes_lebensmittel: 'Eigenes Lebensmittel',
};

/** Uhrzeit eines Zeitpunkts in der Zone seiner Erfassung, etwa „08:40 Uhr“. */
export function timeText(instant: Instant, timeZone: TimeZone): string {
  const minutes = minutesOfDay(readingOf(instant, timeZone));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')} Uhr`;
}

/** Bezugsmenge eines Snapshots, etwa „100 g“ oder „250 ml“. */
export function referenceText(snapshot: Pick<NutritionSnapshot, 'baseUnit' | 'referenceAmount'>): string {
  return `${(snapshot.referenceAmount / baseAmountPerUnit[snapshot.baseUnit]).toLocaleString('de-DE', { maximumFractionDigits: 3 })} ${snapshot.baseUnit}`;
}

/**
 * Tag im Protokoll in zwei Teilen: `day` ist „Heute“, „Gestern“ oder der Wochentag, `date` der Rest, etwa
 * „Dienstag, 13.10.2026“ bzw. „12.10.2026“. Der Tageskopf zeigt `day` kräftig und `date` gedämpft darunter.
 */
export function logDayParts(localDate: LocalDate, today: LocalDate): { day: string; date: string } {
  if (localDate === today) return { day: nutritionTexts.today, date: dateText(localDate) };
  if (localDateAfter(localDate, 1) === today) return { day: 'Gestern', date: dateText(localDate) };
  return { day: weekdays[weekdayOf(localDate)], date: numericDate(localDate) };
}

/** Tag im Protokoll in einer Zeile: „Heute, Mittwoch, 14.10.2026“, „Gestern, …“ oder Wochentag und Datum. */
export function logDayText(localDate: LocalDate, today: LocalDate): string {
  const { day, date } = logDayParts(localDate, today);
  return `${day}, ${date}`;
}

/** Ziel beim Erfassen: Mahlzeit und Tag, heute kurz („Abendessen · Heute“), sonst wie im Protokoll. */
export function captureTargetText(meal: MealKey, localDate: LocalDate, today: LocalDate): string {
  return `${mealNames[meal]} · ${localDate === today ? nutritionTexts.today : logDayText(localDate, today)}`;
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

/** Texte je Umrechnungseinheit: Name, „1 …“, Beispiel der Bezeichnung und ein Beispielgewicht für den Lösungsweg. */
const conversionTexts: Readonly<Record<ConversionUnit, Readonly<{ name: string; one: string; placeholder: string; example: number }>>> = {
  stueck: { name: 'Stück', one: '1 Stück', placeholder: 'etwa 1 mittelgroßer', example: 180 },
  portion: { name: 'Portion', one: '1 Portion', placeholder: 'etwa 1 Glas', example: 250 },
};

/** Satz mit Lösungsweg zu einem Feld des Formulars „Eigenes Lebensmittel“ (`problem` im Design-System). */
export function ownFoodProblemText(field: OwnFoodField, problem: OwnFoodProblem, baseUnit: BaseUnit): string {
  const max = `${kilo(maxBaseAmount[baseUnit] / baseAmountPerUnit[baseUnit])} ${baseUnit}`;
  switch (problem) {
    case 'zu_lang':
      return field === 'name' ? `Kürze den Namen auf höchstens ${foodNameMaxLength} Zeichen.` : `Kürze die Bezeichnung auf höchstens ${portionLabelMaxLength} Zeichen.`;
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
      return `Gib ein, wie viel ${baseUnit} ${conversionTexts[conversionUnitOf(field) ?? 'portion'].one} hat, oder lösche die Bezeichnung.`;
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
export function conversionProblemText(unit: ConversionUnit, problem: OwnFoodProblem, baseUnit: BaseUnit): string {
  const { one, example } = conversionTexts[unit];
  if (problem === 'gewicht_fehlt') return `Gib ein, wie viel ${baseUnit} ${one} hat, etwa ${example}.`;
  return ownFoodProblemText(conversionFields[unit].amount, problem, baseUnit);
}

export const nutritionTexts = {
  log: 'Protokoll',
  capture: 'Essen',
  today: 'Heute',
  intakeLabel: 'erfasst',
  intake: (today: boolean, kcal: number) => `${today ? 'Erfasst heute' : 'Erfasst'}: ${kcalText(kcal)}`,
  previousDay: 'Vorheriger Tag',
  nextDay: 'Nächster Tag',
  /** Springt aus einem früheren Tag zurück auf heute. */
  backToToday: 'Heute',
  showMacros: 'Makros anzeigen',
  hideMacros: 'Makros ausblenden',
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
    conversionAmount: (unit: ConversionUnit) => `${conversionTexts[unit].one} hat`,
    conversionLabel: (unit: ConversionUnit) => `Bezeichnung für ${conversionTexts[unit].name}`,
    conversionPlaceholder: (unit: ConversionUnit) => conversionTexts[unit].placeholder,
    save: 'Speichern',
    cancel: 'Abbrechen',
    delete: 'Löschen',
    deleteQuestion: (name: string) => `„${name}“ löschen? Einträge damit behalten ihre Werte.`,
    confirmDelete: 'Endgültig löschen',
  },
  /** Mengenansicht eines bestehenden Eintrags (#156). */
  edit: {
    meal: 'Mahlzeit',
    save: 'Speichern',
    delete: 'Löschen',
    showDetails: 'Details anzeigen',
    hideDetails: 'Details ausblenden',
    day: 'Tag',
    capturedAt: 'Erfasst um',
    captureMethod: 'Erfasst über',
    source: 'Quelle',
    per: (reference: string) => `Je ${reference}`,
  },
  /** Aktionen der Mengenprüfung zum Lebensmittel selbst. */
  editFood: 'Bearbeiten',
  addConversion: (missing: readonly ConversionUnit[]) => `${missing.map((unit) => conversionTexts[unit].name).join(' oder ')} eintragen`,
  conversion: {
    title: 'Umrechnung eintragen',
    hint: (eigen: boolean) =>
      eigen ? 'Die Umrechnung wird an deinem eigenen Lebensmittel gespeichert.' : 'Daraus entsteht ein eigenes Lebensmittel; die BLS-Daten bleiben unverändert.',
    unitName: (unit: ConversionUnit) => conversionTexts[unit].name,
    back: 'Zurück',
  },
  /** Eigene Mahlzeitenfotos im Protokoll und in der Fotoansicht (Spezifikation 2, Abschnitt 9; #164). */
  photo: {
    title: 'Mahlzeitenfoto',
    /**
     * Zugänglicher Name eines Fotos, wie bei Partnerfotos „Mahlzeitenfoto, <Mahlzeit>“ (Spezifikation 2, Abschnitt 12).
     * Hat eine Mahlzeit mehrere Fotos, unterscheidet sie die Nummer („Mahlzeitenfoto 2 von 2, Mittagessen“).
     */
    name: (meal: MealKey, of?: Readonly<{ position: number; count: number }>) =>
      `Mahlzeitenfoto${of === undefined ? '' : ` ${of.position} von ${of.count}`}, ${mealNames[meal]}`,
    loading: 'Foto lädt',
    /** Die Fotoansicht ist geöffnet, das Bild kommt aber nicht an. */
    unavailable: 'Das Foto lässt sich gerade nicht laden. Es braucht Internet.',
    retry: 'Erneut laden',
    share: 'Mit Partner teilen',
    shareHint: 'Dein Partner sieht das Foto heute unter „Wir“, ohne Namen, Mengen oder kcal.',
    delete: 'Foto löschen',
    deleteQuestion: 'Foto endgültig löschen? Die Einträge bleiben.',
    confirmDelete: 'Endgültig löschen',
    cancel: 'Abbrechen',
  },
} as const;
