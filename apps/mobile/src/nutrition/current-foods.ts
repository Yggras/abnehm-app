import type { FoodRef, NutritionSnapshot } from '@abnehm/contracts/nutrition';

import type { ReadContext } from '../local-db';
import type { BlsCatalog } from './bls-catalog';
import { cachedProduct } from './off-cache-repository';
import { livingOwnFood, overlayingOwnFood } from './own-food-repository';

// Auflösung einer Lebensmittelreferenz zum Lebensmittel, das die Person heute erfasst (Spezifikation 2,
// Abschnitte 3 und 7; #158). Favoriten und „Zuletzt verwendet“ speichern nur Referenz und Fassung; erst
// hier zeigt sich, ob die Referenz noch verfügbar ist und ob ein eigenes Lebensmittel sie überdeckt.

/** Ein Lebensmittel zum Erfassen: Referenz und aktuelle Fassung, aus der der Snapshot eines Eintrags entsteht. */
export type FoodChoice = Readonly<{ ref: FoodRef; snapshot: NutritionSnapshot }>;

/**
 * Das Lebensmittel, für das eine Referenz heute steht, ohne Katalog: Ein eigenes Lebensmittel, das die
 * Quelle überdeckt, tritt an ihre Stelle; sonst bleibt es die Referenz selbst. Gleiche Lebensmittel haben
 * dieselbe Identität, gleich über welche Referenz sie erreicht werden.
 */
export function foodIdentity(tx: ReadContext, ref: FoodRef): FoodRef {
  return ref.type === 'eigen' ? ref : (overlayingOwnFood(tx, ref)?.ref ?? ref);
}

export type CurrentFoods = Readonly<{
  /**
   * Aktuelle Werte genau dieser Referenz, ohne Überdeckung: das nicht gelöschte eigene Lebensmittel, der
   * vollständige Cache-Eintrag bzw. der Katalogeintrag. `null`, wenn sie nicht verfügbar ist.
   */
  exact(tx: ReadContext, ref: FoodRef): NutritionSnapshot | null;
  /** Das Lebensmittel heute: ein überdeckendes eigenes Lebensmittel, sonst `exact`; `null`, wenn keines verfügbar ist. */
  current(tx: ReadContext, ref: FoodRef): FoodChoice | null;
}>;

export function createCurrentFoods(bls: BlsCatalog): CurrentFoods {
  const exact = (tx: ReadContext, ref: FoodRef): NutritionSnapshot | null => {
    switch (ref.type) {
      case 'eigen':
        return livingOwnFood(tx, ref.key)?.snapshot ?? null;
      case 'off':
        return cachedProduct(tx, ref.key);
      case 'bls':
        return bls.byKey(ref.key)?.snapshot ?? null;
    }
  };
  return {
    exact,
    current(tx, ref) {
      const overlay = ref.type === 'eigen' ? undefined : overlayingOwnFood(tx, ref);
      if (overlay !== undefined) return overlay;
      const snapshot = exact(tx, ref);
      return snapshot === null ? null : { ref, snapshot };
    },
  };
}
