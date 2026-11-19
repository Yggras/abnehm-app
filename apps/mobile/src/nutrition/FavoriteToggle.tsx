import { useEffect, useState } from 'react';

import { IconButton } from '../design';
import type { FavoriteFood } from './food-favorites';
import type { Nutrition } from './nutrition';
import { nutritionTexts } from './texts';

// Stern-Schalter „Lebensmittelfavorit“ in Mengenprüfung und Eintragsdetails (Spezifikation 2, Abschnitt 7;
// #158). Eingeschaltet zeigt er Fläche und Icon in `primary`, nie nur Farbe, und ist für Screenreader ein
// Schalter. Eine KI-Schätzung ohne Referenz wird beim ersten Markieren zum eigenen Lebensmittel; danach
// steht sie für dieses, auch nach erneutem Öffnen der Eintragsdetails.

export function FavoriteToggle({ nutrition, food, onFailed }: { nutrition: Nutrition; food: FavoriteFood; onFailed: (error: unknown) => void }) {
  const [marked, setMarked] = useState(false);
  useEffect(() => nutrition.observeFoodFavorite(food, setMarked), [nutrition, food]);

  const toggle = () => {
    try {
      if (marked) nutrition.unmarkFoodFavorite(food);
      else nutrition.markFoodFavorite(food);
    } catch (error) {
      onFailed(error);
    }
  };

  return <IconButton icon="star" checked={marked} accessibilityLabel={nutritionTexts.favorite} onPress={toggle} />;
}
