import { dailyIntakeKcal } from '@abnehm/contracts/nutrition';

import { bausteinEvaluation, isDayClosed, type BausteinEvaluator, type CheckInEvaluator, type DayFactsReader } from '../daily-goals';
import { intakeByDay } from './entry-repository';

// Beiträge der Ernährung zur Baustein-Auswertung und zum Tages-Check-in (Spezifikation 2, Abschnitt 10;
// Spezifikation 0, Abschnitt 3). Ein Reader liefert je Person und lokalem Tag die Mahlzeitenzahl und die
// gerundete Tagesaufnahme; die Evaluatoren für „Ernährung erfasst“ und „Im Kalorienbudget“ und der
// Tages-Check-in `ernaehrung` werten nur diese Fakten und den Snapshot aus. Der Composition Root
// registriert sie in der Registry des Fundaments.

/** Tagesfakten der Ernährung: Mahlzeiten mit mindestens einem nicht gelöschten Eintrag und Aufnahme in kcal. */
export type NutritionDayFacts = Readonly<{
  /** 0–4: Frühstück, Mittagessen, Abendessen und Snacks, sobald sie einen Eintrag haben. */
  recordedMealCategories: number;
  /** Tagesaufnahme: die kaufmännisch gerundete Summe der `milli_kcal` aller nicht gelöschten Einträge. */
  intakeKcal: number;
}>;

/** Liest die Tagesfakten in der laufenden Transaktion, nur aus der Tabelle der Ernährungseinträge. */
export const readNutritionDayFacts: DayFactsReader<NutritionDayFacts> = (tx, personId, localDate) => {
  const intake = intakeByDay(tx, personId, localDate, localDate).get(localDate);
  // Die Summe der `milli_kcal` bildet die Abfrage; gerundet wird nach der Regel der Tagesaufnahme.
  return { recordedMealCategories: intake?.recordedMealCategories ?? 0, intakeKcal: dailyIntakeKcal([intake?.intakeMilliKcal ?? 0]) };
};

/** „Ernährung erfasst“: 0 Mahlzeiten `offen`, unter der Schwelle `teilweise`, ab der Schwelle `erfuellt`. */
const mealsRecorded: BausteinEvaluator<'ernaehrung_erfasst', NutritionDayFacts> = {
  baustein: 'ernaehrung_erfasst',
  readFacts: readNutritionDayFacts,
  evaluate(snapshot, at, { recordedMealCategories }) {
    const { minimumMealCategories } = snapshot;
    const state = recordedMealCategories === 0 ? 'offen' : recordedMealCategories < minimumMealCategories ? 'teilweise' : 'erfuellt';
    return bausteinEvaluation(state, isDayClosed(snapshot, at), { type: snapshot.type, recordedMealCategories, minimumMealCategories });
  },
};

/**
 * „Im Kalorienbudget“: vor `dayEndsAt` immer `tagesende`, danach `erfuellt` genau dann, wenn die
 * gerundete Aufnahme zwischen Untergrenze und Budget liegt (beide eingeschlossen), sonst `offen`. Ohne
 * Einträge ist die Aufnahme 0 und liegt damit unter der Untergrenze.
 */
const calorieBudget: BausteinEvaluator<'im_kalorienbudget', NutritionDayFacts> = {
  baustein: 'im_kalorienbudget',
  readFacts: readNutritionDayFacts,
  evaluate(snapshot, at, { intakeKcal }) {
    const { budgetKcal, lowerBoundKcal } = snapshot;
    const dayClosed = isDayClosed(snapshot, at);
    const within = intakeKcal >= lowerBoundKcal && intakeKcal <= budgetKcal;
    const state = !dayClosed ? 'tagesende' : within ? 'erfuellt' : 'offen';
    return bausteinEvaluation(state, dayClosed, { type: snapshot.type, intakeKcal, budgetKcal, lowerBoundKcal });
  },
};

/**
 * Tages-Check-in `ernaehrung` (#37): mittags hinterher ohne Mahlzeit, abends mit weniger als zwei. Er
 * hängt weder am Wochenplan noch am Kalorienbudget; das Budget erzeugt nie einen Check-in.
 */
const checkIn: CheckInEvaluator<'ernaehrung', NutritionDayFacts> = {
  tracker: 'ernaehrung',
  readFacts: readNutritionDayFacts,
  evaluate({ moment }, { recordedMealCategories }) {
    return {
      behind: recordedMealCategories < (moment === 'mittag' ? 1 : 2),
      reason: { type: 'ernaehrung', recordedMealCategories },
    };
  },
};

/** Was die Ernährung in der Registry der Tagesziele registriert. */
export const nutritionDailyGoals = {
  bausteine: [mealsRecorded, calorieBudget],
  checkIns: [checkIn],
} as const;
