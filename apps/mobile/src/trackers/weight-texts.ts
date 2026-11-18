import type { LocalDate } from '@abnehm/contracts/base';
import { changeInTenthKg, type WeightChange } from '@abnehm/contracts/tracker-rules';

import { thousandthsWithOneDecimal as kg } from '../shell/texts';
import { dayText } from './entry-texts';

// Texte des Gewicht-Detailbildschirms (Spezifikation 3, Abschnitt 5). Gewichte stehen in g und werden nur
// hier auf 0,1 kg gerundet. Veränderungen sind neutral formuliert: Ein steigender Trend ist eine Zahl mit
// Vorzeichen, ohne Wertung und ohne Warnfarbe.

const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'] as const;
const minus = '−';

/** Gewicht in kg mit einer Nachkommastelle, etwa „82,4 kg“. */
export const kgText = (weightG: number) => `${kg(weightG)} kg`;

/** kg mit einer Nachkommastelle und Vorzeichen, etwa „−0,8 kg“ oder „+0,3 kg“; 0,0 kg ohne Vorzeichen. */
function signedTenthKgText(changeKg: number, spoken: boolean): string {
  const sign = changeKg === 0 ? '' : changeKg < 0 ? (spoken ? 'minus ' : minus) : spoken ? 'plus ' : '+';
  return `${sign}${Math.abs(changeKg).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
}

/** Veränderung in g, gerundet wie `changeKg` (`changeInTenthKg`), etwa „−0,8 kg“. */
const signedKgText = (changeG: number) => signedTenthKgText(changeInTenthKg(changeG), false);

/** Zugänglich gesprochen: „minus 0,8 kg“ statt eines Strichs. */
const spokenSignedKg = (changeG: number) => signedTenthKgText(changeInTenthKg(changeG), true);

/** „Trend −0,4 kg in 2 Wochen“; ohne Messung in den letzten 14 Tagen ein Hinweis statt der Zahl. */
export function changeText(change: WeightChange): string {
  if (change.changeKg === null) return 'Für die Veränderung in 2 Wochen fehlt eine Messung der letzten 14 Tage.';
  return `Trend ${signedTenthKgText(change.changeKg, false)} in 2 Wochen`;
}

/** Zugänglicher Name von `changeText`. */
export function spokenChange(change: WeightChange): string {
  if (change.changeKg === null) return changeText(change);
  return `Trend ${signedTenthKgText(change.changeKg, true)} in 2 Wochen`;
}

/** Datum ausgeschrieben, etwa „13. Dezember 2026“. */
function longDateText(localDate: LocalDate): string {
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];
  return `${day}. ${months[month - 1]} ${year}`;
}

export const weightTexts = {
  trendLabel: 'Trendgewicht',
  trendExplained: 'Geglättet aus deinen Tagesgewichten: Einzelne Tage schwanken, der Trend zeigt die Richtung.',
  dayWeightLabel: 'Tagesgewicht',
  dayWeightOn: (weightG: number, localDate: LocalDate, today: LocalDate) => `Tagesgewicht ${kgText(weightG)} · ${dayText(localDate, today)}`,
  sinceStart: (changeG: number) => `Seit Start ${signedKgText(changeG)}`,
  spokenSinceStart: (changeG: number) => `Seit Start ${spokenSignedKg(changeG)}`,
  forecast: (goalWeightG: number, localDate: LocalDate) => `Zielgewicht ${kgText(goalWeightG)} etwa am ${longDateText(localDate)}`,
  estimate: 'Schätzung',
  belowThree: 'Ab drei Tagesgewichten zeigen wir deinen Trend.',
  empty: 'Noch keine Messung. Trag dein Gewicht ein, dann siehst du hier deinen Verlauf.',
  add: 'Gewicht eintragen',
  measurements: 'Messungen',
  dayWeightMark: 'Tagesgewicht',
  editTitle: 'Messung bearbeiten',
  delete: 'Löschen',
  loading: 'Gewicht lädt …',
  failed: 'Das Gewicht lässt sich gerade nicht laden.',
} as const;
