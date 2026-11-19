import type { BausteinKey, Weekday } from '@abnehm/contracts/base';
import type { BudgetSource } from '@abnehm/contracts/plan';

import { goalTexts, kcalText, kgText } from '../plan-settings/texts';
import { bausteinNames, germanList } from '../shell/texts';

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// Sichtbare Texte und zugängliche Namen der Onboarding-Schritte 5 „Aktivitätsstufe“, 6 „Zielgewicht und
// Tempo“, 7 „Ergebnis“ und 8 „Wochenplan“ (Spezifikation 1, Abschnitte 3, 4 und 9). Begriffe, Prognose, Herleitung und
// Hinweise teilen sie wörtlich mit der Seite „Ziele“ (`goalTexts`), damit beide dasselbe sagen. Hinweise
// zu Gesundheitswerten sind neutral formuliert und nie in `problem`-Farbe (Abschnitt 6).

/** Schritt 5: drei Karten, die niedrigste vorausgewählt, dazu „im Zweifel die niedrigere“ (Abschnitt 9). */
export const activityTexts = {
  intro: 'Wie bewegst du dich an einem normalen Tag, etwa bei der Arbeit? Daraus schätzt die App deinen Gesamtumsatz.',
  doubt: 'Im Zweifel die niedrigere Stufe: So überschätzt die App deinen Bedarf nicht.',
} as const;

/**
 * Schritt 6. Der Vorschlag 5–10 % unter dem aktuellen Gewicht folgt AHA/ACC/TOS 2013
 * (https://doi.org/10.1161/01.cir.0000437739.71477.ee), die Untergrenze BMI 18,5 der WHO; beides nennt
 * Spezifikation 1, Abschnitt 3.
 */
export const goalWeightTexts = {
  intro: 'Ein realistisches erstes Ziel liegt 5 bis 10 % unter deinem aktuellen Gewicht.',
  goalWeight: goalTexts.goalWeight,
  hint: goalTexts.goalWeightHint,
  belowLimit: goalTexts.goalWeightBelowLimit,
  invalid: goalTexts.goalWeightInvalid,
  /**
   * Ein Zielgewicht nicht unter dem aktuellen führt in den gewählten Haltemodus (Abschnitt 3, Designwert).
   * Anders als `goalTexts.goalNotBelow` der Seite „Ziele“, die dafür einen Schalter hat, nennt der Satz den
   * Haltemodus und seine Folge, weil das Onboarding ihn sonst nirgends erklärt (Akzeptanzkriterium #143).
   */
  notBelowCurrent: (weightG: number) =>
    `Dein Zielgewicht liegt nicht unter deinem aktuellen Gewicht von ${kgText(weightG)}. Die App rechnet deshalb ohne Kaloriendefizit (Haltemodus): Dein Kalorienbudget ist dein Gesamtumsatz. Wähle ein niedrigeres Zielgewicht, um abzunehmen.`,
  maintenanceForced: goalTexts.maintenanceForced,
  pace: goalTexts.pace,
  paceChoice: goalTexts.paceChoice,
  forecastLabel: 'Voraussichtlich erreicht',
  forecast: goalTexts.forecast,
  /**
   * Die Prognose ist ausdrücklich eine Schätzung; die Verlangsamung nennt die S3-Leitlinie Adipositas 2024,
   * Empf. 5.11 (https://register.awmf.org/assets/guidelines/050-001l_S3_Praevention-Therapie-Adipositas_2024-10.pdf).
   */
  forecastNote: `${goalTexts.estimate}. ${goalTexts.slowsDown}`,
} as const;

/** Schritt 7: Kalorienbudget mit Herleitung, Wasser und Sport, jeder Wert direkt änderbar. */
export const resultTexts = {
  intro: 'Das schlägt die App für dich vor. Du kannst jeden Wert anpassen.',
  /** Nur, wenn der Entwurf keine gültige Berechnung mehr ergibt, etwa nach einer Änderung in Schritt 3. */
  incomplete: 'Deine Angaben ergeben gerade keine Berechnung. Prüfe sie bitte in den vorigen Schritten.',
  budget: goalTexts.budget,
  /** Herkunft wie auf der Seite „Ziele“, etwa „Berechnet. Möglich sind 1.520 bis 2.120 kcal.“ */
  budgetHint: (source: Extract<BudgetSource, 'berechnet' | 'manuell'>, min: number, max: number) =>
    `${capitalized(goalTexts.budgetSources[source])}. Möglich sind ${min.toLocaleString('de-DE')} bis ${kcalText(max)}.`,
  /** Kurz, damit es auf dem iPhone SE einzeilig bleibt (Impeccable-critique). */
  useCalculated: (kcal: number) => `Zurück zu ${kcalText(kcal)}`,
  showDerivation: 'So entsteht dein Budget',
  hideDerivation: 'Herleitung ausblenden',
  raised: goalTexts.raised,
  maintenanceForced: goalTexts.maintenanceForced,
  goals: goalTexts.sections.goals,
  water: goalTexts.water,
  waterHint: goalTexts.waterHint,
  sport: goalTexts.sport,
  sportHint: goalTexts.sportHint,
  sportStep: goalTexts.sportStep,
} as const;

