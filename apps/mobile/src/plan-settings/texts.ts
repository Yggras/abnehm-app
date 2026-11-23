import type { SafetyTrigger } from '@abnehm/contracts/goal-calculator';
import type { ActivityLevel } from '@abnehm/contracts/person';
import type { Pace } from '@abnehm/contracts/ports';
import type { BudgetSource, BudgetSuggestionDirection } from '@abnehm/contracts/plan';

import { kcalText } from '../nutrition/texts';
import { activityLevelParts, onboardingTexts, safetyCheckTexts } from '../onboarding/texts';
import { monthNames, thousandthsWithOneDecimal } from '../shell/texts';
import { kgText } from '../trackers/weight-texts';

export { kcalText, kgText };

// Sichtbare Texte und zugängliche Namen der Einstellungsseite „Ziele“ (Spezifikation 1, Abschnitte 3 und
// 10). Den Hinweis „keine medizinische Beratung“ und die Erklärung des erzwungenen Haltemodus teilt die
// Seite wörtlich mit dem Onboarding (Schritte 1 und 4), die Kurzbeschriftungen der Aktivitätsstufen mit
// Schritt 5 (`activityLevelParts`). Hinweise zu Gesundheitswerten sind neutral formuliert und nie in
// `problem`-Farbe (Abschnitt 6).

/** Liter ohne überflüssige Nullen, etwa „1,5 l“ oder „1,75 l“; das Raster ist 250 ml. */
export const litreText = (ml: number) => `${(ml / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} l`;

const activityLevelName = (level: ActivityLevel) => `${activityLevelParts[level].level} – ${activityLevelParts[level].everyday}`;

export const activityLevelNames: Readonly<Record<ActivityLevel, string>> = {
  wenig_aktiv: activityLevelName('wenig_aktiv'),
  maessig_aktiv: activityLevelName('maessig_aktiv'),
  aktiv: activityLevelName('aktiv'),
};

export const paceNames: Readonly<Record<Pace, string>> = { entspannt: 'entspannt', zuegiger: 'zügiger' };

/** Abnahme je Woche des Tempos (Spezifikation 1, Abschnitt 3). */
export const paceRates: Readonly<Record<Pace, string>> = { entspannt: 'etwa 0,5 kg pro Woche', zuegiger: 'etwa 0,75 kg pro Woche' };

const holding = 'Gewicht halten';

