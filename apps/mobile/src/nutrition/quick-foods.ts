import { localDateAfter, type EntityId, type LocalDate, type MealKey } from '@abnehm/contracts/base';
import { entryAmount, entryTotals, foodRefKey, roundKcal, type FoodRef, type NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { ReadContext } from '../local-db';
import { amountPrefill, type AmountPrefill } from './amount-prefill';
import type { CurrentFoods, FoodChoice } from './current-foods';
import { usedFoodsOfMeal } from './entry-repository';

// „Zuletzt verwendet“ (Spezifikation 2, Abschnitt 7; #158): eine lokale Abfrage über die Einträge, keine
// Entität (#36). Zusammen mit den Lebensmittelfavoriten bildet sie die Listen, aus denen die Person
// Gewohntes mit zwei Tipps erfasst. Beide Listen lösen ihre Referenzen hier gleich auf.

/** Ein Lebensmittel der Listen „Zuletzt verwendet“ und „Lebensmittelfavoriten“, mit vorbelegter Menge. */
export type QuickFood = FoodChoice &
  Readonly<{
    prefill: AmountPrefill;
    /** Ganze kcal der vorbelegten Menge. */
    kcal: number;
    /** Ob die Referenz verfügbar ist; sonst gilt die gespeicherte Fassung (Rückfall). */
    available: boolean;
  }>;

/** Beide Listen des Hinzufügen-Bildschirms für eine Mahlzeit, je vollständig und in Rangfolge. */
export type QuickFoods = Readonly<{ recent: readonly QuickFood[]; favorites: readonly QuickFood[] }>;

/** So viele Tage reicht „Zuletzt verwendet“ zurück, heute eingeschlossen (Designwert, nicht belegt). */
export const recentDays = 30;

/** Ein aufgelöstes Lebensmittel: aktuelle Werte oder, ohne verfügbare Referenz, die gespeicherte Fassung. */
export type ResolvedFood = Readonly<{ choice: FoodChoice; available: boolean }>;

/** Löst eine Referenz samt Überdeckung auf; ist sie nicht verfügbar, gilt `fallback` (Spezifikation 2, Abschnitt 7). */
export function resolveFood(tx: ReadContext, foods: CurrentFoods, ref: FoodRef, fallback: NutritionSnapshot): ResolvedFood {
  const current = foods.current(tx, ref);
  return { choice: current ?? { ref, snapshot: fallback }, available: current !== null };
}

/** Behält je Lebensmittel nach Auflösung das erste, in der gegebenen Rangfolge. */
export function uniqueFoods<T extends ResolvedFood>(resolved: readonly T[]): T[] {
  const seen = new Set<string>();
  return resolved.filter(({ choice }) => {
    const key = foodRefKey(choice.ref);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Das Lebensmittel mit seiner Vorbelegung: `last`, sonst Portion, sonst 100 g bzw. ml, samt kcal. */
export function quickFood({ choice, available }: ResolvedFood, last: AmountPrefill | undefined): QuickFood {
  const prefill = amountPrefill(choice.snapshot, last);
  const amount = entryAmount(choice.snapshot, prefill.displayUnit, prefill.displayAmountMilli);
  // `amountPrefill` liefert nur Mengen, die zum Snapshot passen.
  if (amount.type === 'problem') throw new Error(`Vorbelegung passt nicht: ${amount.problem}`);
  return { ...choice, available, prefill, kcal: roundKcal(entryTotals(choice.snapshot, amount.amount).milliKcal) };
}

/**
 * „Zuletzt verwendet“ einer Mahlzeit: die Lebensmittel der Einträge der letzten 30 Tage, je Lebensmittel
 * einmal und zuletzt verwendete zuerst, mit letzter Menge und Einheit. Einträge ohne Referenz fehlen; eine
 * überdeckte Quelle erscheint als eigenes Lebensmittel. Ist eine Referenz nicht mehr verfügbar, gilt der
 * Snapshot des Eintrags.
 */
export function recentFoods(tx: ReadContext, foods: CurrentFoods, personId: EntityId, meal: MealKey, today: LocalDate): QuickFood[] {
  const used = usedFoodsOfMeal(tx, personId, meal, localDateAfter(today, -(recentDays - 1)), today);
  return uniqueFoods(used.map((entry) => ({ ...resolveFood(tx, foods, entry.ref, entry.snapshot), last: entry }))).map((food) => quickFood(food, food.last));
}