const weekdayNames: Readonly<Record<Weekday, string>> = {
  montag: 'Montag', dienstag: 'Dienstag', mittwoch: 'Mittwoch', donnerstag: 'Donnerstag', freitag: 'Freitag', samstag: 'Samstag', sonntag: 'Sonntag',
};
const weekdayShort: Readonly<Record<Weekday, string>> = {
  montag: 'Mo', dienstag: 'Di', mittwoch: 'Mi', donnerstag: 'Do', freitag: 'Fr', samstag: 'Sa', sonntag: 'So',
};

/**
 * Schritt 8: Sporttage und Wiegetag, gegenseitig gesperrt mit Hinweis, und die Vorschau der Woche. Der
 * Grund der Sperre folgt dem Standard-Wochenplan (Abschnitt 4): Der dritte Platz eines Tags ist am Sporttag
 * „Sporteinheit“, am Wiegetag „Gewogen“.
 */
export const weeklyPlanTexts = {
  intro: 'Wähle deine Sporttage und deinen Wiegetag. Daraus entstehen deine drei Tagesziele für jeden Wochentag.',
  sportDays: 'Sporttage',
  weighDay: 'Wiegetag',
  weekday: (weekday: Weekday) => weekdayNames[weekday],
  weekdayShort: (weekday: Weekday) => weekdayShort[weekday],
  /** Am gesperrten Sporttag-Chip und als Satz unter den Sporttagen. */
  weighDayLocked: (weekday: Weekday) =>
    `${weekdayNames[weekday]} ist dein Wiegetag. Dort ist das dritte Tagesziel „${bausteinNames.gewogen}“, darum ist er kein Sporttag.`,
  /** Am gesperrten Wiegetag-Chip. */
  sportDayLocked: (weekday: Weekday) =>
    `${weekdayNames[weekday]} ist ein Sporttag. Dort ist das dritte Tagesziel „${bausteinNames.sporteinheit}“, darum ist er kein Wiegetag.`,
  /** Als Satz unter dem Wiegetag, solange es Sporttage gibt. */
  sportDaysLocked: `Sporttage sind kein Wiegetag: Dort ist das dritte Tagesziel „${bausteinNames.sporteinheit}“.`,
  preview: 'Deine Woche',
  /** Zugänglicher Name einer Zeile der Vorschau, etwa „Montag: Ernährung erfasst, Wasserziel und Gewogen“. */
  dayLabel: (weekday: Weekday, bausteine: readonly BausteinKey[]) => `${weekdayNames[weekday]}: ${germanList(bausteine.map((key) => bausteinNames[key]))}`,
  /** Über der Vorschau: die zwei Ziele, die jeden Tag gelten; je Wochentag steht dann nur das dritte. */
  everyDay: (bausteine: readonly BausteinKey[]) => `Jeden Tag: ${germanList(bausteine.map((key) => bausteinNames[key]))}. Dazu je Wochentag:`,
  baustein: (key: BausteinKey) => bausteinNames[key],
  /** Schwelle der Sporteinheit = Sportwochenziel ÷ Sporttage, aufgerundet (Abschnitt 3). */
  minimumSession: (minutes: number, weeklyMinutes: number, sportDays: number) =>
    `Eine Sporteinheit zählt ab ${minutes} Minuten: dein Sportziel von ${weeklyMinutes} Minuten pro Woche, verteilt auf ${sportDays} ${sportDays === 1 ? 'Sporttag' : 'Sporttage'}.`,
  noSportDay: (weeklyMinutes: number) =>
    `Ohne Sporttag gibt es kein Tagesziel „${bausteinNames.sporteinheit}“. Dein Sportziel von ${weeklyMinutes} Minuten pro Woche bleibt.`,
  save: 'Plan speichern',
  retry: 'Erneut versuchen',
  failed: 'Dein Plan ist noch nicht gespeichert. Versuch es bitte noch einmal.',
  /** Der Entwurf ergibt keinen Plan mehr, etwa nach einem Tageswechsel über einen Geburtstag. */
  incomplete: resultTexts.incomplete,
} as const;
