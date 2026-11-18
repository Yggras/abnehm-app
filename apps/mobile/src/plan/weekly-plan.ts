import { Weekday, type BausteinKey } from '@abnehm/contracts/base';
import { WeeklyPlanDays } from '@abnehm/contracts/plan';

// Standard-Wochenplan aus dem Onboarding (Spezifikation 1, Abschnitt 4; #14): Die Person wählt nur
// Sporttage und Wiegetag. Daraus entstehen die drei Momo-Plätze je Wochentag. Frei belegen lassen sich
// die Plätze erst in den Einstellungen (`freeWeeklyPlan`, #134).

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

/** Die drei Plätze je Wochentag, wie sie der Wochenplan-Editor hält; geprüft wird erst `freeWeeklyPlan`. */
export type WeeklyPlanInput = Readonly<Record<Weekday, readonly [BausteinKey, BausteinKey, BausteinKey]>>;

/** Ein Wochentag, dessen drei Plätze nicht drei verschiedene Bausteine tragen. */
export type WeeklyPlanDayError = Readonly<{ weekday: Weekday; error: 'bausteine_not_distinct' }>;

/**
 * Wochenplan aus den Einstellungen (Spezifikation 1, Abschnitt 4): jeder Wochentag frei mit drei
 * verschiedenen Bausteinen, mehrere oder keine Wiegetage. Die Regel prüft das Vertragsschema
 * `WeeklyPlanDays`; jeder Wochentag, den es beanstandet, wird ein Fehler.
 */
export function freeWeeklyPlan(days: WeeklyPlanInput): { type: 'gueltig'; days: WeeklyPlanDays } | { type: 'ungueltig'; errors: WeeklyPlanDayError[] } {
  const parsed = WeeklyPlanDays.safeParse(days);
  if (parsed.success) return { type: 'gueltig', days: parsed.data };
  const rejected = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  return {
    type: 'ungueltig',
    errors: Weekday.options.filter((weekday) => rejected.has(weekday)).map((weekday) => ({ weekday, error: 'bausteine_not_distinct' })),
  };
}
