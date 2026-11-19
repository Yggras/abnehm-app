import { localDateAfter, type EntityId, type LocalDate, type MealKey } from '@abnehm/contracts/base';

import type { ReadContext } from '../local-db';
import { amountPrefill, type AmountPrefill } from './amount-prefill';
import { refKey, type CurrentFoods, type FoodChoice } from './current-foods';
import { usedFoodsOfMeal } from './entry-repository';

// „Zuletzt verwendet“ (Spezifikation 2, Abschnitt 7; #158): eine lokale Abfrage über die Einträge, keine
// Entität (#36). Zusammen mit den Lebensmittelfavoriten bildet sie die Listen, aus denen die Person
// Gewohntes mit zwei Tipps erfasst.

/** Ein Lebensmittel der Listen „Zuletzt verwendet“ und „Lebensmittelfavoriten“, mit vorbelegter Menge. */
export type QuickFood = FoodChoice &
  Readonly<{
    prefill: AmountPrefill;
    /** Ob die Referenz verfügbar ist; sonst gilt die gespeicherte Fassung (Rückfall). */
    available: boolean;
  }>;

/** Beide Listen des Hinzufügen-Bildschirms für eine Mahlzeit, je vollständig und in Rangfolge. */
export type QuickFoods = Readonly<{ recent: readonly QuickFood[]; favorites: readonly QuickFood[] }>;

/** So viele Tage reicht „Zuletzt verwendet“ zurück, heute eingeschlossen (Designwert, nicht belegt). */
export const recentDays = 30;

/**
 * „Zuletzt verwendet“ einer Mahlzeit: die Lebensmittel der Einträge der letzten 30 Tage, je Lebensmittel
 * einmal und zuletzt verwendete zuerst, mit letzter Menge und Einheit. Einträge ohne Referenz fehlen; eine
 * überdeckte Quelle erscheint als eigenes Lebensmittel. Ist eine Referenz nicht mehr verfügbar, gilt der
 * Snapshot des Eintrags; ein gelöschtes eigenes Lebensmittel erscheint nicht mehr, weil die Person es
 * bewusst entfernt hat.
 */
export function recentFoods(tx: ReadContext, foods: CurrentFoods, personId: EntityId, meal: MealKey, today: LocalDate): QuickFood[] {
  const seen = new Set<string>();
  const recent: QuickFood[] = [];
  for (const used of usedFoodsOfMeal(tx, personId, meal, localDateAfter(today, -(recentDays - 1)), today)) {
    const current = foods.current(tx, used.ref);
    if (current === null && used.ref.type === 'eigen') continue;
    const choice = current ?? { ref: used.ref, snapshot: used.snapshot };
    const key = refKey(choice.ref);
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push({ ...choice, available: current !== null, prefill: amountPrefill(choice.snapshot, used) });
  }
  return recent;
}
