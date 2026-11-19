import { Weekday, type BausteinKey, type LocalDate } from '@abnehm/contracts/base';
import { sportSessionThreshold } from '@abnehm/contracts/goal-calculator';

import { preselectedWeekChoice, standardWeeklyPlan, type InitialPlanDraft, type WeekChoice } from '../plan';
import type { OnboardingDraft } from './draft';
import { goalPreviewOf, onboardingGoalDraft } from './goals';

// Wochenplan im Onboarding (Spezifikation 1, Abschnitte 4 und 9): Schritt 8 wählt nur Sporttage und
// Wiegetag; daraus macht der Standard-Wochenplan des Plan-Moduls die drei Tagesziele je Wochentag.
// Sporttag und Wiegetag schließen sich aus (Vorentscheidung 4,
// https://github.com/Yggras/abnehm-app/issues/57#issuecomment-6200698482): Am Wiegetag ist der dritte
// Platz „Gewogen“, am Sporttag „Sporteinheit“.

/** Wahl im Entwurf; was noch nicht gewählt ist, ersetzt die Vorauswahl Di/Do/Sa und Montag. */
export function weekChoiceOf(draft: OnboardingDraft): WeekChoice {
  return { sportDays: draft.sportDays ?? preselectedWeekChoice.sportDays, weighDay: draft.weighDay ?? preselectedWeekChoice.weighDay };
}

/** Sporttage in der Reihenfolge der Woche, nach dem Umschalten eines Tags. */
export function toggledSportDays(choice: WeekChoice, weekday: Weekday): Weekday[] {
  const days = new Set(choice.sportDays);
  if (days.has(weekday)) days.delete(weekday);
  else days.add(weekday);
  return Weekday.options.filter((day) => days.has(day));
}

export type WeekPreview = Readonly<{
  /** Die drei Tagesziele je Wochentag, Montag zuerst. */
  days: readonly Readonly<{ weekday: Weekday; bausteine: readonly BausteinKey[] }>[];
  /** Mindestdauer einer Sporteinheit in Minuten; `null` ohne Sporttag. */
  minimumSessionMinutes: number | null;
  weeklySportTargetMinutes: number;
}>;

/**
 * Vorschau in Schritt 8: Tagesziele je Wochentag und die Mindestdauer einer Sporteinheit aus dem
 * Sportziel der Vorschau von Schritt 7. `null` ohne gültige Berechnung.
 */
export function weekPreviewOf(draft: OnboardingDraft, today: LocalDate): WeekPreview | null {
  const goals = goalPreviewOf(draft, today);
  const week = standardWeeklyPlan(weekChoiceOf(draft));
  if (goals === null || goals.type !== 'berechnet' || week.type !== 'gueltig') return null;
  const weeklySportTargetMinutes = goals.sport.weeklyTargetMinutes;
  return {
    days: Weekday.options.map((weekday) => ({ weekday, bausteine: week.days[weekday] })),
    minimumSessionMinutes: sportSessionThreshold(weeklySportTargetMinutes, weekChoiceOf(draft).sportDays.length),
    weeklySportTargetMinutes,
  };
}

/**
 * Entwurf für „Erstplan speichern“ aus dem Onboarding-Entwurf am heutigen Tag; `null`, solange die
 * bestätigten Körperdaten aus Schritt 3 samt `entryId` des Startgewichts fehlen.
 */
export function initialPlanDraftOf(draft: OnboardingDraft, today: LocalDate): InitialPlanDraft | null {
  const goals = onboardingGoalDraft(draft, today);
  if (goals === null || draft.startWeightEntryId === undefined) return null;
  return { ...goals, ...weekChoiceOf(draft), startWeightEntryId: draft.startWeightEntryId };
}
