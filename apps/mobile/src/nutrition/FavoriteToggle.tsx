import type { FoodRef } from '@abnehm/contracts/nutrition';
import { useEffect, useState } from 'react';

import { IconButton } from '../design';
import type { FavoriteFood } from './food-favorites';
import type { Nutrition } from './nutrition';
import { nutritionTexts } from './texts';

// Stern-Schalter „Lebensmittelfavorit“ in Mengenprüfung und Eintragsdetails (Spezifikation 2, Abschnitt 7;
// #158). Eingeschaltet zeigt er Fläche und Icon in `primary`, nie nur Farbe, und ist für Screenreader ein
// Schalter. Eine KI-Schätzung ohne Referenz wird beim Markieren zum eigenen Lebensmittel; ab dann folgt
// der Schalter dessen Referenz.

export function FavoriteToggle({ nutrition, food, onFailed }: { nutrition: Nutrition; food: FavoriteFood; onFailed: (error: unknown) => void }) {
  const [ref, setRef] = useState<FoodRef | null>(food.ref);
  const [marked, setMarked] = useState(false);
  useEffect(() => (ref === null ? undefined : nutrition.observeFoodFavorite(ref, setMarked)), [nutrition, ref]);

  const toggle = () => {
    try {
      if (marked && ref !== null) nutrition.unmarkFoodFavorite(ref);
      else setRef(nutrition.markFoodFavorite({ ref, snapshot: food.snapshot }));
    } catch (error) {
      onFailed(error);
    }
  };

  return <IconButton icon="star" checked={marked} accessibilityLabel={nutritionTexts.favorite} onPress={toggle} />;
}
