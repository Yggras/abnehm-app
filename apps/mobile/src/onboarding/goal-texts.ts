import { goalTexts, kcalText, kgText } from '../plan-settings/texts';

// Sichtbare Texte und zugängliche Namen der Onboarding-Schritte 5 „Aktivitätsstufe“, 6 „Zielgewicht und
// Tempo“ und 7 „Ergebnis“ (Spezifikation 1, Abschnitte 3 und 9). Begriffe, Prognose, Herleitung und
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
  /** Ein Zielgewicht nicht unter dem aktuellen führt in den gewählten Haltemodus (Abschnitt 3, Designwert). */
  notBelowCurrent: (weightG: number) =>
    `Dein Zielgewicht liegt nicht unter deinem aktuellen Gewicht von ${kgText(weightG)}. Die App rechnet deshalb ohne Kaloriendefizit (Haltemodus): Dein Kalorienbudget ist dein Gesamtumsatz. Wähle ein niedrigeres Zielgewicht, um abzunehmen.`,
  maintenanceForced: goalTexts.maintenanceForced,
  pace: goalTexts.pace,
  paceChoice: goalTexts.paceChoice,
  forecastLabel: 'Voraussichtlich erreicht',
  forecast: goalTexts.forecast,
  /** Die Prognose ist ausdrücklich eine Schätzung; die Verlangsamung nennt die S3-Leitlinie, Empf. 5.11. */
  forecastNote: `${goalTexts.estimate}. ${goalTexts.slowsDown}`,
} as const;

/** Schritt 7: Kalorienbudget mit Herleitung, Wasser und Sport, jeder Wert direkt änderbar. */
export const resultTexts = {
  intro: 'Das schlägt die App für dich vor. Du kannst jeden Wert anpassen.',
  /** Nur, wenn der Entwurf keine gültige Berechnung mehr ergibt, etwa nach einer Änderung in Schritt 3. */
  incomplete: 'Deine Angaben ergeben gerade keine Berechnung. Prüfe sie bitte in den vorigen Schritten.',
  budget: goalTexts.budget,
  budgetHint: (source: 'berechnet' | 'manuell', min: number, max: number) =>
    `${source === 'berechnet' ? 'Berechnet' : 'Selbst festgelegt'}. Möglich sind ${min.toLocaleString('de-DE')} bis ${kcalText(max)}.`,
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