export const goalTexts = {
  loading: 'Ziele werden geladen',
  error: 'Deine Ziele lassen sich gerade nicht laden. Öffne die Seite gleich noch einmal.',
  empty: 'Deine Ziele entstehen bei der Einrichtung.',
  disclaimer: onboardingTexts.disclaimer,

  sections: { budget: 'Kalorienbudget', goals: 'Deine Ziele', upcoming: 'Ab morgen' },
  upcomingIntro: 'Diese Werte gelten ab morgen. Bis dahin bleibt alles, wie es ist.',
  previously: (text: string) => `bisher ${text}`,

  budget: 'Kalorienbudget pro Tag',
  budgetSources: { berechnet: 'berechnet', manuell: 'selbst festgelegt', budgetvorschlag: 'aus einem Budgetvorschlag' } satisfies Record<BudgetSource, string>,
  basal: 'Grundumsatz',
  activity: 'Aktivitätsstufe',
  activityFactor: (factor: number) => `× ${factor.toLocaleString('de-DE')}`,
  activityFactorSpoken: (factor: number) => `mal ${factor.toLocaleString('de-DE')}`,
  total: 'Gesamtumsatz',
  deficit: (pace: Pace) => `Defizit für das Tempo ${paceNames[pace]}`,
  deficitValue: (kcal: number) => `− ${kcalText(kcal)}`,
  deficitSpoken: (kcal: number) => `minus ${kcalText(kcal)}`,
  lowerBound: 'Untergrenze',
  lowerBoundHint: 'Darunter setzt die App dein Budget nie.',
  raised: 'Die Rechnung lag unter deiner Untergrenze, deshalb ist dein Budget angehoben. Wenn du schneller abnehmen möchtest, lass dich bitte ärztlich begleiten.',

  goalWeight: 'Zielgewicht',
  forecast: (year: number, month: number) => `etwa ${monthNames[month - 1]} ${year}`,
  estimate: 'Schätzung',
  slowsDown: 'Nach etwa drei Monaten verlangsamt sich die Abnahme meist.',
  pace: 'Tempo',
  holding,
  paceText: (pace: Pace | null) => (pace === null ? holding : paceNames[pace]),
  water: 'Wasserziel',
  waterPerDay: (ml: number) => `${litreText(ml)} pro Tag`,
  waterHint: 'Bei Hitze und Sport brauchst du mehr.',
  sport: 'Sportziel',
  sportPerWeek: (minutes: number) => `${minutes} Minuten pro Woche`,
  sportStep: (minutes: number) => `${minutes} min`,
  sportHint: 'Aktive Minuten pro Woche',
  maintenance: 'Haltemodus',
  maintenanceStates: { off: 'aus', on: 'an' },
  /** Grund des Haltemodus als Unterzeile. */
  maintenanceReasons: { gewaehlt: 'selbst gewählt', sicherheits_check: 'wegen deiner Angaben im Sicherheits-Check' },
  /** Kurzform für „ab morgen“, wo der Grund als Wert neben „bisher“ steht. */
  maintenanceShort: { off: 'aus', gewaehlt: 'an (selbst gewählt)', sicherheits_check: 'an (Sicherheits-Check)' },
  /** Erklärung des erzwungenen Haltemodus; ohne bekannten Anlass allgemein. */
  maintenanceForced: (triggers: readonly SafetyTrigger[]) =>
    triggers.length > 0
      ? safetyCheckTexts.maintenanceForced(triggers)
      : 'Wegen deiner Angaben im Sicherheits-Check rechnet die App für dich ohne Kaloriendefizit: Dein Kalorienbudget entspricht deinem Gesamtumsatz. Wenn du abnehmen möchtest, lass dich bitte ärztlich begleiten.',

  edit: 'Ziele ändern',
  editIntro: 'Was du hier änderst, gilt ab morgen. Heute bleibt alles, wie es ist.',
  save: 'Ab morgen übernehmen',
  cancel: 'Abbrechen',
  holdSwitch: holding,
  holdHint: 'Ohne Kaloriendefizit: Dein Budget ist dein Gesamtumsatz.',
  choosePace: 'Wähle ein Tempo, um wieder abzunehmen.',
  paceChoice: (pace: Pace) => `${paceNames[pace]}, ${paceRates[pace]}`,
  goalNotBelow: (weightG: number) => `Dein Zielgewicht liegt nicht unter deinem Gewicht von ${kgText(weightG)}. Wähle ein niedrigeres, um abzunehmen.`,
  goalWeightHint: (suggestion: Readonly<{ fromG: number; toG: number }> | null, minimumG: number) =>
    `${suggestion === null ? '' : `Vorschlag: ${thousandthsWithOneDecimal(suggestion.fromG)} bis ${kgText(suggestion.toG)}. `}Mindestens ${kgText(minimumG)}.`,
  goalWeightBelowLimit: (minimumG: number) => `Dein Zielgewicht muss mindestens ${kgText(minimumG)} betragen, das entspricht einem BMI von 18,5.`,
  goalWeightInvalid: 'Bitte gib dein Zielgewicht in kg mit höchstens einer Nachkommastelle ein.',
  manualBudget: 'Budget selbst festlegen',
  manualBudgetHint: 'Statt der Rechnung gilt dein eigener Wert.',
  suggestionKept: (kcal: number) => `Es gilt weiter das Budget aus deinem Budgetvorschlag: ${kcalText(kcal)}.`,
  derivationChanged: 'neu berechnet',
  derivationBefore: 'bisherige Rechnung',
  manualBudgetField: 'Eigenes Kalorienbudget',
  manualBudgetRange: (min: number, max: number) => `${min.toLocaleString('de-DE')} bis ${kcalText(max)}, in 10er-Schritten`,
  manualBudgetInvalid: (min: number, max: number) => `Bitte gib ein Budget von ${min.toLocaleString('de-DE')} bis ${max.toLocaleString('de-DE')} kcal in 10er-Schritten ein.`,
  newBudget: 'Kalorienbudget ab morgen',

  leave: {
    title: 'Änderungen übernehmen?',
    text: 'Du hast deine Ziele geändert, aber noch nicht übernommen.',
    discard: 'Verwerfen',
    stay: 'Weiter bearbeiten',
  },
} as const;

/**
 * Texte des Sheets `plan.budget_suggestion` (Spezifikation 1, Abschnitt 7; #151). Die Begründung vergleicht den
 * Gewichtstrend der letzten drei Wochen neutral mit dem gewählten Tempo, ohne Bewertung oder Schuld.
 */
export const budgetSuggestionTexts = {
  loading: 'Budgetvorschlag wird geladen',
  previous: 'Bisheriges Budget',
  suggested: 'Vorschlag ab morgen',
  perDay: (kcal: number) => `${kcalText(kcal)} pro Tag`,
  reason: (direction: BudgetSuggestionDirection, pace: Pace | null) =>
    `In den letzten drei Wochen hast du laut Gewichtstrend ${direction === 'senken' ? 'weniger' : 'mehr'} abgenommen, als dein ${
      pace === null ? 'gewähltes Tempo' : `Tempo „${paceNames[pace]}“ (${paceRates[pace]})`
    } vorsieht.`,
  effect: (direction: BudgetSuggestionDirection, differenceKcal: number) =>
    `Mit ${kcalText(differenceKcal)} ${direction === 'senken' ? 'weniger' : 'mehr'} am Tag kommst du näher an dieses Tempo.`,
  onlyWithConfirmation: 'Dein Budget ändert sich nur, wenn du den Vorschlag übernimmst.',
  accept: 'Übernehmen ab morgen',
  decline: 'Nicht jetzt',
  closed: {
    angenommen: 'Diesen Vorschlag hast du übernommen.',
    abgelehnt: 'Diesen Vorschlag hast du abgelehnt.',
    ueberholt: 'Dieser Vorschlag gilt nicht mehr, weil sich deine Ziele inzwischen geändert haben.',
    unbekannt: 'Diesen Vorschlag gibt es nicht mehr.',
  },
} as const;

/** Zugänglicher Name einer Wertzeile: „Titel: Wert, Unterzeile“. */
export const rowLabel = (title: string, value: string, ...details: readonly (string | null | undefined)[]) =>
  [`${title}: ${value}`, ...details.filter((detail): detail is string => typeof detail === 'string' && detail.length > 0)].join(', ');
