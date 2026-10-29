import { Weekday, type BausteinKey } from '@abnehm/contracts/base';
import type { WeeklyPlanDays } from '@abnehm/contracts/plan';

// Standard-Wochenplan aus dem Onboarding (Spezifikation 1, Abschnitt 4; #14): Die Person wählt nur
// Sporttage und Wiegetag. Daraus entstehen die drei Momo-Plätze je Wochentag. Frei belegen lassen sich
// die Plätze erst in den Einstellungen.

/** Wahl in Onboarding-Schritt 8: 0–6 Sporttage und genau ein Wiegetag, der kein Sporttag ist. */
export type WeekChoice = Readonly<{ sportDays: readonly Weekday[]; weighDay: Weekday }>;

/** Verletzte Regel der Wahl; die Oberfläche sperrt die Chips gegenseitig und erklärt das. */
export type WeekChoiceError = 'sport_day_repeated' | 'weigh_day_is_sport_day';

/** Vorauswahl: Sporttage Dienstag, Donnerstag und Samstag (Designwert), Wiegetag Montag. */
export const preselectedWeekChoice: WeekChoice = { sportDays: ['dienstag', 'donnerstag', 'samstag'], weighDay: 'montag' };

/**
 * Platz 1 Ernährung erfasst, Platz 2 Wasserziel, Platz 3 Sporteinheit am Sporttag, Gewogen am
 * Wiegetag, sonst Im Kalorienbudget.
 */
export function standardWeeklyPlan(
  choice: WeekChoice,
): { type: 'gueltig'; days: WeeklyPlanDays } | { type: 'ungueltig'; errors: WeekChoiceError[] } {
  const errors: WeekChoiceError[] = [];
  if (new Set(choice.sportDays).size !== choice.sportDays.length) errors.push('sport_day_repeated');
  if (choice.sportDays.includes(choice.weighDay)) errors.push('weigh_day_is_sport_day');
  if (errors.length > 0) return { type: 'ungueltig', errors };
  const third = (weekday: Weekday): BausteinKey =>
    choice.sportDays.includes(weekday) ? 'sporteinheit' : weekday === choice.weighDay ? 'gewogen' : 'im_kalorienbudget';
  return {
    type: 'gueltig',
    days: Object.fromEntries(Weekday.options.map((weekday) => [weekday, ['ernaehrung_erfasst', 'wasserziel', third(weekday)]])) as WeeklyPlanDays,
  };
}
